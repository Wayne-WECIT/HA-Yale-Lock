# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

**📌 Current Entity Structure** (as of v1.1.2.1):
- Lock: `lock.smart_door_lock_manager` (created by integration)
- Z-Wave Lock: `lock.smart_door_lock` (original Z-Wave entity)
- Sensors: `sensor.smart_door_lock_*` (battery, last_access, etc.)
- Use `lock.smart_door_lock_manager` for the Lovelace card

---

## [1.1.2.3] - 2026-01-22

### Fixed
- **CRITICAL**: Fixed entity naming creating `lock.none_manager` instead of `lock.smart_door_lock_manager`
  - Changed `_attr_has_entity_name` from `True` to `False`
  - Now reads the Z-Wave lock's friendly name and appends " Manager"
  - Creates correct entity ID: `lock.smart_door_lock_manager`
  - Entity will now be properly named and discoverable

### Technical Details
- Lock entity now gets base name from Z-Wave lock's friendly_name attribute
- Falls back to "Smart Door Lock" if name not found
- Appends " Manager" to create unique name
- Entity ID will be generated from this name (e.g., `lock.smart_door_lock_manager`)

### Important
After updating, you may need to:
1. Remove the old integration entry
2. Delete the `lock.none_manager` entity
3. Re-add the integration
4. Update your Lovelace card to use the correct entity

## [1.1.2.2] - 2026-01-22

### Fixed
- **Documentation updates** - All files now reference correct entity names
  - Updated QUICKSTART.md to use `lock.smart_door_lock_manager`
  - Updated CHANGELOG.md with entity structure clarification
  - Fixed all lock/unlock automation examples
  - Clarified v1.1.0.0 was broken (use v1.1.1.0+)
  
### Documentation Changes
- QUICKSTART.md: Updated card configuration example (line 66)
- QUICKSTART.md: Updated lock/unlock automation examples (lines 170, 175)
- CHANGELOG.md: Added current entity structure note at top
- CHANGELOG.md: Marked v1.1.0.0 as superseded/broken

## [1.1.2.1] - 2026-01-22

### Fixed
- **CRITICAL**: Fixed ImportError preventing integration from loading
  - Added `ZWAVE_JS_DOMAIN` constant to `const.py`
  - `lock.py` was trying to import it but it wasn't defined
  - Integration now loads correctly

## [1.1.2.0] - 2026-01-22

### Fixed
- **Improved user code reading from lock**
  - Updated `_get_zwave_value()` to use `refresh_value` service
  - Better error handling when reading user codes
  - Searches for Z-Wave entities that match command class and property
  - Added asyncio import for async sleep
  
### Storage and Persistence
- ✅ User data IS saved locally (`.storage/yale_lock_manager.users`)
- ✅ Data persists across restarts
- ✅ Card shows stored data immediately on load
- ✅ `pull_codes_from_lock` service attempts to read codes from lock
  
### How It Works
1. **Set User Codes**: Via card or services → Saved to local storage
2. **Push to Lock**: Manual button press → Writes code to lock via Z-Wave
3. **Pull from Lock**: "Refresh from Lock" button → Reads codes from lock (if supported)
4. **Automatic Save**: All changes auto-saved to storage
5. **Load on Startup**: All user data loaded from storage on HA restart

### Known Limitations
- Reading user codes from lock may not work on all Yale models
- Some locks don't expose user codes via Z-Wave (security feature)
- Recommend using local storage as source of truth

## [1.1.1.0] - 2026-01-22

### Fixed
- **CRITICAL FIX**: Restored lock entity (v1.1.0.0 broke lock/unlock functionality)
- Lock entity now has unique name to avoid conflicts: `lock.smart_door_lock_manager`
- Links to existing Z-Wave device (all entities grouped together)
- **Card UI completely fixed**:
  - Now shows REAL user data from Home Assistant (not mock data)
  - All form fields visible even for empty slots
  - Can set name, PIN code, and code type for any slot
  - Wider card layout (max 1200px) for better readability
  - FOB/RFID handling improved with helpful instructions
  - PIN validation (4-10 digits, numbers only)

### Technical Changes
- Lock entity unique ID: `yale_lock_manager_{node_id}_manager`
- Lock entity links to Z-Wave device via `device_info`
- Card reads user data from `lock.attributes.users`
- Lock entity exposes full user data in `extra_state_attributes`

### User Experience
- Lock/Unlock works correctly again ✅
- Card displays real data ✅
- Can set PINs and names ✅
- FOB/PIN toggle works ✅
- Wider, more readable UI ✅

## [1.1.0.0] - 2026-01-22 (SUPERSEDED by 1.1.1.0)

### ⚠️ THIS VERSION WAS BROKEN - DO NOT USE
- **Removed wrapper lock entity** - This broke lock/unlock functionality
- Was attempting cleaner design but removed critical functionality
- Fixed in v1.1.1.0

