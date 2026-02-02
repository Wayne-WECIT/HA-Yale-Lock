# Yale Lock Manager for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)
[![Version](https://img.shields.io/github/v/release/Wayne-WECIT/HA-Yale-Lock)](https://github.com/Wayne-WECIT/HA-Yale-Lock/releases)
[![License](https://img.shields.io/github/license/Wayne-WECIT/HA-Yale-Lock)](LICENSE)

A Home Assistant custom integration for managing Yale front door locks via Z-Wave JS. Control user codes (PINs and FOBs), time-based access, usage limits, per-slot notifications, and backup/restore—with a Lovelace card and a full-page panel.

## Features

- **Lock control** – Lock and unlock your Yale Z-Wave lock from Home Assistant
- **User codes** – Up to 20 slots with names, PINs or FOB/RFID, enable/disable
- **Time-based access** – Start/end dates and times per slot
- **Usage limits** – Max uses per code; auto-disable when limit reached
- **Per-slot notifications** – Choose where to send access alerts: UI only, All Mobiles, or specific devices (chips in expanded slot)
- **Export/Import backup** – Download user/slot data as JSON; restore from backup with confirmations (sensitive-data warning for export; import replaces all stored data; lock not updated until you Push)
- **Slot protection** – Prevents overwriting slots that contain unknown codes
- **Manual sync** – You decide when to push codes to the lock or refresh from the lock
- **Sensors** – Battery, door, bolt, last access (timestamp, user, method)
- **Events** – For automations: access, code expired, usage limit reached, etc.

## Requirements

- Home Assistant 2026.1.2 or later
- Z-Wave JS integration configured and running
- Yale Smart Door Lock paired with Z-Wave JS (e.g. P-KFCON-MOD-YALE)

## Installation

### HACS (recommended)

1. In Home Assistant: **HACS** → **Integrations** → **⋮** → **Custom repositories**
2. Add `https://github.com/Wayne-WECIT/HA-Yale-Lock`, category **Integration**, then **Add**
3. Search for **Yale Lock Manager**, install, then restart Home Assistant

### Manual

1. Download the latest release from [releases](https://github.com/Wayne-WECIT/HA-Yale-Lock/releases)
2. Copy `custom_components/yale_lock_manager` into your Home Assistant `custom_components` folder
3. Restart Home Assistant (the integration copies the card and panel files into `www/yale_lock_manager/` on first load)

## Configuration

### Add the integration

1. **Settings** → **Devices & Services** → **+ Add Integration**
2. Search for **Yale Lock Manager**, select your Yale lock, then **Submit**

Only one lock is supported per integration instance. A new device **Smart Door Lock Manager** is created with its own lock entity and sensors.

### Lovelace card

1. **Settings** → **Dashboards** → **⋮** → **Resources** → **+ Add Resource**
2. URL: `/local/yale_lock_manager/yale-lock-manager-card.js`, type: **JavaScript Module**, **Create**
3. On a dashboard, add card → **Custom: Yale Lock Manager Card**, set entity to your Yale Lock Manager lock (e.g. `lock.smart_door_lock_manager`)

Example YAML:

```yaml
type: custom:yale-lock-manager-card
entity: lock.smart_door_lock_manager
```

### Panel (full-page UI)

Use the panel for a full-page view with the same features as the card. See [PANEL_SETUP.md](PANEL_SETUP.md) for adding it to the sidebar or via YAML.

## Device structure

The integration creates a **Smart Door Lock Manager** device (separate from the Z-Wave lock device):

- `lock.smart_door_lock_manager` – Lock/unlock
- `sensor.smart_door_lock_manager_battery`
- `sensor.smart_door_lock_manager_last_access` / `last_user` / `last_access_method`
- `binary_sensor.smart_door_lock_manager_door` / `bolt`

Use this device (and its lock entity) for the card, panel, and services. The original Z-Wave lock device remains for low-level Z-Wave control.

## Usage

### Card and panel

- **Header**: Lock/Unlock, Refresh, Export (opens confirmation: backup contains PINs; download anyway?)
- **Table**: Slot, Name, Type, Status, Synced, Last Used. Click a row to expand.
- **Expanded slot**: Name, code, type, status, schedule, usage limit, **Notifications** (toggle + chips: UI, All Mobiles, or specific devices), Set Code, Push, Clear, etc.
- **Bottom**: Export backup / Import backup (both show confirmations), Clear Local Cache, Debug panel

Export: confirmation warns that the file contains sensitive data; after **Download**, a JSON file is saved (e.g. `yale_lock_manager_backup_YYYY-MM-DD.json`). Store it securely.

Import: confirmation explains that import replaces all stored user/slot data and the lock is not updated until you Push; **Choose backup file** opens the file picker; after selecting a valid JSON backup, data is restored and the UI refreshes.

### Services

**User codes**

- `yale_lock_manager.set_user_code` – slot, code, name, code_type (pin/fob), optional override_protection
- `yale_lock_manager.clear_user_code` – slot
- `yale_lock_manager.enable_user` / `disable_user` – slot

**Schedules and limits**

- `yale_lock_manager.set_user_schedule` – slot, start_datetime, end_datetime
- `yale_lock_manager.set_usage_limit` – slot, max_uses
- `yale_lock_manager.reset_usage_count` – slot

**Sync**

- `yale_lock_manager.push_code_to_lock` – slot (push one slot to the lock)
- `yale_lock_manager.pull_codes_from_lock` – refresh from lock (no slot)

**Notifications**

- `yale_lock_manager.set_notification_enabled` – entity_id, slot, enabled, notification_services (list)
- `yale_lock_manager.send_test_notification` – entity_id, slot (optional). Sends a test notification to the slot’s configured services (e.g. from Developer Tools or automations). No test button in the UI.

**Backup**

- `yale_lock_manager.import_user_data` – entity_id (optional), data (dict, backup JSON). Restores user/slot data; validate that `data` has a `users` object. Export is done from the card/panel (downloads JSON).

**Cache**

- `yale_lock_manager.clear_local_cache` – entity_id. Clears all locally stored user data; use Refresh from lock to repopulate.

### Automations

**Access event** (e.g. keypad unlock):

```yaml
trigger:
  - platform: event
    event_type: yale_lock_manager_access
action:
  - service: notify.mobile_app_iphone  # or your device
    data:
      message: "{{ trigger.event.data.user_name }} unlocked the door"
```

**Code expired / usage limit reached**

- `yale_lock_manager_code_expired`
- `yale_lock_manager_usage_limit_reached`

**Schedule started / ended** (auto-schedule checker)

- `yale_lock_manager_schedule_started` – fired when a code is pushed onto the lock because its schedule became valid.
- `yale_lock_manager_schedule_ended` – fired when a code is cleared from the lock because its schedule became invalid.

Event data typically includes `user_slot`, `user_name`, `timestamp`, and (where relevant) `usage_count`, `schedule_start`, `schedule_end`.

### Example automations

**Notify when a specific user unlocks** (e.g. slot 3 or by name):

```yaml
trigger:
  - platform: event
    event_type: yale_lock_manager_access
    event_data:
      user_slot: 3
action:
  - service: notify.mobile_app_iphone
    data:
      title: "Door unlocked"
      message: "{{ trigger.event.data.user_name }} (Slot {{ trigger.event.data.user_slot }}) unlocked the door via {{ trigger.event.data.method }}"
```

**Notify on any unlock** (all users):

```yaml
trigger:
  - platform: event
    event_type: yale_lock_manager_access
action:
  - service: notify.mobile_app_iphone
    data:
      message: "{{ trigger.event.data.user_name }} unlocked the door at {{ trigger.event.data.timestamp }}"
```

**Notify when a code has expired** (someone tried an out-of-schedule or expired code):

```yaml
trigger:
  - platform: event
    event_type: yale_lock_manager_code_expired
action:
  - service: notify.persistent_notification
    data:
      message: "{{ trigger.event.data.user_name }}'s code has expired or is outside the schedule."
```

**Notify when usage limit is reached** (code auto-disabled after max uses):

```yaml
trigger:
  - platform: event
    event_type: yale_lock_manager_usage_limit_reached
action:
  - service: notify.mobile_app_iphone
    data:
      message: "{{ trigger.event.data.user_name }}'s code has reached its usage limit ({{ trigger.event.data.usage_count }} uses) and was disabled."
```

**Battery low alert** (use your lock manager battery sensor entity):

```yaml
trigger:
  - platform: numeric_state
    entity_id:
      - sensor.smart_door_lock_manager_battery
    below: 20
action:
  - service: notify.mobile_app_iphone
    data:
      title: "Lock battery low"
      message: "Yale lock battery is at {{ states('sensor.smart_door_lock_manager_battery') }}%. Consider replacing soon."
```

**Notify when a guest code becomes active** (schedule started – auto-schedule checker pushed the code):

```yaml
trigger:
  - platform: event
    event_type: yale_lock_manager_schedule_started
action:
  - service: notify.mobile_app_iphone
    data:
      message: "Guest code for {{ trigger.event.data.user_name }} (Slot {{ trigger.event.data.slot }}) is now active."
```

**Send a temporary code to a visitor** (manual flow: create the code in the card/panel, then send it via notification):

```yaml
# Example: run from a script or automation trigger (e.g. button, Alexa)
# 1. Create the guest code in Yale Lock Manager (slot, schedule, etc.)
# 2. Call this script with slot number and visitor's notify target
action:
  - service: notify.mobile_app_visitor_phone
    data:
      title: "Your door code"
      message: "Your temporary code is [add code manually or use a template]. It is valid until [end time]."
```

### Options (schedule check interval)

In **Settings → Devices & Services → Yale Lock Manager → Configure** you can set **Schedule check interval (minutes)** (1–60, default 5). The value is set with an editable number field and up/down arrows. This is how often the integration checks schedules and automatically pushes or clears codes when a schedule starts or ends. Saving options reloads the integration so the new interval takes effect.

### Notifications (per-slot)

Notifications are configured in the **expanded slot** in the card or panel:

1. Turn **Notifications** on for that slot.
2. Choose one or more targets with the **chips**: **Persistent Notification (UI)**, **All Mobiles** (all `notify.mobile_app_*` devices), or individual devices (e.g. iPhone, Android).
3. Selections are saved immediately.

When that slot is used to access the lock, the integration sends to the selected services. “All Mobiles” is expanded by the backend to all registered mobile app notify services. For more detail see [NOTIFICATIONS.md](NOTIFICATIONS.md).

### FOB/RFID

FOBs and RFID cards are usually programmed on the lock. Use **Refresh from Lock** so the integration sees them. Slots that contain a FOB show as FOB type; you can set schedules and usage limits but not the FOB code itself via HA.

## Slot protection

If a slot already has a code that was not set through this integration (e.g. unknown code), the integration blocks overwriting it. Clear the slot first, or use the override option in the service (use with care).

## Duplicate PIN

The same PIN cannot be used in more than one slot. If you try to save a code that is already used in another slot, the card/panel shows an error and the backend rejects the change. Use a different PIN for each slot.

## Troubleshooting

- **Lock not in setup** – Ensure the lock is paired with Z-Wave JS and is a Yale lock.
- **Codes not syncing** – Use **Push** in the card/panel; wake the lock (e.g. press a button); check Z-Wave network health; try **Refresh from Lock**.
- **Card/panel not loading** – Ensure the resource is added (`/local/yale_lock_manager/yale-lock-manager-card.js`) and, if needed, clear browser cache.
- **Notifications not received** – Check [NOTIFICATIONS.md](NOTIFICATIONS.md); ensure the mobile app is registered and notification permissions are granted; use **Developer Tools** → **Services** → `yale_lock_manager.send_test_notification` to test a slot.

## Version and changelog

Current version: **1.8.4.49**

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests and issues are welcome.

## License and disclaimer

MIT License. See [LICENSE](LICENSE). This integration is not affiliated with or endorsed by Yale or ASSA ABLOY. Use at your own risk.
