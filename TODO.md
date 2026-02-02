# TODO - Yale Lock Manager

**Current Version**: 1.8.4.49  
**Last Updated**: 2026-01-27

---

## 🔒 Security Enhancements

### Priority: MEDIUM
Important for production use, but not blocking.

- [ ] **Implement code encryption in storage**
  - Currently codes are stored in plain text in `.storage/yale_lock_manager.users`
  - Use Home Assistant's encryption utilities
  - Encrypt codes before saving
  - Decrypt codes when loading
  - Maintain backward compatibility (migrate existing codes)

---

## ✨ New Features

### Priority: MEDIUM
Features that would enhance functionality but aren't critical.

- [ ] **Multi-lock support**
  - Currently only one lock can be configured
  - Add ability to manage multiple locks
  - Update config flow to allow adding multiple locks
  - Update card to support lock selection
  - Separate storage per lock

- [x] **Auto-schedule checker** *(completed 2026-01-27)*
  - [x] Background task runs periodically (interval configurable via integration options, 1–60 min, default 5)
  - [x] Automatically push code to lock when schedule starts; clear from lock when schedule expires
  - [x] Events: `yale_lock_manager_schedule_started`, `yale_lock_manager_schedule_ended`
  - [x] Options flow: Settings → Yale Lock Manager → Configure → Schedule check interval (minutes)
  - [x] Schedule validity uses `dt_util.now()` (HA time zone)

- [x] **Duplicate code warning** *(completed 2026-01-27)*
  - [x] Backend: `async_set_user_code` rejects duplicate PIN (raises ValueError with slot number)
  - [x] Frontend (card + panel): `saveUser()` checks other slots for same PIN and blocks save with error message
  - [x] Documented in README (Duplicate PIN section)

- [ ] **Bulk operations**
  - Service: `set_multiple_codes` - Set codes for multiple slots
  - Service: `clear_multiple_codes` - Clear multiple slots
  - Service: `enable_multiple_users` - Bulk enable
  - Service: `disable_multiple_users` - Bulk disable
  - Add bulk actions to card UI

- [x] **Import/export functionality** *(completed 2026-01-27)*
  - [x] WebSocket `export_user_data` + Export backup (JSON download)
  - [x] Service `import_user_data` + Import backup (file picker)
  - [x] Export/Import buttons on card and panel
  - [x] Export confirmation (sensitive-data warning before download)
  - [x] Import confirmation (notice: replaces all data, lock not updated until Push)
  - [ ] Include encryption for exported files *(optional future enhancement)*

- [ ] **Lock history/access logs**
  - Store access history in database
  - Add sensor showing last 10 access events
  - Create history panel in card
  - Add filtering by user, date, method
  - Export history to CSV

- [ ] **Temporary codes**
  - Service: `generate_temporary_code` - Auto-generate PIN
  - Auto-set schedule (e.g., 24 hours)
  - Auto-clear code after expiry
  - Option to send code via notification

- [ ] **User groups/categories**
  - Add `category` field to users (e.g., "Family", "Guest", "Service")
  - Filter card by category
  - Bulk operations by category
  - Different icons per category

---

## 🐛 UI/UX Improvements

### Priority: LOW
Nice-to-have improvements for better user experience.

- [ ] **Card auto-refresh improvements**
  - Currently card updates manually after service calls
  - Implement WebSocket listener for real-time updates
  - Auto-refresh card when user data changes
  - Add loading spinners for async operations

- [ ] **Card UI enhancements**
  - Add search/filter for user slots
  - Show last used timestamp in slot row
  - Add "Quick Add" mode for faster code entry
  - Improve mobile responsive design
  - Add dark mode optimizations
  - Show usage count in slot row

- [ ] **Better error messages**
  - More descriptive errors in card alerts
  - Toast notifications instead of alerts
  - Error banner with retry button
  - Validation feedback in real-time

- [ ] **Optimize push verification flow**
  - Currently: After "Push Required" button, we query lock twice (once in `async_push_code_to_lock` verification, once in `check_sync_status`)
  - Options to consider:
    1. Remove redundant `check_sync_status` call after push (push already verifies)
    2. Keep both but optimize (single source of truth)
    3. Enhanced verification in push with delay before refresh
    4. Keep current behavior (double-check for accuracy)
  - Decision needed: Which approach provides best balance of speed vs reliability?

---

## 📚 Documentation

### Priority: MEDIUM
Important for user adoption and support.

- [x] **Example automations** *(completed 2026-01-27)*
  - [x] Added "Example automations" section to README with full YAML examples
  - [x] Notify when specific user unlocks (by user_slot), any unlock, code expired, usage limit reached
  - [x] Battery low alert (numeric_state), send temporary code to visitor (script/notification)

