# Yale Lock Manager Panel Setup

## Custom Panel Dashboard

The integration now includes a **full-page custom panel dashboard** that provides a better UX for managing your Yale lock codes.

## Accessing the Panel

### Option 1: Direct URL
Navigate to:
```
http://your-ha-ip:8123/local/yale_lock_manager/yale-lock-manager-panel.html
```

### Option 2: Add to Sidebar (Manual)
1. Go to **Settings** → **Dashboards** → **Panels**
2. Click **"+ Add Panel"**
3. Enter:
   - **Title**: Yale Lock Manager
   - **URL**: `/local/yale_lock_manager/yale-lock-manager-panel.html`
   - **Icon**: `mdi:lock` (optional)
4. Click **Save**

### Option 3: Add via Configuration (YAML)
Add to your `configuration.yaml`:
```yaml
panel_custom:
  - name: yale-lock-manager
    sidebar_title: Yale Lock Manager
    sidebar_icon: mdi:lock
    url_path: yale-lock-manager
    webcomponent_path: /local/yale_lock_manager/yale-lock-manager-panel.html
    embed_iframe: true
```

Then restart Home Assistant.

## Features

✅ **Full-page interface** - More space for managing codes  
✅ **Uncontrolled input pattern** - Form fields never revert after save  
✅ **Auto-detects entity** - Automatically finds your Yale Lock Manager entity  
✅ **Same functionality** - All features from the card, optimized for dashboard  

## How It Solves the Refresh Issue

The panel uses the **uncontrolled input pattern**:
- Form field values are set **once** when the slot expands
- After that, values are **read from the DOM**, never overwritten
- Entity state updates **don't affect** what you've typed
- Your input persists until you change it or collapse the slot

This is the same pattern used by React, Vue, and other modern frameworks for form state management.

## Troubleshooting

**Panel shows "No Yale Lock Manager found":**
- Make sure the integration is set up and the entity exists
- Check that the entity ID contains "manager" (e.g., `lock.smart_door_lock_manager`)

**Panel doesn't load:**
- Check that files are copied to `/config/www/yale_lock_manager/`
- Verify the files exist:
  - `yale-lock-manager-panel.html`
  - `yale-lock-manager-panel.js`
- Restart Home Assistant after installation
