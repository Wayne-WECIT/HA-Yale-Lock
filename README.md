# Yale Lock Manager for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)
[![Version](https://img.shields.io/github/v/release/Wayne-WECIT/HA-Yale-Lock)](https://github.com/Wayne-WECIT/HA-Yale-Lock/releases)
[![License](https://img.shields.io/github/license/Wayne-WECIT/HA-Yale-Lock)](LICENSE)

A comprehensive Home Assistant custom integration for managing Yale front door locks via Z-Wave JS. This integration provides full control over user codes, PINs, FOBs/RFIDs, time-based access, usage limits, and real-time notifications.

## ✨ Features

- 🔐 **Full Lock Control**: Lock and unlock your Yale Z-Wave lock directly from Home Assistant
- 👥 **User Code Management**: Add, update, and remove user codes (up to 20 slots) with custom names
- 🔑 **Multiple Code Types**: Support for PIN codes and FOB/RFID cards
- ⏰ **Time-Based Access**: Set start and end dates/times for temporary access codes
- 🔢 **Usage Limits**: Configure codes that can only be used a limited number of times
- 🔔 **Real-Time Notifications**: Get notified when someone opens the lock (who and when)
- 📊 **Lovelace Dashboard**: Beautiful dashboard card to manage everything visually with inline controls
- 🛡️ **Slot Protection**: Prevents accidental overwriting of existing user codes
- 📈 **Status Tracking**: Track battery level, door status, bolt status, and usage statistics
- 🔄 **Manual Sync Control**: No automatic updates pushed to lock - you control when codes sync

## 📋 Requirements

- Home Assistant 2026.1.2 or later
- Z-Wave JS integration configured and running
- Yale Smart Door Lock paired with Z-Wave JS (tested with P-KFCON-MOD-YALE)

## 🚀 Installation

### HACS (Recommended)

1. Open HACS in Home Assistant
2. Click on "Integrations"
3. Click the three dots in the top right corner
4. Select "Custom repositories"
5. Add this repository URL: `https://github.com/Wayne-WECIT/HA-Yale-Lock`
6. Select category: "Integration"
7. Click "Add"
8. Find "Yale Lock Manager" in HACS and click "Install"
9. Restart Home Assistant

### Manual Installation

1. Download the latest release from the [releases page](https://github.com/Wayne-WECIT/HA-Yale-Lock/releases)
2. Extract the `yale_lock_manager` folder from the archive
3. Copy the `custom_components/yale_lock_manager` folder to your Home Assistant's `custom_components` directory
4. Copy the `www/yale-lock-manager-card` folder to your Home Assistant's `www` directory
5. Restart Home Assistant

## ⚙️ Configuration

### Integration Setup

1. Go to **Settings** → **Devices & Services**
2. Click **"+ Add Integration"**
3. Search for **"Yale Lock Manager"**
4. Select your Yale lock from the list of available Z-Wave locks
5. Click **Submit**

**Note:** Currently, only one lock can be configured. Multi-lock support is planned for a future release.

### Lovelace Card Setup

1. Add the custom card resource:
   - Go to **Settings** → **Dashboards** → **Resources** (three dots menu)
   - Click **"+ Add Resource"**
   - URL: `/local/yale_lock_manager/yale-lock-manager-card.js`
   - Resource type: **JavaScript Module**
   - Click **Create**
   
   **Note:** The integration automatically copies the card to `www/yale_lock_manager/` when you add it.

2. Add the card to your dashboard:
   ```yaml
   type: custom:yale-lock-manager-card
   entity: lock.smart_door_lock  # Use your Z-Wave lock entity ID
   ```

**Important:** The integration works with your **existing Z-Wave lock entity**. It does not create a duplicate lock entity, avoiding naming conflicts. All sensors and services integrate seamlessly with your Z-Wave lock.

## 📖 Usage

### Managing User Codes

#### Via Lovelace Card

The Lovelace card provides an intuitive interface for managing all aspects of your lock:

- **View All Slots**: See all 20 user code slots at a glance
- **Set/Update Codes**: Click on any slot to expand and configure
- **Enable/Disable Users**: Toggle user access with a switch
- **Push to Lock**: Manually sync codes to the lock
- **Set Schedules**: Configure time-based access restrictions
- **Set Usage Limits**: Limit how many times a code can be used
- **Monitor Status**: See sync status, battery level, and door state

#### Via Services

You can also manage codes through Home Assistant services:

**Set a User Code:**
```yaml
service: yale_lock_manager.set_user_code
data:
  slot: 3
  code: "1234"
  name: "Guest"
  code_type: "pin"  # or "fob"
```

**Clear a User Code:**
```yaml
service: yale_lock_manager.clear_user_code
data:
  slot: 3
```

**Set Schedule:**
```yaml
service: yale_lock_manager.set_user_schedule
data:
  slot: 3
  start_datetime: "2026-01-01 00:00:00"
  end_datetime: "2026-12-31 23:59:59"
```

**Set Usage Limit:**
```yaml
service: yale_lock_manager.set_usage_limit
data:
  slot: 3
  max_uses: 10
```

**Push Code to Lock:**
```yaml
service: yale_lock_manager.push_code_to_lock
data:
  slot: 3
```

**Pull All Codes from Lock:**
```yaml
service: yale_lock_manager.pull_codes_from_lock
```

**Enable/Disable User:**
```yaml
service: yale_lock_manager.enable_user
data:
  slot: 3
```

```yaml
service: yale_lock_manager.disable_user
data:
  slot: 3
```

### Automations

The integration fires several events that you can use in automations:

#### Access Event
Fired when someone unlocks the lock:
```yaml
trigger:
  - platform: event
    event_type: yale_lock_manager_access
    event_data:
      user_slot: 3
action:
  - service: notify.mobile_app
    data:
      message: "{{ trigger.event.data.user_name }} just unlocked the door!"
```

#### Code Expired Event
Fired when someone tries to use an expired code:
```yaml
trigger:
  - platform: event
    event_type: yale_lock_manager_code_expired
action:
  - service: notify.mobile_app
    data:
      message: "{{ trigger.event.data.user_name }}'s code has expired!"
```

#### Usage Limit Reached Event
Fired when a code reaches its usage limit:
```yaml
trigger:
  - platform: event
    event_type: yale_lock_manager_usage_limit_reached
action:
  - service: notify.mobile_app
    data:
      message: "{{ trigger.event.data.user_name }}'s code has reached its usage limit!"
```

### FOB/RFID Handling

FOBs and RFID cards are typically programmed directly on the lock. The integration will detect them automatically:

1. Pull codes from the lock using the service or Lovelace card
2. Slots with non-standard codes will be marked as FOB type
3. You can manage schedules and usage limits for FOB users
4. PIN codes cannot be set on FOB slots (hardware restriction)

## 🔐 Slot Protection

The integration prevents accidental code overwrites:

- Before setting a code, it checks if the slot is occupied
- If a slot contains an unknown code, you'll get an error
- You must clear the slot first before setting a new code
- Codes you've set can be updated without clearing

## 🔔 Notifications

The integration provides several sensors for monitoring:

- **Battery Level**: `sensor.yale_lock_battery`
- **Last Access**: `sensor.yale_lock_last_access` (timestamp)
- **Last User**: `sensor.yale_lock_last_user` (name)
- **Last Access Method**: `sensor.yale_lock_last_access_method` (PIN/FOB/Manual/Remote/Auto)
- **Door Status**: `binary_sensor.yale_lock_door` (open/closed)
- **Bolt Status**: `binary_sensor.yale_lock_bolt` (locked/unlocked)

## 🛠️ Troubleshooting

### Lock Not Showing in Setup

- Ensure your lock is properly paired with Z-Wave JS
- Verify the lock appears in Z-Wave JS integration
- Check that the lock is a Yale lock (manufacturer check)

### Codes Not Syncing

- Use the "Push to Lock" button in the Lovelace card
- Check Z-Wave network health
- Ensure the lock is awake (battery-powered devices sleep)
- Try the "Refresh from Lock" button

### Integration Not Loading

- Check Home Assistant logs for errors
- Verify Z-Wave JS integration is running
- Restart Home Assistant after installation

## 📝 Version History

See [CHANGELOG.md](CHANGELOG.md) for version history.

Current version: **1.0.0.0**

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👤 Author

**Wayne-WECIT**

- GitHub: [@Wayne-WECIT](https://github.com/Wayne-WECIT)

## 🙏 Acknowledgments

- Home Assistant community
- Z-Wave JS developers
- Yale for making great locks

## 🐛 Issues

If you find a bug or have a feature request, please open an issue on [GitHub](https://github.com/Wayne-WECIT/HA-Yale-Lock/issues).

## ⚠️ Disclaimer

This integration is not affiliated with or endorsed by Yale or ASSA ABLOY. Use at your own risk.
