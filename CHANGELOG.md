# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

**📌 Current Entity Structure** (as of v1.2.0.1):
- **Separate Device: "Smart Door Lock Manager"** (created by integration)
  - Lock: `lock.smart_door_lock_manager`
  - Sensors: `sensor.smart_door_lock_manager_battery`, etc.
  - Binary Sensors: `binary_sensor.smart_door_lock_manager_door`, etc.
- **Z-Wave Device: "Smart Door Lock"** (original Z-Wave device)
  - Lock: `lock.smart_door_lock`
  - Z-Wave sensors: `sensor.smart_door_lock_*`
  
Use `lock.smart_door_lock_manager` for the Lovelace card!

---

## [1.3.0.0] - 2026-01-22

### NEW FEATURE - Configuration Parameters
- **Added 4 configuration parameter entities** based on official Z-Wave specs!
  - 🔊 **Select: Volume** (Silent / Low / High)
  - 🔄 **Switch: Auto Relock** (Enable / Disable)
  - ⏱️ **Number: Manual Relock Time** (7-60 seconds)
  - ⏱️ **Number: Remote Relock Time** (10-90 seconds)

### What You Get
All configuration parameters are now exposed as entities on the "Smart Door Lock Manager" device:
```
📱 Smart Door Lock Manager
├── 🔐 lock.smart_door_lock_manager
├── 🔊 select.smart_door_lock_manager_volume
├── 🔄 switch.smart_door_lock_manager_auto_relock
├── ⏱️ number.smart_door_lock_manager_manual_relock_time
├── ⏱️ number.smart_door_lock_manager_remote_relock_time
├── (sensors...)
```

### How It Works
- Change volume from Home Assistant (no more keypad programming!)
- Toggle auto-relock on/off
- Adjust relock timers dynamically
- Settings are sent to lock via Z-Wave JS `set_config_parameter` service
- Values are stored in coordinator data

### New Platforms
- `number.py` - Manual and Remote relock times
- `select.py` - Volume selection
- `switch.py` - Auto relock enable/disable

### Technical
- Uses Z-Wave JS config parameter service
- Parameter numbers from official device specs:
  - Param 1: Volume
  - Param 2: Auto Relock
  - Param 3: Manual Relock Time
  - Param 6: Remote Relock Time

## [1.2.1.0] - 2026-01-22

### Fixed
- **Corrected alarm type mappings** based on official Z-Wave Database
  - Fixed: Alarm 24 = RF **lock** operation (was incorrectly "manual unlock")
  - Fixed: Alarm 25 = RF **unlock** operation (was incorrectly "manual lock")
  - Renamed constants: `ALARM_TYPE_MANUAL_*` → `ALARM_TYPE_RF_*`
  - Now correctly fires LOCKED event for alarm 24
  - Now correctly fires UNLOCKED event for alarm 25
  
### Added
- **DEVICE_SPECS.md** - Official Z-Wave device specifications
  - Complete alarm type mappings from Z-Wave Database
  - Configuration parameters (Volume, Auto Relock, Relock Times)
  - Device instructions (Inclusion, Exclusion, Reset)
  - Association groups
  - Future enhancement ideas

### Technical
- Alarm types now match official P-KFCON-MOD-YALE specifications
- Source: https://devices.zwave-js.io/?jumpTo=0x0129:0x0007:0x0000
- Method now correctly shows "remote" for RF operations (Z-Wave/HA control)

### User Impact
- Lock/unlock events from Home Assistant now correctly trigger "remote" method
- Event tracking is now more accurate
- Foundation for future config parameter support

## [1.2.0.1] - 2026-01-22

### Documentation
- **Updated all documentation** to reflect separate device architecture
- README.md: Added detailed "Device Structure" section
- QUICKSTART.md: Clarified two-device setup
- PROJECT_SUMMARY.md: Updated version to 1.2.0.1
- All docs now explain Yale Lock Manager device vs Z-Wave device

### No Code Changes
This is a documentation-only release. Code is identical to v1.2.0.0.

## [1.2.0.0] - 2026-01-22

### MAJOR CHANGE - Separate Device Architecture
- **Created dedicated "Yale Lock Manager" device** (no longer trying to inject into Z-Wave device)
- Fixes all entity naming issues (`lock.none_manager`, `undefined` device)
- Clean separation between Z-Wave and Yale Lock Manager

### What Changed
- Lock entity: `lock.smart_door_lock_manager` (on Yale Lock Manager device) ✅
- All sensors: Under "Smart Door Lock Manager" device
- Z-Wave lock: Still exists separately as `lock.smart_door_lock`
- Device info: "Yale Lock Manager" / "Lock Code Manager"
- Uses `via_device` to show relationship to Z-Wave lock