- [ ] **Comprehensive troubleshooting guide**
  - "No locks found" - How to fix
  - "Slot occupied" - How to resolve
  - "Code not syncing" - Wake lock procedure
  - "Card not loading" - Resource issues
  - Z-Wave network health tips
  - Debug logging instructions

- [ ] **API documentation**
  - Document all services with examples
  - Document all events with data structure
  - Document entity attributes
  - Document storage format

---

## 🔄 HACS & Release

### Priority: HIGH
Important for distribution and updates.

- [ ] **HACS validation**
  - Test installation via HACS custom repository
  - Verify update process works
  - Test uninstall/reinstall
  - Verify card file copying works
  - Check GitHub releases work correctly

- [ ] **Release process**
  - Validate GitHub Actions workflows
  - Test release creation
  - Verify CHANGELOG format
  - Test version bumping process

---

## 🚀 Future Ideas (Low Priority)

These are ideas for future major versions:

- [ ] **Mobile app integration**
  - Rich push notifications
  - Quick actions for lock/unlock
  - Widget for iOS/Android

- [ ] **Cloud backup**
  - Optional cloud backup of user codes
  - Sync across multiple HA instances

- [ ] **Voice assistant integration**
  - "Alexa, add guest code 1234"
  - "Hey Google, enable guest user"

- [ ] **Advanced scheduling**
  - Recurring schedules (e.g., weekdays only)
  - Time of day restrictions
  - Holiday calendars

- [ ] **Geofencing integration**
  - Auto-enable codes when person arrives
  - Auto-disable when person leaves

- [ ] **Integration with other platforms**
  - MQTT support
  - REST API
  - Node-RED nodes

---

## ✅ Completed Features

These have been implemented (through v1.8.4.49):

- ✅ Full lock/unlock control
- ✅ User code management (20 slots)
- ✅ PIN and FOB support
- ✅ Time-based scheduling
- ✅ Usage limits
- ✅ Slot protection
- ✅ Local storage (`.storage/yale_lock_manager.users`)
- ✅ Lovelace card with inline controls
- ✅ All core services (set, clear, enable, disable, push, pull)
- ✅ Event firing for automations
- ✅ Battery, door, bolt sensors
- ✅ Last access sensors
- ✅ Config flow
- ✅ HACS compatibility
- ✅ Documentation (README, QUICKSTART, CHANGELOG)
- ✅ GitHub repository setup
- ✅ Auto-versioning and releases
- ✅ **Export/Import backup** – Export user/slot data to JSON; import from backup with confirmations (sensitive-data warning for export; notice that import replaces all data and lock not updated until Push)
- ✅ **Notification services** – Per-slot notification targets (UI, All Mobiles, individual devices); backend expands "All Mobiles" to all `notify.mobile_app_*` services
- ✅ **Test notification** – Backend service `send_test_notification` (entity_id, slot) for Developer Tools/automations (UI test buttons removed)
- ✅ **Panel** – Full-page Yale Lock Manager panel with same features as card
- ✅ **Duplicate PIN warning** – Backend rejects duplicate PIN across slots; card/panel block save with error
- ✅ **Example automations** – README section with YAML examples (specific user, any unlock, code expired, usage limit, battery low, send code to visitor)
- ✅ **Auto-schedule checker** – Periodic task (configurable interval 1–60 min) pushes/clears codes when schedules start/end; events `schedule_started` / `schedule_ended`; options flow for interval

---

## 🧹 Code Cleanup & Optimization

### Priority: LOW
Code quality improvements and optimizations that don't affect functionality.

- [x] **Remove redundant sync check after save** *(verified 2026-01-27)*
  - Verified: `async_set_user_code` does **not** query the lock; it uses existing `lock_code` / `lock_status_from_lock` from storage and computes `synced_to_lock` from them.
  - Verified: Frontend (card and panel) do **not** call `check_sync_status` after save or after push; they only use entity state (`getUserData()`) to show sync status.
  - No redundant lock query after save; no code change required.

## 📝 Notes

### Known Limitations
- Some Yale locks don't expose user codes via Z-Wave (security feature)
- Pulling codes from lock may not work on all models
- Lock must be awake for Z-Wave commands (press any button)
- Z-Wave network health affects reliability

### Development Guidelines
- Follow Home Assistant development standards
- Update version in 3 places: `manifest.json`, `const.py`, `CHANGELOG.md`
- Use X.X.X.X versioning scheme
- Always test on real hardware before release
- Keep documentation up to date

---

**Legend:**
- 🧪 Testing required
- 🔒 Security related
- ✨ New feature
- 🐛 Bug fix / UX improvement
- 📚 Documentation
- 🔄 Release process
- 🚀 Future ideas

**Status:**
- [ ] Not started
- [x] Completed
