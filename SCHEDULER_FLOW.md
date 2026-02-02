# Time-based schedule checker – how it works (step by step)

This document describes how the auto-schedule checker decides when to push or clear a code on the lock, and what happens at each step. Use it to debug "scheduler not activating a slot" or "code not clearing when schedule ends".

---

## 1. Where the scheduler is registered

**File:** `custom_components/yale_lock_manager/__init__.py`

- On integration load, the options flow value **Schedule check interval (minutes)** is read from `entry.options` (default 5, range 1–60).
- `async_track_time_interval(hass, _schedule_check, timedelta(minutes=interval_minutes))` is called so `_schedule_check` runs every N minutes.
- `_schedule_check(_now)` gets the coordinator from `hass.data[DOMAIN][entry.entry_id]` and calls `coord.async_check_schedules()`.
- A first run is also scheduled immediately: `hass.async_create_task(coordinator.async_check_schedules())`.

So: every N minutes (and once at startup), `YaleLockCoordinator.async_check_schedules()` is run.

---

## 2. What `async_check_schedules()` does (coordinator)

**File:** `custom_components/yale_lock_manager/coordinator.py` (see `async_check_schedules`)

Step-by-step:

1. **Loop over slots**  
   Iterates over `self._user_data["users"].items()`. Only slots that exist in stored user data are considered (slots created/saved in the UI or via services).

2. **Skip FOBs**  
   If `user_data["code_type"] == CODE_TYPE_FOB`, the slot is skipped (FOBs are not pushed/cleared by the scheduler).

3. **Skip slots without a schedule**  
   `schedule = user_data.get("schedule", {})`, `start = schedule.get("start")`, `end = schedule.get("end")`.  
   If both `start` and `end` are missing/empty, the slot is skipped (no time window → no schedule check).

4. **Compute "valid now"**  
   `valid_now = self._is_code_valid(slot)` (see section 3 below).  
   So: is the current time inside the schedule window (after start, before end)?

5. **Desired vs actual state**  
   - `enabled = user_data.get("enabled", False)`  → cached status (user wants this slot enabled or disabled).  
   - `do_not_auto_enable = user_data.get("do_not_auto_enable", False)`  → if True, the user has disabled the slot and the scheduler must **not** re-enable it.  
   - `has_pin_or_name`  → slot has something to push (name or code).  
   - `lock_status = user_data.get("lock_status_from_lock")`, `lock_code = user_data.get("lock_code") or ""`.  
   - `code_on_lock = (lock_status == USER_STATUS_ENABLED and bool(lock_code))`  → code is currently on the lock.  
   - `should_be_on_lock = valid_now and (enabled or (not do_not_auto_enable and has_pin_or_name))`  → code should be on the lock (inside window, and either already enabled or we are allowed to auto-enable once).

6. **Decide whether to act**  
   If `code_on_lock == should_be_on_lock`, the slot is already in the desired state → skip (no push/clear).

7. **Auto-enable once (if schedule starts and slot is Disabled)**  
   If `should_be_on_lock` is True and the slot is currently **Disabled**, the scheduler sets `user_data["enabled"] = True`, `user_data["lock_status"] = USER_STATUS_ENABLED`, `user_data["enabled_by_scheduler"] = True`, then calls the internal push. So slots that default to Disabled when set up are **auto-enabled once** when the schedule becomes active. If `do_not_auto_enable` is True (user disabled the slot), the scheduler does **not** re-enable.

8. **Call internal push**  
   The code calls `await self._do_push_code_to_lock(slot)` (not the public `async_push_code_to_lock`).  
   - When **schedule starts** (valid_now True, should_be_on_lock True): the internal push **sets** the code on the lock.  
   - When **schedule ends** (valid_now False, should_be_on_lock False): the internal push **clears** the code on the lock.

9. **Clear slot at schedule end**  
   When **schedule ends** (after the internal push clears the code), the scheduler also **clears the slot's local cache** (name, code, schedule, etc.) via `_clear_slot_local_cache(slot)`, saves, and updates entity state. The slot becomes available for reuse.

10. **Event and logging**  
   After a successful push, it fires `yale_lock_manager_schedule_started` or `yale_lock_manager_schedule_ended` and logs. Then `await asyncio.sleep(1)` before the next slot.

---

## 3. How "valid now" is computed: `_is_code_valid(slot)`

**File:** `custom_components/yale_lock_manager/coordinator.py` (around lines 588–614)

- Reads `user_data = self._user_data["users"].get(str(user_slot))`. If no user, returns `False`.
- Reads `schedule = user_data.get("schedule", {})`, `start = schedule.get("start")`, `end = schedule.get("end")`.
- If there is **no** start and **no** end → **return True** (no schedule → always "valid").
- Otherwise uses **Home Assistant's current time**: `now = dt_util.now()` (respects HA time zone).
- If `start` is set: parses `start` as ISO datetime; if `now < start_dt` → **return False** (before window).
- If `end` is set: parses `end` as ISO datetime; if `now > end_dt` → **return False** (after window).
- Otherwise → **return True** (inside window).

