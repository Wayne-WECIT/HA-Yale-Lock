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

## [1.7.2.1] - 2026-01-22

### Fixed - Clear Slot Race Condition! ⚡
- **🐛 Race Condition Fixed** - Clear + Add now works reliably
  - Added 2-second wait after clearing slot
  - Verifies slot is empty before returning
  - No more "occupied by unknown code" after clear

### The Problem (User Reported)
```
1. Click "Clear Slot" → Cleared ✓
2. Immediately click "Add" → Error! ❌
   "Slot 5 is occupied by an unknown code"
```

**Root Cause:**
- Clear sent to lock ✓
- Storage cleared immediately ✓
- Function returned immediately ❌
- User tried to add too fast
- Lock hadn't processed clear yet
- Status still showed "occupied"
- Storage was empty, so we don't "own" it
- Error: "unknown code"

### The Solution
```python
async_clear_user_code():
  1. Delete from storage ✓
  2. Send clear to lock ✓
  3. Wait 2 seconds ⏱️ NEW!
  4. Read back status 🔍 NEW!
  5. Verify it's empty ✅ NEW!
  6. Only then return
```

### What Gets Verified
- Status reads as `USER_STATUS_AVAILABLE`
- Or status reads as `None` (completely empty)
- Logs confirmation: "✓ Verified: Slot X successfully cleared"

### Error Handling
- If verification fails: Logs warning but continues
- Still refreshes coordinator
- Storage is cleared regardless
- User can retry if needed

### Benefits
✅ No more race condition errors
✅ Reliable clear → add workflow
✅ Proper verification of clear operation
✅ User can add immediately after clear completes
✅ Clear feedback in logs

---

## [1.7.2.0] - 2026-01-22

### Fixed - CRITICAL: Push Verification! 🔍
- **✅ Read-Back Verification** - Now VERIFIES code was written!
  - After pushing, waits 2 seconds for lock to process
  - Reads back the code from the lock using `invoke_cc_api`
  - Compares returned code with expected code
  - Only marks `synced_to_lock: true` if verification succeeds
  - If verification fails, marks `synced_to_lock: false` and raises error

### The Problem (Before)
```python
await push_code_to_lock()
synced_to_lock = True  # ❌ Optimistic, no verification!
```
- Assumed push succeeded without checking
- Could show "synced" when lock actually rejected the code
- No way to know if push really worked
- False positive feedback to user

### The Solution (Now)
```python
await push_code_to_lock()       # Push code
await asyncio.sleep(2.0)        # Wait for processing
status = await get_status()     # Read back status
code = await get_code()         # Read back code
if status == AVAILABLE:
    raise "Slot is empty!"      # ❌ Push failed
if code != expected:
    raise "Code mismatch!"      # ❌ Wrong code
synced_to_lock = True           # ✅ Verified!
```

### What Gets Verified
1. **Slot Not Empty** - Ensures slot has data after push
2. **Code Matches** - Verifies exact code was written
3. **Status Valid** - Checks status is not "Available"

