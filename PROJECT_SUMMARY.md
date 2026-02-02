# Yale Lock Manager - Project Summary

Overview of what the integration provides and how it is structured (as of v1.8.4.47).

---

## What’s included

### Integration (`custom_components/yale_lock_manager/`)

| File | Purpose |
|------|--------|
| `manifest.json` | Metadata, version, dependencies (zwave_js, websocket_api) |
| `const.py` | Constants, version, service names |
| `__init__.py` | Entry point, device/entity setup, WebSocket registration |
| `config_flow.py` | UI config flow (select lock) |
| `coordinator.py` | Data and Z-Wave logic, user data, refresh, push, pull, import, notifications |
| `lock.py` | Lock entity |
| `sensor.py` | Battery, last access, last user, last access method |
| `binary_sensor.py` | Door and bolt binary sensors |
| `services.py` | Service handlers (set/clear code, schedule, usage, push, pull, notifications, import, clear cache, test notification) |
| `services.yaml` | Service definitions for Developer Tools UI |
| `storage.py` | User data persistence (replace_users for import) |
| `websocket.py` | WebSocket commands: export_user_data, get_notification_services |
| `strings.json` | English UI strings |
| `translations/en.json` | Translations |

### Frontend (`www/`)

| File | Purpose |
|------|--------|
| `yale-lock-manager-card.js` | Lovelace card: table, expanded slot, notifications (chips), Export/Import with confirmations |
| `yale-lock-manager-panel.js` | Full-page panel: same behavior as card |
| `yale-lock-manager-panel.html` | Panel HTML entry |

### Docs and repo

| File | Purpose |
|------|--------|
| `README.md` | Main user docs |
| `QUICKSTART.md` | Short setup guide |
| `NOTIFICATIONS.md` | Per-slot notifications (chips, All Mobiles, test) |
| `PANEL_SETUP.md` | Adding the panel to sidebar / YAML |
| `CONTRIBUTING.md` | Contribution guidelines |
| `CHANGELOG.md` | Version history |
| `TODO.md` | Roadmap and completed items |
| `DEVICE_SPECS.md` | Yale lock Z-Wave specs |
| `RESEARCH_FINDINGS.md` | Notes on lock_code_manager / keymaster |
| `LICENSE` | MIT |

---

## Features (current)

### Core

- Lock/unlock via Home Assistant
- 20 user code slots: name, PIN or FOB, enable/disable
- Slot protection (no overwrite of unknown codes without override)
- Manual sync only: Push to lock, Refresh from lock

### Schedules and limits

- Time-based access (start/end datetime per slot)
- Usage limit per slot; auto-disable when limit reached
- Reset usage count service

### Notifications

- Per-slot: toggle + chips (UI, All Mobiles, or specific devices)
- Backend expands “All Mobiles” to all `notify.mobile_app_*` services
- Access events send to selected services
- Service `send_test_notification` (entity_id, slot) for Developer Tools/automations (no test button in UI)

### Backup

- **Export**: Card/panel “Export” / “Export backup” → confirmation (sensitive data) → download JSON (e.g. `yale_lock_manager_backup_YYYY-MM-DD.json`)
- **Import**: “Import backup” → confirmation (replaces all data; lock not updated until Push) → file picker → `import_user_data` service restores storage; user then Pushes slots to lock as needed

### UI

- Lovelace card and full-page panel with same behavior
- Table: slot, name, type, status, synced, last used
- Expanded slot: name, code, type, schedule, usage limit, notification chips, Set Code, Push, Clear, etc.
- Export/Import confirmations; Clear Local Cache confirmation
- Debug panel (card/panel)

### Services

1. `set_user_code` – Set/update code (slot, code, name, code_type, optional override_protection)
2. `clear_user_code` – Clear slot
3. `set_user_schedule` – Time window per slot
4. `set_usage_limit` – Max uses per slot
5. `reset_usage_count` – Reset count for slot
6. `push_code_to_lock` – Push one slot to lock
7. `pull_codes_from_lock` – Refresh from lock
8. `enable_user` / `disable_user` – Enable/disable slot
9. `set_notification_enabled` – Per-slot notification services (list)
10. `send_test_notification` – Test notification for a slot
11. `import_user_data` – Restore from backup (entity_id optional, data required)
12. `clear_local_cache` – Clear all local user data

### Events

- `yale_lock_manager_access` – User accessed lock
- `yale_lock_manager_code_expired` – Expired code used
- `yale_lock_manager_usage_limit_reached` – Limit reached
- `yale_lock_manager_locked` / `unlocked` / `jammed` (as implemented)

---

## Version and release

- **Current version**: 1.8.4.47
- **Scheme**: Major.Minor.Patch.Build
- **Update in**: `manifest.json`, `const.py`, `CHANGELOG.md`
- **Releases**: GitHub Actions (see `.github/workflows/`); HACS custom repo

---

## Limitations and future work

- **Single lock** – One lock per integration instance
- **Manual sync** – No automatic push to lock (by design)
- **FOB codes** – Read-only from lock; cannot set FOB code via Z-Wave
- **Storage** – User data (including PINs) in `.storage/`; export file is plain JSON (store securely)
- **Future ideas** – Multi-lock, code encryption in storage, bulk operations, lock history, etc. (see TODO.md)

---

## Security and storage

- User codes are stored in Home Assistant’s `.storage/yale_lock_manager.users`
- Export file contains PINs; users are warned and should store backups securely
- No encryption of exported files in current version

---

*Last updated: 2026-01-27 | Version: 1.8.4.47*