### Device Structure
```
📱 Smart Door Lock Manager (Yale Lock Manager)
├── lock.smart_door_lock_manager
├── sensor.smart_door_lock_manager_battery
├── sensor.smart_door_lock_manager_last_access
├── sensor.smart_door_lock_manager_last_user
├── sensor.smart_door_lock_manager_last_access_method
├── binary_sensor.smart_door_lock_manager_door
└── binary_sensor.smart_door_lock_manager_bolt

📱 Smart Door Lock (Z-Wave JS)
├── lock.smart_door_lock
└── (other Z-Wave entities)
```

### User Impact
- **You'll see TWO devices** (this is intentional and correct)
- Use the "Smart Door Lock Manager" device for code management
- Use `lock.smart_door_lock_manager` in Lovelace card
- No more "undefined" or "unnamed" devices!

### Migration
After updating to v1.2.0.0:
1. Remove old integration entry
2. Restart Home Assistant
3. Re-add Yale Lock Manager integration
4. Update Lovelace card entity reference

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

## [1.5.0.0] - 2026-01-22

### Added
- **📊 Usage Count Display**
  - Current usage count shown in read-only input box
  - Maximum uses shown in editable input box
  - Side-by-side display for easy comparison
  - Visual indicator when limit is reached (🚫 red error)
  - Warning indicator for partial usage (⚠️ orange)
- **🔄 Reset Usage Counter Button**
  - New "Reset Counter" button (appears when usage_count > 0)
  - Resets usage count back to 0
  - Automatically re-enables code if it was disabled due to limit
  - Confirmation dialog before reset
- **🔧 New Service**: `reset_usage_count`
  - Resets usage counter for a specific slot
  - Auto-enables user if they were disabled by limit
  - Available via UI and service call

### Improved
- Better visual feedback for usage limits:
  - Read-only field prevents accidental changes to current count
  - Clear separation between current and maximum
  - Color-coded status messages
- Usage count logic fully implemented:
  - Counter increments on each access
  - Code auto-disables when count >= limit
  - Reset button only shows when needed

## [1.4.0.0] - 2026-01-22

### Added
- **🎚️ Toggle Controls** for schedule and usage limit
  - Clean toggle switches to enable/disable features
  - Fields automatically show/hide based on toggle state
  - Cleaner, less cluttered UI
- **✅ Date Validation** in services and UI
  - Start/End dates must be in the future
  - End date must be after start date
  - Client-side and server-side validation
  - User-friendly error messages

### Improved
- **Logic Clarification**:
  - No schedule set = code works 24/7 indefinitely
  - No usage limit = unlimited uses
  - Can configure schedule and limit together or separately
  - Code auto-disables when date expires OR usage limit reached
- Better UX for optional features (toggles instead of always-visible fields)
- Updated field descriptions to explain default behavior

### Fixed
- Validation in `set_user_schedule` service now checks dates are valid

## [1.3.3.0] - 2026-01-22

### Fixed
- **UI FIX**: Schedule and usage limit fields now always visible
  - Previously hidden until after setting user code
  - Now shown immediately when expanding empty slots
  - Can set name, code, schedule, and limit all at once
- Added helpful descriptions for schedule and usage limit fields
- Improved button labels (shows "Update" vs "Set" based on state)
- Added usage count warning indicator

### Improved
- Schedule fields now labeled "Start Date/Time" and "End Date/Time" for clarity
- Usage limit shows example placeholder text
- Better visual feedback for usage count

## [1.3.2.0] - 2026-01-22

### Fixed
- **CRITICAL FIX**: Corrected all service names in Lovelace card
  - `set_usercode` → `set_user_code`
  - `push_usercode` → `push_code_to_lock`
  - `clear_usercode` → `clear_user_code`
  - `enable_usercode` → `enable_user` / `disable_user`
  - `refresh_codes` → `pull_codes_from_lock`
  - `set_schedule` → `set_user_schedule`
- Fixed service parameter names:
  - `start_time`/`end_time` → `start_datetime`/`end_datetime`
  - `limit` → `max_uses`
  - `enabled` parameter removed (use separate enable/disable services)
- Card now properly communicates with backend services

## [1.3.1.0] - 2026-01-22

### Fixed
- **MAJOR FIX**: Completely rewrote Lovelace card with proper event handling
  - Removed broken `@click` template literal syntax that didn't work in vanilla JavaScript
  - Implemented proper event listeners with `data-action` and `data-slot` attributes
  - Fixed unresponsive buttons, toggle switches, and input fields
  - Removed security vulnerability from `eval()` usage
  - Card is now fully functional and responsive

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
