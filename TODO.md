# TODO - Yale Lock Manager

**Current Version**: 1.1.2.0  
**Last Updated**: 2026-01-22

---

## 🧪 Testing & Validation

### Priority: HIGH
These items need testing with real hardware to ensure everything works correctly.

- [ ] **Test basic lock operations**
  - Lock/unlock from Home Assistant
  - Verify lock state updates
  - Test lock/unlock via services

- [ ] **Test Lovelace card UI**
  - Set user code via card
  - Enable/disable user toggle
  - Push code to lock button
  - Clear code button
  - Expand/collapse slot details
  - Set schedules via card
  - Set usage limits via card
  - Verify card shows stored data on reload

- [ ] **Test pull codes from lock**
  - Click "Refresh from Lock" button
  - Verify codes are read (if supported by lock model)
  - Check if unknown codes are detected
  - Note: May not work on all Yale models (security feature)

- [ ] **Test event notifications**
  - Unlock with PIN code
  - Verify `yale_lock_manager_access` event fires
  - Check event data (user_slot, user_name, method, timestamp)
  - Test automation triggers with events

- [ ] **Test time-based schedules**
  - Set start/end datetime for a code
  - Verify code only works within schedule
  - Test code outside of schedule (should fail)
  - Verify `yale_lock_manager_code_expired` event fires

- [ ] **Test usage limits**
  - Set max_uses limit on a code
  - Use code multiple times
  - Verify auto-disable when limit reached
  - Verify `yale_lock_manager_usage_limit_reached` event fires
  - Check usage_count increments correctly

- [ ] **Test slot protection**
  - Push unknown code to lock manually
  - Try to overwrite that slot via Home Assistant
  - Verify error/warning prevents overwrite
  - Test "Pull from Lock" to discover unknown codes

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

- [ ] **Auto-schedule checker**
  - Add background task to check schedules periodically
  - Automatically disable codes when schedule expires
  - Automatically enable codes when schedule starts
  - Fire events for auto-enable/disable

- [ ] **Duplicate code warning**
  - Check if same PIN is used in multiple slots
  - Warn user when setting duplicate code
  - Optional: Prevent duplicates (configurable)

- [ ] **Bulk operations**
  - Service: `set_multiple_codes` - Set codes for multiple slots
  - Service: `clear_multiple_codes` - Clear multiple slots
  - Service: `enable_multiple_users` - Bulk enable
  - Service: `disable_multiple_users` - Bulk disable
  - Add bulk actions to card UI

- [ ] **Import/export functionality**
  - Service: `export_codes` - Export to JSON/YAML
  - Service: `import_codes` - Import from JSON/YAML
  - Add backup/restore buttons to card
  - Include encryption for exported files

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

---

## 📚 Documentation

### Priority: MEDIUM
Important for user adoption and support.

- [ ] **Example automations**
  - Add automation examples to README
  - Notify when specific user unlocks
  - Auto-disable guest codes
  - Send code to visitor via notification
  - Battery low warning
  - Lock jammed alert

- [ ] **Comprehensive troubleshooting guide**
  - "No locks found" - How to fix
  - "Slot occupied" - How to resolve
  - "Code not syncing" - Wake lock procedure
  - "Card not loading" - Resource issues
  - Z-Wave network health tips
  - Debug logging instructions

- [ ] **Video/GIF demos**
  - Installation walkthrough
  - Setting up first code
  - Using the Lovelace card
  - Creating automations

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

These have been implemented in v1.1.2.0:

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

---

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