So "valid now" means: we are inside the schedule window (or there is no window).

---

## 4. Two push paths: public vs scheduler

**File:** `custom_components/yale_lock_manager/coordinator.py`

**Public path – `async_push_code_to_lock(slot)`** (used by the Push button and the push service):

1. Loads `user_data` for the slot; returns early if FOB.
2. **Rejects when outside schedule window**: if the slot has a schedule (`start` or `end`) and `not self._is_code_valid(slot)`, raises `HomeAssistantError("Time slot is not active; push is handled by the scheduler when the schedule is active.")` so the user cannot push manually when the slot is outside its window.
3. Calls `await self._do_push_code_to_lock(slot)`.

**Internal path – `_do_push_code_to_lock(slot)`** (used by the scheduler and by `async_push_code_to_lock` after the check above):

1. Loads `user_data` for the slot; returns early if FOB.
2. Computes `should_be_on_lock = enabled and self._is_code_valid(slot)` (no "outside window" rejection).
3. If **should be on lock**: sets the code on the lock (Z-Wave), waits, verifies, updates `lock_code` / `lock_status_from_lock` / `synced_to_lock`.
4. If **should not be on lock**: clears the code on the lock, waits, verifies, updates the same fields.
5. Saves user data and updates entity state.

The **scheduler** calls `_do_push_code_to_lock(slot)` directly (step 2.7 above), so it can both **set** the code when the schedule starts and **clear** the code when the schedule ends, without hitting the "outside window" check that applies only to the public push.

---

## 5. Auto-enable once when schedule starts

For the scheduler to **activate** a slot when the time-based schedule becomes active:

- The slot must be in `_user_data["users"]` (saved at least once).
- The slot must have **time-based schedule** with `start` and/or `end` set (and stored in `user_data["schedule"]`).
- The slot must have a **name or code** to push (`has_pin_or_name`).
- **Either** the slot is already **Enabled**, **or** `do_not_auto_enable` is False (so the scheduler can auto-enable once). Slots default to Disabled when set up; the scheduler **sets the slot to Enabled once** when the schedule becomes active and pushes the code, so you do not have to enable it first. If you later set the slot to Disabled, `do_not_auto_enable` is set and the scheduler will **not** re-enable it for the rest of that schedule window.
- When the clock crosses the start time, `valid_now` is True and `should_be_on_lock` is True (if not `do_not_auto_enable` and slot has name/code). The scheduler may set `enabled`, `enabled_by_scheduler`, then call `_do_push_code_to_lock(slot)`, which sets the code on the lock.

Things that can still prevent activation:

- **Stale lock state**: If the lock already had the code, `code_on_lock` could be True and the scheduler would skip (no change).
- **Slot not in user data** or **no schedule** or **no name/code** → scheduler skips.
- **`do_not_auto_enable` is True** (you disabled the slot) → scheduler does not re-enable.

---

## 6. Scheduler clears code and slot when schedule ends

When the **schedule ends** (current time moves past `end`):

- `async_check_schedules()` computes `valid_now = False`, `should_be_on_lock = False`, and if the code is still on the lock, `code_on_lock = True`, so it calls `await self._do_push_code_to_lock(slot)` to clear the code from the lock.
- After the clear, the scheduler also **clears the slot's local cache** via `_clear_slot_local_cache(slot)` (name, code, schedule, flags, etc.), saves, and updates entity state. The slot becomes **available for reuse**; you can configure it again with a new schedule.

So:

- **Activation (schedule starts)** works: scheduler may auto-enable the slot once (if not `do_not_auto_enable`), then calls `_do_push_code_to_lock(slot)`, which sets the code when `should_be_on_lock` is True.
- **Deactivation (schedule ends)** works: scheduler calls `_do_push_code_to_lock(slot)` to clear the code, then clears the slot's local cache so the slot is available for reuse.

---

## 7. Quick reference: data flow

- **User data** (including `schedule`, `enabled`, `lock_code`, `lock_status_from_lock`, `do_not_auto_enable`, `enabled_by_scheduler`) lives in `coordinator._user_data["users"][slot_str]`, backed by storage.
- **Lock state** (`lock_code`, `lock_status_from_lock`) is updated when:
  - You run **Refresh from Lock** (pull), or
  - A **Push** (manual or via scheduler via `_do_push_code_to_lock`) completes and verification runs.
- The scheduler **does not** refresh the lock before checking; it uses whatever is currently in `user_data`. So if you never refreshed, `lock_status_from_lock` / `lock_code` may be empty/None and `code_on_lock` may be False, which is correct for "code not on lock yet".
