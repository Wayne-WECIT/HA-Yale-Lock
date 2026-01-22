# Quick Start Guide

This guide will help you get Yale Lock Manager up and running quickly.

## Prerequisites

✅ Home Assistant 2026.1.2 or later  
✅ Z-Wave JS integration installed and configured  
✅ Yale Smart Door Lock paired with Z-Wave JS  

## Installation Steps

### 1. Install the Integration

**Option A: Via HACS (Recommended)**

1. Open HACS in Home Assistant
2. Go to **Integrations**
3. Click the **three dots** menu → **Custom repositories**
4. Add repository URL: `https://github.com/Wayne-WECIT/HA-Yale-Lock`
5. Category: **Integration**
6. Click **Add**
7. Find **"Yale Lock Manager"** and click **Install**
8. **Restart Home Assistant**

**Option B: Manual Installation**

1. Download the latest release ZIP
2. Extract `custom_components/yale_lock_manager` to your HA `config/custom_components/` folder
3. Extract `www/yale-lock-manager-card` to your HA `config/www/` folder
4. **Restart Home Assistant**

### 2. Set Up the Integration

1. Go to **Settings** → **Devices & Services**
2. Click **"+ Add Integration"**
3. Search for **"Yale Lock Manager"**
4. Select your Yale lock from the dropdown
5. Click **Submit**

Your lock is now configured! You'll see a **new device** called **"Smart Door Lock Manager"** with:
- 🔐 Lock entity: `lock.smart_door_lock_manager`
- 🔋 Battery sensor
- 🕐 Last access sensors (timestamp, user, method)
- 🚪 Door and bolt binary sensors

**Note:** This is separate from your Z-Wave lock device. You'll have two devices:
1. **Smart Door Lock Manager** (Yale Lock Manager) - For code management
2. **Smart Door Lock** (Z-Wave JS) - Original lock device

### 3. Add the Lovelace Card

1. **Add the Resource:**
   - Go to **Settings** → **Dashboards**
   - Click **three dots** → **Resources**
   - Click **"+ Add Resource"**
   - URL: `/local/yale_lock_manager/yale-lock-manager-card.js`
   - Resource type: **JavaScript Module**
   - Click **Create**
   
   **Note:** The integration automatically copies the card file to `www/yale_lock_manager/` during setup.

2. **Add the Card to Dashboard:**
   - Go to any dashboard
   - Click **Edit Dashboard**
   - Click **"+ Add Card"**
   - Search for **"Custom: Yale Lock Manager Card"**
   - Or manually add YAML:
     ```yaml
     type: custom:yale-lock-manager-card
     entity: lock.smart_door_lock_manager  # Your lock entity ID
     ```
   - Click **Save**

### 4. Initial Configuration

#### Pull Existing Codes from Lock

If you already have codes programmed on your lock:

1. In the Lovelace card, click **"⟳ Refresh from Lock"**
2. Wait a moment for the sync to complete
3. All existing codes will now appear in the card

OR use the service:
```yaml
service: yale_lock_manager.pull_codes_from_lock
```

#### Add Your First User Code

**Via Lovelace Card:**
1. Click on an empty slot (e.g., Slot 3)
2. Enter the user name (e.g., "Guest")
3. Enter a PIN code (4-10 digits)
4. Select code type (PIN or FOB)
5. Click **"Set Code"**
6. Toggle the status switch to **ON**
7. Click **"Push"** to sync to the lock

**Via Service:**
```yaml
service: yale_lock_manager.set_user_code
data:
  slot: 3
  code: "1234"
  name: "Guest"
  code_type: "pin"
```

Then push to lock:
```yaml
service: yale_lock_manager.push_code_to_lock
data:
  slot: 3
```

### 5. Set Up Notifications (Optional)

Create an automation to get notified when someone unlocks the door:

```yaml
automation:
  - alias: "Notify on Door Unlock"
    trigger:
      - platform: event
        event_type: yale_lock_manager_access
    action:
      - service: notify.mobile_app
        data:
          title: "🔓 Door Unlocked"
          message: >
            {{ trigger.event.data.user_name }} unlocked the door at 
            {{ trigger.event.data.timestamp }}
```

### 6. Advanced Features

#### Time-Based Access

Set a code that only works during specific dates:

```yaml
service: yale_lock_manager.set_user_schedule
data:
  slot: 3
  start_datetime: "2026-01-01 00:00:00"
  end_datetime: "2026-01-31 23:59:59"
```

#### Usage Limits

Set a code that can only be used 5 times:

```yaml
service: yale_lock_manager.set_usage_limit
data:
  slot: 3
  max_uses: 5
```

## Common Tasks

### View Battery Level
Check the **Battery** sensor: `sensor.yale_smart_door_lock_battery`

### See Last Access
Check **Last User** and **Last Access** sensors

### Lock/Unlock via Automation
```yaml
# Lock
service: lock.lock
target:
  entity_id: lock.smart_door_lock_manager

# Unlock
service: lock.unlock
target:
  entity_id: lock.smart_door_lock_manager
```

### Disable a User Temporarily
```yaml
service: yale_lock_manager.disable_user
data:
  slot: 3
```

### Re-enable a User
```yaml
service: yale_lock_manager.enable_user
data:
  slot: 3
```

## Troubleshooting

### Lock Not Appearing in Setup
- Verify your lock is paired with Z-Wave JS
- Check it's a Yale lock (manufacturer: Yale)
- Restart Home Assistant

### Codes Not Syncing
- Click "Push" button in the card
- Wake up your lock (press any button)
- Check Z-Wave network health
- Battery-powered locks sleep frequently

### Card Not Showing
- Verify resource is added correctly
- Clear browser cache (Ctrl+Shift+R)
- Check browser console for errors

### Events Not Firing
- Check Z-Wave JS is receiving notifications
- Enable debug logging:
  ```yaml
  logger:
    default: info
    logs:
      custom_components.yale_lock_manager: debug
  ```

## Need Help?

- 📖 Read the full [README.md](README.md)
- 🐛 Report issues on [GitHub](https://github.com/Wayne-WECIT/HA-Yale-Lock/issues)
- 💬 Ask questions in GitHub Discussions

## What's Next?

- Set up schedules for temporary guests
- Create automations for specific users
- Monitor usage statistics
- Set up low battery alerts

Enjoy your Yale Lock Manager! 🔐
