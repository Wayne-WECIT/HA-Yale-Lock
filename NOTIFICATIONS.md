# Notification Configuration Guide

How per-slot notifications work in Yale Lock Manager and how to set them up (card and panel).

## Overview

Each user slot can have its own notification targets. When that slot is used to unlock the lock (PIN or FOB), the integration sends a notification to the targets you chose. You can pick:

- **Persistent Notification (UI)** – Notifications only in the Home Assistant UI
- **All Mobiles** – All registered mobile app devices (`notify.mobile_app_*`)
- **Individual devices** – One or more specific devices (e.g. iPhone, Android)

Configuration is done in the **expanded slot** in the card or panel (not in the main table). There are no “Test notification” buttons in the UI; you can test via the `send_test_notification` service in Developer Tools or in automations.

---

## Where to configure

1. Open the Yale Lock Manager **card** or **panel**.
2. Click a **slot row** to expand it.
3. In the expanded area, find **Notifications** (toggle) and the **chips** (UI, All Mobiles, individual devices).
4. Turn **Notifications** on, then tap one or more chips to select where to send.
5. Changes are saved immediately.

Only one of the two UIs (card or panel) is needed; both use the same backend and storage.

---

## Mobile app setup (for push notifications)

To receive push notifications on a phone or tablet:

1. Install the **Home Assistant** app (iOS App Store or Google Play).
2. Sign in to your Home Assistant instance so the device registers.
3. In Home Assistant: **Settings** → **Devices & Services** → **Mobile App** and confirm the device is listed and connected.
4. Enable **Notifications** for the app (iOS: Settings → Home Assistant → Notifications; Android: App settings → Notifications).

After registration, Home Assistant creates a notify service per device, e.g.:

- `notify.mobile_app_iphone`
- `notify.mobile_app_android`

There is no single `notify.mobile_app` service that sends to all devices. The integration **expands “All Mobiles”** internally: when you choose **All Mobiles**, the backend finds all `notify.mobile_app_*` services and sends to each of them. So “All Mobiles” in the UI really does send to every registered mobile device.

Individual device chips (e.g. “iPhone”, “S Fone”) appear in the list when the integration discovers `notify.mobile_app_*` services (from the frontend and/or the backend WebSocket `yale_lock_manager/get_notification_services`). Pick one or more devices if you want notifications only on specific phones/tablets.

---

## What gets sent

When a slot with notifications enabled is used to access the lock, the integration sends:

- **Title**: “Lock Access”
- **Message**: “{user_name} (Slot {user_slot}) unlocked the door via {method}”
- **Data** (for advanced use): entity_id, user_name, user_slot, method, timestamp, usage_count

---

## Testing notifications

There are **no “Test notification” buttons** in the card or panel. To test:

1. **Developer Tools** → **Services**
2. Service: `yale_lock_manager.send_test_notification`
3. Data: `entity_id: lock.smart_door_lock_manager` (your lock entity), `slot: 1` (or the slot you configured)
4. **Call service**

A test message is sent to that slot’s configured notification services (UI, All Mobiles, and/or the specific devices you selected). You can also call this service from automations or scripts.

---

## Configuring via services (advanced)

**Enable notifications and set targets**

```yaml
service: yale_lock_manager.set_notification_enabled
data:
  entity_id: lock.smart_door_lock_manager
  slot: 1
  enabled: true
  notification_services:
    - notify.persistent_notification
    - notify.mobile_app_iphone
```

**Disable notifications**

```yaml
service: yale_lock_manager.set_notification_enabled
data:
  entity_id: lock.smart_door_lock_manager
  slot: 1
  enabled: false
```

`notification_services` is a list. Use `notify.persistent_notification` for UI-only; use one or more `notify.mobile_app_<device_id>` for specific devices. The backend expands “All Mobiles” only when sending (e.g. on access or test); in the service you pass the exact service IDs you want.

---

## Troubleshooting

**Notifications not appearing on my phone**

- Confirm the device is under **Settings** → **Devices & Services** → **Mobile App** and shows as connected.
- Check app notification permissions (Settings → Home Assistant → Notifications, or Android app notifications).
- In Developer Tools → Services, call `yale_lock_manager.send_test_notification` for that slot and see if the UI notification and/or mobile app receive it.

**“All Mobiles” or individual devices not in the list**

- Ensure at least one mobile app device is registered (Mobile App in HA).
- Reload the card/panel (refresh the page). The list is built from discovered notify services and from the backend WebSocket `get_notification_services` if needed.
- Check the browser console (F12) for errors when loading the card/panel.

**Service not found / Action notify.mobile_app not found**

- Do **not** call `notify.mobile_app` directly; it does not exist. Use `notify.mobile_app_<device_id>` or, in the UI, use “All Mobiles” (the integration expands it for you).
- When calling `send_test_notification` or when the integration sends on access, it uses the slot’s stored `notification_services`; “All Mobiles” is expanded on the backend before calling notify.

---

## Best practices

- Use **UI** for slots where you only need a log in Home Assistant.
- Use **All Mobiles** when you want everyone with the HA app to get the alert.
- Use **specific devices** when only certain people should get that slot’s notifications.
- After changing targets, use **Developer Tools** → `yale_lock_manager.send_test_notification` to confirm delivery.
- Export/backup files contain notification settings; store them securely (they are in the same JSON as PINs).

---

## Related

- [README.md](README.md) – Main docs and services
- [QUICKSTART.md](QUICKSTART.md) – First-time setup
- [PANEL_SETUP.md](PANEL_SETUP.md) – Full-page panel
