# Lock Code Manager Research Findings

## Overview
Research into `lock_code_manager` (https://github.com/raman325/lock_code_manager) to identify improvements for our Yale Lock Manager implementation.

## Key Differences

### 1. Z-Wave JS Integration Approach

**lock_code_manager:**
- Uses **Z-Wave JS services** (`zwave_js.set_lock_usercode`, `zwave_js.clear_lock_usercode`)
- These are higher-level services provided by the Z-Wave JS integration
- Services handle parameter formatting internally
- No direct `invoke_cc_api` calls

**Our Implementation:**
- Uses **`invoke_cc_api`** directly with `[userId, userIdStatus, userCode]` parameters
- Manual parameter type conversion and validation
- Direct control over parameter format

**Key Insight:** The Z-Wave JS services may handle status changes differently than our direct `invoke_cc_api` approach. However, these services likely call `invoke_cc_api` internally with the same parameters.

### 2. Status Management

**lock_code_manager:**
- **Does NOT explicitly set status** when setting codes
- Uses `SERVICE_SET_LOCK_USERCODE` which only takes `code_slot` and `usercode`
- Status is managed separately through:
  - **Binary sensor** (`active`) - reflects if slot is active based on conditions
  - **Switch** (`enabled`) - user-controlled enable/disable toggle
  - Status is **derived** from whether the code exists on the lock, not explicitly set

**Our Implementation:**
- **Explicitly sets status** via `userIdStatus` parameter in `invoke_cc_api`
- Tries to set status to `ENABLED` (1) or `DISABLED` (2) directly
- **This is the source of our problem** - the lock may not accept status changes via Z-Wave

**Key Insight:** lock_code_manager doesn't try to set status explicitly - they let the lock manage status based on whether a code exists. They use Home Assistant entities (switches, binary sensors) to track desired state, but don't push status to the lock.

### 3. Code Synchronization

**lock_code_manager:**
- Uses **push-based updates** via Z-Wave JS value update events
- Subscribes to `value updated` events from Z-Wave JS
- Real-time updates when lock state changes
- **No verification after setting codes** - relies on push updates to confirm
- Uses `coordinator.push_update()` to update state when events arrive

**Our Implementation:**
- Uses **polling** with verification after push
- Actively verifies code was set correctly
- Polls entity state after push to confirm changes
- More robust but slower

**Key Insight:** Their push-based approach is more efficient but relies on the lock sending value update events. Our verification approach is more reliable but slower.

### 4. Architecture Patterns

**lock_code_manager:**
- **Provider pattern** - abstract base class (`BaseLock`) with provider-specific implementations
- **Coordinator pattern** - separate coordinator for managing code updates
- **Entity-based state** - uses Home Assistant entities (text, switch, binary_sensor) to track state
- **Callback registry** - type-safe callback system for entity lifecycle

**Our Implementation:**
- **Monolithic coordinator** - single coordinator handles all operations
- **Direct state management** - stores state in coordinator data
- **Service-based** - uses Home Assistant services for operations

**Key Insight:** Their provider pattern allows supporting multiple lock types (Z-Wave JS, virtual, etc.) with a common interface. Our approach is more tightly coupled to Z-Wave JS.

### 5. Status Change Handling

**lock_code_manager:**
- **No explicit status setting** - they don't try to set `userIdStatus` via Z-Wave
- Status is **derived** from lock state:
  - If code exists on lock → status is "in use"
  - If code doesn't exist → status is "available"
- Enable/disable is **local state only** - managed via Home Assistant switch entity
- When enabling: sets code on lock (if not already set)
- When disabling: clears code from lock (if code exists)

**Our Implementation:**
- **Explicitly sets status** via `userIdStatus` parameter
- Tries to set status to `ENABLED` (1) or `DISABLED` (2)
- **Problem:** Lock doesn't accept status changes when code is unchanged
- **Workaround:** Code modification approach (temporarily change code, then set back)
- **Current solution:** Graceful degradation - detect limitation, update cached status only

**Key Insight:** lock_code_manager's approach avoids the status change limitation entirely by not trying to set status explicitly. They manage enable/disable state locally and only push code changes to the lock.

## Potential Improvements for Our Implementation

### 1. Use Z-Wave JS Services Instead of invoke_cc_api

**Option:** Switch from `invoke_cc_api` to `zwave_js.set_lock_usercode` service

**Pros:**
- Higher-level abstraction
- May handle edge cases better
- Less code to maintain

**Cons:**
- Less control over parameters
- May not solve status change issue (service likely calls `invoke_cc_api` internally)
- Need to verify service supports status parameter

**Recommendation:** Investigate if `zwave_js.set_lock_usercode` accepts a status parameter. If not, it won't help with our status change issue.

### 2. Adopt lock_code_manager's Status Management

**Option:** Don't try to set status explicitly - manage enable/disable locally

**Approach:**
- Remove `userIdStatus` parameter from `invoke_cc_api` calls
- Manage enable/disable state in Home Assistant only
- When enabling: set code on lock (if not set)
- When disabling: clear code from lock (if code exists)
- Status on lock is derived from whether code exists

**Pros:**
- Avoids status change limitation entirely
- Simpler implementation
- More reliable (no verification needed for status)

**Cons:**
- Breaking change - users expect status to be set on lock
- May not match user expectations (status on lock may not match local state)
- Requires clearing code to disable (may not be desired behavior)

**Recommendation:** This is a significant architectural change. Consider as a future enhancement, but not a quick fix.

### 3. Push-Based Updates

**Option:** Subscribe to Z-Wave JS value update events instead of polling

**Approach:**
- Subscribe to `zwave_js_value_updated` events
- Listen for User Code CC value updates
- Update coordinator state when events arrive
- Remove polling after push operations

**Pros:**
- More efficient (real-time updates)
- Less network traffic
- Faster UI updates

**Cons:**
- Requires Z-Wave JS to send events (may not be reliable)
- More complex event handling
- May miss updates if events are missed

**Recommendation:** Consider as an enhancement, but keep verification as fallback.

### 4. Provider Pattern

**Option:** Refactor to use provider pattern like lock_code_manager

**Approach:**
- Create `BaseLock` abstract class
- Implement `ZWaveJSLock` provider
- Allow future providers (e.g., virtual lock for testing)

**Pros:**
- More extensible
- Better code organization
- Easier to test

**Cons:**
- Major refactoring effort
- May not solve current issues
- Over-engineering for single provider

**Recommendation:** Consider for future if planning to support multiple lock types.

## Conclusion

The main insight from lock_code_manager is that **they don't try to set status explicitly**. They manage enable/disable state locally and only push code changes to the lock. This avoids the status change limitation we're experiencing.

However, this is a significant architectural change that may not match user expectations. Our current graceful degradation approach (detect limitation, update cached status, show warning) is a reasonable compromise.

**Recommended Next Steps:**
1. Investigate if `zwave_js.set_lock_usercode` service accepts status parameter
2. Consider push-based updates for better performance
3. Keep current graceful degradation approach for status changes
4. Document the limitation clearly for users

---

## Keymaster Usage Tracking Analysis

Research into `keymaster` (https://github.com/FutureTense/keymaster) to compare PIN usage tracking implementation with our Yale Lock Manager.

### Key Differences Identified

#### 1. Storage Architecture

**Keymaster:**
- Uses Home Assistant entities (`input_number.accesscount_LOCKNAME_TEMPLATENUM`)
- Uses `input_boolean.accesslimit_LOCKNAME_TEMPLATENUM` to enable/disable limits
- Values are visible in Home Assistant UI as entities
- Persisted automatically by Home Assistant

**Our System:**
- Uses JSON storage (`.storage/yale_lock_manager.users`)
- Stores `usage_count` and `usage_limit` in user_data dictionary
- Not exposed as separate entities
- Requires manual save via `async_save_user_data()`

#### 2. Usage Tracking Direction

**Keymaster:**
- **Decrements** count when unlock occurs (countdown approach)
- Starts with a limit value (e.g., 10)
- Decrements to 0, then code becomes invalid
- Automation: `input_number.decrement` on keypad unlock events (action codes 6 or 19)

**Our System:**
- **Increments** count when access occurs (count-up approach)
- Starts at 0
- Increments until reaching limit, then auto-disables
- Logic: `usage_count = user_data.get("usage_count", 0) + 1`

#### 3. Enforcement Mechanism

**Keymaster:**
- Checks count **before** enabling code slot
- Template condition: `(not is_access_limit_enabled or is_access_count_valid)`
- Code slot binary sensor becomes `off` when count reaches 0
- Prevents code from working when limit reached (preventive)

**Our System:**
- Checks count **after** access occurs
- Auto-disables user when `usage_count >= usage_limit`
- Fires `EVENT_USAGE_LIMIT_REACHED` event
- Calls `async_disable_user()` to disable the slot (reactive)

#### 4. Event Detection

**Keymaster:**
- Listens to `keymaster_lock_state_changed` events
- Filters for action codes 6 or 19 (Keypad Unlock)
- Uses Z-Wave alarm_type/access_control sensors
- Automation in `keymaster_common.yaml` decrements count on unlock

**Our System:**
- Listens to `zwave_js_value_updated` events
- Detects Notification CC events (access control notifications)
- Extracts user slot from notification data
- Handles in `_handle_access_event()` method in coordinator

#### 5. Architecture Approach

**Keymaster:**
- YAML-based with template generation
- Generates automations and entities dynamically
- Uses Home Assistant's native entity system
- More declarative, less programmatic
- Each code slot gets its own set of entities

**Our System:**
- Python-based coordinator pattern
- Centralized logic in `coordinator.py`
- Custom storage system
- More programmatic, centralized control
- All slots managed in single data structure

### Advantages of Each Approach

#### Keymaster Advantages:
1. **Visibility**: Usage counts visible as Home Assistant entities
2. **Integration**: Can be used in other automations easily
3. **Persistence**: Automatic persistence via Home Assistant
4. **Countdown Logic**: More intuitive (starts with limit, counts down)
5. **Preventive**: Prevents code from working when limit reached (proactive)
6. **Entity-Based**: Each slot has dedicated entities for easy monitoring

#### Our System Advantages:
1. **Centralized**: All logic in one place (coordinator)
2. **Event-Driven**: Fires events for automation integration
3. **Flexible**: Can easily add more logic (schedules, validation)
4. **Count-Up Logic**: Tracks actual usage (more intuitive for reporting)
5. **Reactive**: Auto-disables after limit reached (can still track over-limit usage)
6. **Simpler Storage**: Single JSON file vs multiple entities per slot

### Implementation Details

#### Keymaster Usage Tracking Flow:

1. **Initialization**: `input_number.accesscount_LOCKNAME_TEMPLATENUM` created with min: 0, max: 100
2. **Setting Limit**: User sets limit value in the input_number entity
3. **Enabling Limit**: `input_boolean.accesslimit_LOCKNAME_TEMPLATENUM` turned on
4. **Auto-Enable**: Automation turns on `accesslimit` boolean when count > 0
5. **Decrement on Unlock**: Automation decrements count when keypad unlock detected
6. **Validation**: Binary sensor checks `(not is_access_limit_enabled or is_access_count_valid)` before allowing code to work
7. **Reset**: Script resets count to 0 when slot is reset

#### Our Usage Tracking Flow:

1. **Initialization**: `usage_count` and `usage_limit` stored in user_data dictionary
2. **Setting Limit**: User sets limit via `set_usage_limit` service
3. **Access Detection**: `_handle_access_event()` called on unlock notification
4. **Increment**: `usage_count = user_data.get("usage_count", 0) + 1`
5. **Check Limit**: If `usage_count >= usage_limit`, fire event and disable user
6. **Auto-Disable**: `async_disable_user()` clears code from lock
7. **Reset**: `reset_usage_count` service resets count to 0

### Potential Improvements for Our System

#### 1. Expose Usage Count as Entity (Optional)
- Create `sensor.yale_lock_manager_slot_X_usage_count` entities
- Sync with our internal `usage_count` values
- Allows visibility and integration with other automations
- **Trade-off**: More entities to manage, but better Home Assistant integration

#### 2. Add Countdown Mode (Optional)
- Allow user to choose count-up or countdown mode
- Countdown: Start with limit, decrement to 0 (like keymaster)
- Count-up: Start at 0, increment to limit (current)
- **Trade-off**: More complexity, but matches keymaster's approach

#### 3. Preventive Enforcement (Consider)
- Check usage limit before allowing code to work
- Similar to keymaster's template condition approach
- Would require checking in `_is_code_valid()` method
- **Trade-off**: Prevents over-limit usage, but requires validation on every access check

#### 4. Better Event Integration
- Our event system is already good (`EVENT_USAGE_LIMIT_REACHED`)
- Could add more granular events (`usage_count_changed`, etc.)
- **Trade-off**: More events, but better automation integration

### Code References

#### Keymaster Files:
- `custom_components/keymaster/keymaster.yaml` - Template for usage tracking entities
- `custom_components/keymaster/keymaster_common.yaml` - Decrement automation (lines 241-263)
- Generated YAML files show full implementation with `accesscount` and `accesslimit` entities

#### Our System Files:
- `custom_components/yale_lock_manager/coordinator.py` - `_handle_access_event()` method (lines 158-217)
- `custom_components/yale_lock_manager/services.py` - `set_usage_limit` and `reset_usage_count` services
- `custom_components/yale_lock_manager/www/yale-lock-manager-card.js` - UI display of usage counts

### Recommendations

1. **Keep Current Approach**: Our count-up approach is more intuitive for reporting and tracking actual usage. It's easier to understand "used 5 times out of 10" than "5 uses remaining out of 10".

2. **Consider Entity Exposure**: Optionally expose usage counts as sensors for better Home Assistant integration. This would allow users to create automations based on usage counts without needing to parse our events.

3. **Maintain Event System**: Our event-driven approach is more flexible than keymaster's template-based system. Events can be used in automations, scripts, and other integrations.

4. **Document Differences**: Create documentation explaining why we chose count-up vs countdown, and the advantages of each approach.

5. **Preventive Enforcement**: Consider adding a check in `_is_code_valid()` to prevent codes from working when limit is reached, similar to keymaster's approach. This would be more secure but requires careful implementation to avoid race conditions.

### Conclusion

Keymaster's approach uses Home Assistant entities for visibility and a countdown system that prevents codes from working when the limit is reached. Our approach uses centralized storage with count-up tracking and reactive disabling.

Both approaches have merit:
- **Keymaster**: Better for users who want entity-based monitoring and preventive enforcement
- **Our System**: Better for centralized management and flexible event-driven automations

The main difference is architectural: keymaster is more declarative (YAML templates), while ours is more programmatic (Python coordinator). Neither is inherently better - they serve different use cases and preferences.
