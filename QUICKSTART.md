# Quick Start Guide

Get Yale Lock Manager running in a few steps.

## Prerequisites

- Home Assistant 2026.1.2 or later
- Z-Wave JS installed and configured
- Yale Smart Door Lock paired with Z-Wave JS

## 1. Install the integration

**HACS**

1. HACS → Integrations → ⋮ → Custom repositories
2. Add `https://github.com/Wayne-WECIT/HA-Yale-Lock`, category Integration
3. Install **Yale Lock Manager**, restart Home Assistant

**Manual**

1. Download latest release, copy `custom_components/yale_lock_manager` into `custom_components`
2. Restart Home Assistant (card/panel files are copied to `www/yale_lock_manager/` when the integration loads)

## 2. Add the integration

1. **Settings** → **Devices & Services** → **+ Add Integration**
2. Search **Yale Lock Manager**, select your Yale lock → **Submit**

You get a new device **Smart Door Lock Manager** with lock entity, battery, last-access sensors, and door/bolt binary sensors. Your original Z-Wave lock device stays as a separate device.

## 3. Add the card or panel

**Card**

1. **Settings** → **Dashboards** → ⋮ → **Resources** → **+ Add Resource**
2. URL: `/local/yale_lock_manager/yale-lock-manager-card.js`, type **JavaScript Module** → **Create**
3. Edit a dashboard → Add card → **Custom: Yale Lock Manager Card**
4. Set **entity** to your lock (e.g. `lock.smart_door_lock_manager`)

**Panel (full page)**

Add the panel for a full-page UI with the same features. See [PANEL_SETUP.md](PANEL_SETUP.md).

## 4. First-time setup

**Refresh from lock** (if you already have codes on the lock)

- In the card or panel, click **Refresh** (or **Refresh from Lock**).
- Or call service `yale_lock_manager.pull_codes_from_lock`.

**Add a user code**

1. Click an empty slot (e.g. Slot 3) to expand it.
2. Enter name and PIN (4–10 digits), leave type as PIN (or FOB if applicable).
3. Click **Set Code**, turn the slot **ON**, then click **Push** to send the code to the lock.

**Via services**

```yaml
service: yale_lock_manager.set_user_code
data:
  slot: 3
  code: "1234"
  name: "Guest"
  code_type: "pin"
```

Then push to the lock:

```yaml
service: yale_lock_manager.push_code_to_lock
data:
  slot: 3
```

## 5. Notifications (optional)

1. Expand a slot.
2. Turn **Notifications** on.
3. Use the chips to choose: **UI**, **All Mobiles**, or specific devices.
4. When that slot is used to unlock, notifications are sent to the chosen targets. See [NOTIFICATIONS.md](NOTIFICATIONS.md).

**Test from Developer Tools**

- **Developer Tools** → **Services** → `yale_lock_manager.send_test_notification`
- Choose your lock entity and slot → **Call service**.

## 6. Export / Import (backup)

- **Export**: Click **Export** or **Export backup**. Confirm the warning (file contains PINs; store securely), then **Download**. Saves a JSON file (e.g. `yale_lock_manager_backup_YYYY-MM-DD.json`).
- **Import**: Click **Import backup**. Read the notice (replaces all stored data; lock not updated until you Push), then **Choose backup file**. Select your JSON backup; after success, use **Push** on slots you want to sync to the lock.

## 7. Schedules and usage limits

**Schedule** (time window):

```yaml
service: yale_lock_manager.set_user_schedule
data:
  slot: 3
  start_datetime: "2026-01-01 00:00:00"
  end_datetime: "2026-01-31 23:59:59"
```

**Usage limit** (max uses):

```yaml
service: yale_lock_manager.set_usage_limit
data:
  slot: 3
  max_uses: 10
```

Configure the same in the card/panel in the expanded slot.

## Common tasks

- **Lock/Unlock**: Use the Lock/Unlock button in the card/panel header, or `lock.lock` / `lock.unlock` with the manager lock entity.
- **Disable a user**: Turn the slot **OFF** in the card/panel, or `yale_lock_manager.disable_user` with that slot.
- **Clear a slot**: In expanded slot, click **Clear** (with confirmation).
- **Clear all local data**: Use **Clear Local Cache** (with confirmation). Then use **Refresh from Lock** to reload from the lock.

## Troubleshooting

- **Lock not in setup** – Check Z-Wave JS and that the lock is paired and recognized as Yale.
- **Codes not syncing** – Click **Push**, wake the lock (press a button), check Z-Wave health.
- **Card/panel blank** – Ensure the resource is added and points to `/local/yale_lock_manager/`; clear browser cache.
- **Notifications not received** – See [NOTIFICATIONS.md](NOTIFICATIONS.md); test with `send_test_notification`.

## Next steps

- [README.md](README.md) – Full feature list and services
- [NOTIFICATIONS.md](NOTIFICATIONS.md) – Notification setup and troubleshooting
- [PANEL_SETUP.md](PANEL_SETUP.md) – Add the full-page panel to the sidebar
