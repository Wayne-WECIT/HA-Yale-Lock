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