### Error Cases Detected
- ✅ Lock rejected the push (slot still empty)
- ✅ Lock wrote wrong code (mismatch detected)  
- ✅ Communication failed (can't read back)
- ✅ Lock is offline (timeout on read)

### Additional Fixes
- **Enable/Disable** now marks as not synced
  - Toggling user on/off requires push to lock
  - Checkmark (✓) changes to (✗) until pushed
  - Clear visual feedback that push needed

### Logging Improvements
```
INFO: Pushing pin code for slot 4 to lock (status: 1)
INFO: Verifying code was written to slot 4...
INFO: ✓ Verified: Code successfully written to slot 4
```
or
```
ERROR: Verification failed: Slot 4 is empty after push!
ERROR: Verification failed: Code mismatch in slot 4
```

### Benefits
✅ Reliable sync status - no more false positives
✅ Immediate feedback if push fails
✅ Catch lock communication issues
✅ Verify code before marking complete
✅ User sees accurate sync state
✅ Can retry failed pushes with confidence

### Technical Details
- Uses same `_get_user_code_status()` and `_get_user_code()` methods
- 2-second delay allows lock to process write operation
- Verification runs after every successful `invoke_cc_api.set()` call
- On verification failure: marks `synced_to_lock = False` + raises error
- On verification success: marks `synced_to_lock = True` + refreshes UI

---

## [1.7.1.0] - 2026-01-22

### Fixed - UI COMPLETE REDESIGN! 🎨
- **❌ NO MORE POPUPS!** - All alert() and confirm() removed
  - In-pane status messages for all actions
  - Confirmation prompts display inline with Yes/No buttons
  - Works perfectly on mobile apps
  - Auto-dismissing success messages (3 seconds)
  - Persistent error messages with close button

- **🏷️ FOB UI** - Proper handling
  - Code input hidden for FOBs (not applicable)
  - Schedule section hidden for FOBs
  - Usage limit section hidden for FOBs
  - Friendly notice explaining FOB behavior
  - FOB icon (🏷️) vs PIN icon (🔑) in table

- **🎯 CONSOLIDATED ACTIONS** - Single "Update User" button!
  - Removed separate "Set Schedule" button
  - Removed separate "Set Limit" button
  - ONE "Update User" / "Save User" button does everything:
    - Saves name, code, type
    - Saves schedule (if enabled)
    - Saves usage limit (if enabled)
    - All in one atomic operation
  - "Clear Slot" button moved to bottom
  - "Reset Counter" button when usage > 0

- **📱 BETTER MOBILE UX**
  - All buttons properly sized
  - Responsive flex layout
  - In-pane confirmations (no native dialogs)
  - Touch-friendly targets
  - Works in HA companion app

### Improved
- **Status Message System**
  - Success (green) - Auto-dismisses after 3s
  - Error (red) - Stays until dismissed
  - Warning (orange) - User action needed
  - Info (blue) - Informational
  - Confirm (orange) - Yes/No inline buttons
  - Smooth slide-in animation
  - Per-slot message isolation

- **Better Validation**
  - Client-side validation with friendly messages
  - Date validation (must be future)
  - End date must be after start date
  - PIN length validation
  - Shows validation errors in-pane

- **Smarter Updates**
  - Type change triggers immediate re-render
  - Toggling schedule/limit shows/hides fields
  - Handles override protection with inline confirm
  - Better error recovery

### Technical Details
UI Rewrite:
- New `_statusMessages` state object per slot
- `showStatus(slot, message, type)` method
- `clearStatus(slot)` method
- `getStatusMessageHTML(slot)` for rendering
- All handlers updated to use status messages
- No native browser dialogs (alert/confirm/prompt)

Button Consolidation:
- `handleSaveAll()` - Master save handler
  - Calls set_user_code
  - Calls set_user_schedule (if PIN + toggle ON)
  - Calls set_usage_limit (if PIN + toggle ON)
  - Single transaction, better UX

FOB Detection:
- Checks `code_type === 'fob'`
- Hides: code input, schedule section, usage section
- Shows: friendly explanatory notice
- Allows: name changes only for FOBs

Responsive Design:
- Flex layouts with wrap
- Min-width on inputs for mobile
- Button groups with proper gaps
- Mobile-first approach

### What This Fixes
✅ "Popups won't work on mobile" - All inline now
✅ "FOBs shouldn't require codes" - Code field hidden
✅ "Schedule/limit for FOBs wrong" - Hidden for FOBs
✅ "Too many buttons" - Consolidated to one
✅ "Bad mobile UX" - Complete redesign

---

## [1.7.0.0] - 2026-01-22

### Fixed
- **🔧 Z-Wave Communication** - Now uses `invoke_cc_api` instead of `set_value`
  - More reliable code reading from lock
  - Properly uses UserCode CC API (get, set, clear methods)
  - Better error handling and feedback
  
- **🧹 Clear Slot** - Now works correctly
  - Clears from storage AND lock
  - No more "occupied by unknown code" errors after clearing
  - Properly refreshes UI after clearing

- **🏷️ FOB/RFID Support** - Fixed handling
  - FOBs no longer require PIN codes
  - Auto-generates placeholder code for FOBs (00000000)
  - FOBs ignore schedule and usage limits
  - Code input hidden for FOB type

- **🔄 Toggle Fix** - Slot now properly parsed as integer
  - Fixed "expected int for dictionary value" error
  - All handlers now use parseInt(slot, 10)

### Improved
- **Better Service Validation**
  - Code parameter now optional in schema (for FOBs)
  - Proper validation based on code type
  - Clearer error messages

### Technical Details
- `_get_user_code_status()` - Now uses `invoke_cc_api` with `get` method
- `_get_user_code()` - Now uses `invoke_cc_api` with `get` method  
- `async_push_code_to_lock()` - Now uses `invoke_cc_api` with `set` method
- `async_clear_user_code()` - Now uses `invoke_cc_api` with `clear` method
- FOB codes use 8-digit placeholder when no code provided
- Schedule/usage preserved when updating existing users

### Known Issues
- UI still uses popup dialogs (will be fixed in next release)
- Schedule/Usage sections still visible for FOBs (will be hidden in next release)  
- Separate action buttons will be consolidated in next release

---

## [1.6.1.0] - 2026-01-22

### Fixed
- **🔍 Refresh From Lock** now works correctly
  - Improved Z-Wave value retrieval to access driver data directly
  - Added fallback methods to ensure codes are read properly
  - Enhanced logging to show pull progress and results
  - Now displays: "Found X codes (Y new, Z updated)"
  - Properly detects PIN vs FOB/RFID codes based on format

### Improved
- **Better Z-Wave Communication**
  - Now accesses Z-Wave JS driver data directly for more reliable reads
  - Increased refresh timeout from 0.5s to 1.0s for better lock response
  - Multi-layer approach: driver data → entity attributes → fallback
  - More detailed debug logging for troubleshooting

### Technical Details
- `_get_zwave_value()` now tries three methods in order:
  1. Direct access to Z-Wave JS driver node values (most reliable)
  2. Entity registry search for matching command class
  3. Fallback to refresh_value service
- `async_pull_codes_from_lock()` now provides detailed progress logging

### What This Fixes
- "Refresh from Lock" button previously showed no results
- Unknown codes on lock now properly detected and imported
- Codes set directly on keypad are now discovered
- Better visibility into what codes exist on the physical lock

---

## [1.6.0.0] - 2026-01-22

### Added
- **🛡️ Slot Protection Override**
  - New `override_protection` parameter for `set_user_code` service
  - Allows overwriting codes that weren't set through the integration
  - Confirmation dialog in UI when trying to overwrite unknown codes
  - Warns user about permanently replacing existing codes
  - Protects against accidental overwrites by default

### Improved
- Better error handling in card:
  - Catches slot protection errors
  - Shows detailed confirmation dialog explaining the situation
  - Retries with override if user confirms
  - Clear warning about permanent replacement

### How It Works
- **Default behavior**: Slot protection prevents overwriting unknown codes
- **When protected slot encountered**: Card shows confirmation dialog:
  ```
  ⚠️ Slot 4 contains a code that wasn't set through this integration.
  
  This could be:
  • A code set directly on the lock keypad
  • A code from another system
  
  Do you want to OVERWRITE it?
  
  ⚠️ WARNING: The existing code will be permanently replaced!
  ```
- **If confirmed**: Code is overwritten and added to integration's management

## [1.5.1.0] - 2026-01-22

### Fixed
- **CRITICAL FIX**: Added `entity_id` parameter to all service schemas
  - Services were rejecting calls with "extra keys not allowed" error
  - All schemas now accept optional `entity_id` parameter
  - Makes services future-proof for multi-lock support
  - Fixes card functionality completely

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
  - Removed broken `@click` template literal syntax
  - Implemented vanilla JavaScript event listeners
  - Fixed unresponsive buttons and toggle switches
  - Removed security vulnerability (`eval()` usage)
- Card now properly responsive and clickable
- All buttons, toggles, and input fields now work correctly

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
- Multi-lock support (currently limited to one lock)
- Enhanced FOB/RFID detection
- Backup and restore functionality
- Advanced automation helpers
- Mobile app integration
- Code encryption in storage
- Duplicate code detection across slots
- Bulk code operations
- Import/export user codes
