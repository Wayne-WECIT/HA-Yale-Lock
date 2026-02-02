# Yale Smart Door Lock - Device Specifications

**Model:** P-KFCON-MOD-YALE  
**Manufacturer:** Yale  
**Official Z-Wave Database:** https://devices.zwave-js.io/?jumpTo=0x0129:0x0007:0x0000

---

## Device Identifiers

- **Product Manufacturer:** `0x0129`
- **Product Identifiers:** 
  - `0x0007:0x0000`
  - `0x0007:0x0001`
- **Firmware:** All Versions

---

## Configuration Parameters

The lock supports 4 configuration parameters that can be set via Z-Wave:

### Parameter 1: Volume
Control the beep volume of the lock.

- **Type:** Read/Write
- **Range:** 1-3
- **Default:** 2 (Low)
- **Values:**
  - `1` = Silent
  - `2` = Low
  - `3` = High

### Parameter 2: Auto Relock
Enable or disable automatic relocking after unlock.

- **Type:** Read/Write
- **Values:**
  - `0` = Disable
  - `255` = Enable

### Parameter 3: Manual Relock Time
Time to automatically relock after manual lock/unlock operation.

- **Type:** Read/Write
- **Range:** 7-60 seconds
- **Default:** 7 seconds

### Parameter 6: Remote Relock Time
Time to automatically relock after Z-Wave lock/unlock operation.

- **Type:** Read/Write
- **Range:** 10-90 seconds
- **Default:** 10 seconds

---

## Alarm Mappings (Event Notifications)

The lock reports the following alarm types when events occur:

| Alarm Type | Alarm Level | Description | Notification Event |
|------------|-------------|-------------|--------------------|
| 9 | * | Lock jammed | Access Control: Lock jammed (0x0b) |
| 19 | User ID | Keypad unlock | Access Control: Keypad unlock (0x06) |
| 24 | 1 | RF lock operation | Access Control: RF lock (0x03) |
| 25 | 1 | RF unlock operation | Access Control: RF unlock (0x04) |
| 27 | 1 | Auto lock | Access Control: Auto lock (0x09) |
| 144 | User ID | Keypad unlock | Access Control: Keypad unlock (0x06) |

**Note:** For alarm types 19 and 144, the **Alarm Level** contains the **User ID** (slot number) that unlocked the lock.

---

## Device Instructions

### Inclusion (Adding to Z-Wave Network)
1. Enter the Master code on the lock, followed by #
2. Press the **4** button, followed by #
3. Press the **1** button, followed by #

### Exclusion (Removing from Z-Wave Network)
1. Enter the Master code on the lock, followed by #
2. Press the **4** button, followed by #
3. Press the **3** button, followed by #

### Factory Reset
⚠️ **Warning:** This will erase all user codes and settings!

1. Enter the Master code on the lock, followed by #
2. Press the **4** button, followed by #
3. Press the **0** button, followed by #

---

## Association Groups

| Group ID | Label | Auto Assigned | Max Nodes |
|----------|-------|---------------|-----------|
| 1 | Lifeline | ✓ | 4 |

The Lifeline group is used for Z-Wave Plus status and battery reports.

---

## Integration Implementation

This integration (Yale Lock Manager) uses the above specifications to:

- **Alarm Type 19/144:** Detect keypad unlocks and identify which user slot was used
- **Alarm Type 24:** Detect RF lock operations (lock via Z-Wave/Remote)
- **Alarm Type 25:** Detect RF unlock operations (unlock via Z-Wave/Remote)
- **Alarm Type 27:** Detect auto-lock operations
- **Alarm Type 9:** Detect lock jammed status

The user ID from alarm level is used to:
- Track last user who accessed the lock
- Update usage counts
- Check schedules and usage limits
- Fire access events for automations

---

## Future Enhancements

Potential features using the device specifications:

- [ ] Expose configuration parameters as entities (volume, auto-relock settings)
- [ ] Allow setting relock times from Home Assistant
- [ ] Add service to trigger factory reset (with confirmation)
- [ ] Display lock jammed status as binary sensor

---

**Last Updated:** 2026-01-27  
**Integration Version:** 1.8.4.47  
**Source:** [Z-Wave JS Device Database](https://devices.zwave-js.io/?jumpTo=0x0129:0x0007:0x0000)