### What Went Wrong
- Removed `Platform.LOCK` from integration platforms
- Lock entity removed completely
- Lock/unlock stopped working
- Card showed no data

**DO NOT USE THIS VERSION - Update to v1.1.1.0 or later**

## [1.0.2.0] - 2026-01-22

### Fixed
- **MAJOR FIX**: Sensors now work correctly! 
- Fixed entity name mismatch (lock.smart_door_lock_2 vs sensor.smart_door_lock_battery)
- Coordinator now strips `_2` suffix and searches for correct Z-Wave entities
- Tries multiple entity name patterns to find battery, door, and bolt sensors
- Uses lock state as fallback for bolt status
- Battery, door, and bolt sensors now populate correctly

### Technical
- Detects and handles entity naming differences
- Searches for: `sensor.smart_door_lock_battery_level`, `binary_sensor.smart_door_lock_current_status_of_the_door`
- Smart pattern matching for entity discovery

## [1.0.1.4] - 2026-01-22

### Added
- Extensive debug logging to diagnose sensor data issues
- Logs show exactly what entities are being checked and their values
- Use this version to troubleshoot "Unknown" sensor values

## [1.0.1.3] - 2026-01-22

### Fixed
- Fixed sensors showing "Unknown" - coordinator now reads from Z-Wave entities directly
- Simplified data fetching to read from existing Z-Wave JS entities
- Added fallback to read from lock attributes first, then from separate entities
- Removed complex Z-Wave value queries that weren't working
- Added better error logging and debug info

### Changed
- Coordinator now looks for related entities (battery, door, bolt sensors)
- User codes temporarily not queried from lock (uses storage only)
- More reliable sensor data updates

## [1.0.1.2] - 2026-01-21

### Fixed
- Fixed blocking I/O warning: Card file copy now runs in executor (non-blocking)
- Home Assistant no longer complains about `shutil.copy2()` blocking the event loop
- Proper async/await handling for file operations

## [1.0.1.1] - 2026-01-21

### Changed
- Card is now automatically copied to `www/yale_lock_manager/` during integration setup
- Card URL changed from `/local/community/yale_lock_manager/` to `/local/yale_lock_manager/`
- No manual card file copying needed - fully automatic!
- Works correctly with HACS custom repositories

### Technical
- Added `_async_setup_frontend()` function to handle card installation
- Integration automatically creates `www/yale_lock_manager/` directory if needed

## [1.0.1.0] - 2026-01-21

### Fixed
- Fixed multiple `'HomeAssistant' object has no attribute 'helpers'` errors in coordinator
- Fixed `'HomeAssistant' object has no attribute 'callback'` error in sensor
- Properly imported device_registry and entity_registry modules throughout
- Fixed @callback decorator usage in event listeners

### Changed
- Moved Lovelace card from `www/yale-lock-manager-card/` to `custom_components/yale_lock_manager/www/`
- Card is now served from `/local/community/yale_lock_manager/yale-lock-manager-card.js`
- Card file is automatically installed with the integration via HACS

## [1.0.0.3] - 2026-01-21

### Fixed
- Fixed import error: `AttributeError: 'HomeAssistant' object has no attribute 'helpers'`
- Properly imported entity_registry module (was causing 500 Internal Server Error)
- Config flow now loads correctly

## [1.0.0.2] - 2026-01-21

### Fixed
- Improved lock detection to check for actual lock entities (most reliable method)
- Added multiple detection methods for Yale locks (manufacturer, model, name)
- Now detects ANY Z-Wave lock with a lock entity, not just Yale
- Added debug logging for lock detection

### Changed
- Lock detection now checks entity registry for lock entities first
- More robust Yale model detection (checks for KFCON model patterns)

## [1.0.0.1] - 2026-01-21

### Fixed
- Lock detection in config flow - now properly detects Yale locks regardless of model name
- Previously required model to contain "lock", now only checks manufacturer="Yale"

## [1.0.0.0] - 2026-01-21

### Added
- Initial release
- Full Yale lock control (lock/unlock)
- User code management for up to 20 slots
- Support for PIN codes and FOB/RFID cards
- Time-based access scheduling
- Usage limit tracking
- Real-time notification events
- Battery level monitoring
- Door and bolt status sensors
- Last access tracking (user, method, timestamp)
- Lovelace dashboard card with inline controls
- Slot protection to prevent accidental code overwrites
- Manual sync control (no automatic updates)
- Service calls for all lock operations
- HACS compatibility
- Z-Wave JS integration support

### Security
- Slot protection prevents overwriting unknown codes
- Codes stored locally with option for encryption (future)

## [Unreleased]

### Planned Features
- Multi-lock support (currently limited to one lock)
- Enhanced FOB/RFID detection
- Backup and restore functionality
- Advanced automation helpers
- Mobile app integration
- Code encryption in storage
- Duplicate code detection across slots
- Bulk code operations
- Import/export user codes
