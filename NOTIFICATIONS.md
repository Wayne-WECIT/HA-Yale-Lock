# Notification Configuration Guide

This guide explains how to configure notifications for the Yale Lock Manager integration, including push notifications to iOS and Android mobile devices.

## Overview

The Yale Lock Manager supports per-slot notifications that can be sent when a user code (PIN or FOB) is used to access the lock. Notifications can be configured to appear in the Home Assistant UI only, or as push notifications to mobile devices.

## Mobile App Setup

To receive push notifications on your iOS or Android device, you need to:

1. **Install the Home Assistant Mobile App**:
   - iOS: Download from the [App Store](https://apps.apple.com/app/home-assistant/id1099568401)
   - Android: Download from [Google Play](https://play.google.com/store/apps/details?id=io.homeassistant.companion.android)

2. **Register Your Device**:
   - Open the Home Assistant mobile app
   - Sign in to your Home Assistant instance
   - The app will automatically register with Home Assistant
   - Your device will appear in Home Assistant under **Settings > Devices & Services > Mobile App**

3. **Verify Notification Service**:
   - After registration, the following notification services should be available:
     - `notify.mobile_app` - Sends to all registered mobile devices
     - `notify.mobile_app_<device_id>` - Sends to a specific device (e.g., `notify.mobile_app_iphone`)

## Configuring Notifications via UI

### Enable Notifications for a Slot

1. Open the Yale Lock Manager card or panel in Home Assistant
2. Find the slot you want to configure
3. Toggle the **Notifications** switch in the main table (the bell icon column)
4. The notification will be enabled immediately

### Select Notification Service

1. Expand the slot row to view detailed settings
2. Scroll to the **Notification Service** dropdown
3. Select your preferred service:
   - **Persistent Notification (UI only)** - Shows notifications only in the Home Assistant UI
   - **Mobile App (All devices)** - Sends push notifications to all registered mobile devices

4. The service selection is saved immediately when changed

## Available Notification Services

### `notify.persistent_notification` (Default)
- **Type**: UI-only notifications
- **Where**: Appears in Home Assistant UI (Notifications panel)
- **Use Case**: When you only want to see notifications in the Home Assistant interface
- **No Setup Required**: Works out of the box

### `notify.mobile_app`
- **Type**: Push notifications
- **Where**: All registered iOS and Android devices
- **Use Case**: When you want push notifications on all your mobile devices
- **Setup Required**: Home Assistant mobile app must be installed and registered

### `notify.mobile_app_<device_id>`
- **Type**: Push notifications to specific device
- **Where**: One specific mobile device
- **Use Case**: When you want notifications only on a specific device
- **Setup Required**: Home Assistant mobile app must be installed and registered
- **Finding Device ID**: Check **Settings > Devices & Services > Mobile App** in Home Assistant

## Notification Content

When a slot with notifications enabled is used, a notification is sent with:

- **Title**: "Lock Access"
- **Message**: "{user_name} (Slot {user_slot}) unlocked the door via {method}"
- **Data**:
  - `entity_id`: The lock entity ID
  - `user_name`: Name of the user/slot
  - `user_slot`: Slot number (1-20)
  - `method`: Access method (PIN, FOB, etc.)
  - `timestamp`: ISO timestamp of the access event
  - `usage_count`: Current usage count for the slot

## Advanced: Service Call Method

For advanced users, you can configure notifications programmatically using Home Assistant service calls:

### Enable Notifications

```yaml
service: yale_lock_manager.set_notification_enabled
data:
  entity_id: lock.smart_door_lock
  slot: 1
  enabled: true
  notification_service: notify.mobile_app
```

### Disable Notifications

```yaml
service: yale_lock_manager.set_notification_enabled
data:
  entity_id: lock.smart_door_lock
  slot: 1
  enabled: false
```

### Change Notification Service

```yaml
service: yale_lock_manager.set_notification_enabled
data:
  entity_id: lock.smart_door_lock
  slot: 1
  enabled: true
  notification_service: notify.mobile_app_iphone
```

## Troubleshooting

### Notifications Not Appearing on Mobile Device

1. **Check Mobile App Registration**:
   - Open Home Assistant
   - Go to **Settings > Devices & Services > Mobile App**
   - Verify your device is listed and shows as "Connected"

2. **Check Notification Permissions**:
   - iOS: Settings > Home Assistant > Notifications (must be enabled)
   - Android: Settings > Apps > Home Assistant > Notifications (must be enabled)

3. **Verify Service Availability**:
   - Go to **Developer Tools > Services** in Home Assistant
   - Search for `notify.mobile_app`
   - If it doesn't appear, the mobile app may not be properly registered

4. **Check Home Assistant Logs**:
   - Look for errors related to notification sending
   - Check if the notification service name is correct

### Notification Service Not Available in Dropdown

The UI currently shows two common options:
- `notify.persistent_notification` (always available)
- `notify.mobile_app` (requires mobile app)

If you need a device-specific service (e.g., `notify.mobile_app_iphone`), you can:
1. Use the service call method (see Advanced section above)
2. Or manually edit the service name if the UI supports it in the future

## Best Practices

1. **Use Mobile App for Important Slots**: Enable mobile app notifications for slots you want to monitor closely
2. **Use Persistent Notifications for Logging**: Use UI-only notifications for slots where you just want a record in Home Assistant
3. **Test After Setup**: After configuring notifications, test by using the slot to ensure notifications are received
4. **Battery Considerations**: Mobile push notifications use device battery, so consider this for frequently-used slots

## Related Documentation

- [Home Assistant Mobile App Documentation](https://www.home-assistant.io/integrations/mobile_app/)
- [Home Assistant Notifications](https://www.home-assistant.io/integrations/notify/)
