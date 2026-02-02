# Yale Lock Manager Panel Setup

The integration includes a **full-page custom panel** with the same features as the Lovelace card: user slots, expanded settings, notifications (chips), Export/Import (with confirmations), Clear Cache, and Debug panel.

## Accessing the panel

### Option 1: Direct URL

Open in your browser (replace with your HA host/port if needed):

```
http://your-ha-ip:8123/local/yale_lock_manager/yale-lock-manager-panel.html
```

Or from the HA frontend:

```
/config/www/yale_lock_manager/yale-lock-manager-panel.html
```

### Option 2: Add to sidebar (manual)

1. **Settings** → **Dashboards** → **Panels**
2. **+ Add Panel**
3. **Title**: Yale Lock Manager  
   **URL**: `/local/yale_lock_manager/yale-lock-manager-panel.html`  
   **Icon**: `mdi:lock` (optional)
4. **Save**

### Option 3: YAML (panel_custom)

Add to `configuration.yaml`:

```yaml
panel_custom:
  - name: yale-lock-manager
    sidebar_title: Yale Lock Manager
    sidebar_icon: mdi:lock
    url_path: yale-lock-manager
    webcomponent_path: /local/yale_lock_manager/yale-lock-manager-panel.html
    embed_iframe: true
```

Restart Home Assistant.

---

## Panel features

- **Same as the card**: Lock/Unlock, Refresh, Export (with sensitive-data confirmation), table of slots, expanded slot (name, code, type, schedule, usage limit, notification chips), Set Code, Push, Clear, Export backup / Import backup (with confirmations), Clear Local Cache, Debug panel.
- **Full-page layout**: More space for the table and expanded slot.
- **Uncontrolled inputs**: Form values are set once when the slot expands and read from the DOM; entity updates do not overwrite what you typed until you change or collapse the slot.
- **Auto entity**: If no entity is configured, the panel tries to find the Yale Lock Manager lock entity automatically.

---

## File locations

The integration copies frontend files into `www/yale_lock_manager/` when the integration loads. You should have:

- `config/www/yale_lock_manager/yale-lock-manager-panel.html`
- `config/www/yale_lock_manager/yale-lock-manager-panel.js`
- `config/www/yale_lock_manager/yale-lock-manager-card.js`

Resource URL for the **card** (Lovelace): `/local/yale_lock_manager/yale-lock-manager-card.js`  
Panel URL: `/local/yale_lock_manager/yale-lock-manager-panel.html`

---

## Troubleshooting

**“No Yale Lock Manager found”**

- Ensure the integration is installed and the Yale Lock Manager device/entity exists.
- The panel looks for an entity whose ID contains “manager” (e.g. `lock.smart_door_lock_manager`). If your entity name is different, you may need to set the entity in the panel config (if supported) or ensure the integration created the expected entity.

**Panel doesn’t load / blank page**

- Confirm the files exist under `config/www/yale_lock_manager/` (panel HTML and JS).
- Restart Home Assistant after installing or updating the integration.
- Check the browser console (F12) for errors.
- Clear browser cache and reload.

**Export/Import or notifications not working**

- Export/Import and notifications work the same as on the card; see [README.md](README.md), [NOTIFICATIONS.md](NOTIFICATIONS.md), and [QUICKSTART.md](QUICKSTART.md).

---

## Related

- [README.md](README.md) – Main docs
- [QUICKSTART.md](QUICKSTART.md) – First-time setup
- [NOTIFICATIONS.md](NOTIFICATIONS.md) – Per-slot notifications
