class YaleLockManagerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._expandedSlot = null;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('You must specify an entity');
    }
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  get hass() {
    return this._hass;
  }

  render() {
    if (!this._hass || !this._config) return;

    const entityId = this._config.entity;
    const stateObj = this._hass.states[entityId];

    if (!stateObj) {
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            padding: 16px;
          }
          .error {
            color: var(--error-color);
            padding: 16px;
            background: var(--error-color-background, rgba(255, 0, 0, 0.1));
            border-radius: 4px;
          }
        </style>
        <ha-card>
          <div class="error">
            ⚠️ Entity "${entityId}" not found
          </div>
        </ha-card>
      `;
      return;
    }

    const users = this.getUserData();
    const isLocked = stateObj.state === 'locked';
    const batteryLevel = stateObj.attributes.battery_level || 0;
    const doorStatus = stateObj.attributes.door_status || 'unknown';
    const boltStatus = stateObj.attributes.bolt_status || 'unknown';
    const totalUsers = stateObj.attributes.total_users || 0;
    const enabledUsers = stateObj.attributes.enabled_users || 0;

    this.shadowRoot.innerHTML = this.getStyles() + this.getHTML(users, isLocked, batteryLevel, doorStatus, boltStatus, totalUsers, enabledUsers);

    // Attach event listeners AFTER rendering
    this.attachEventListeners();
  }

  getStyles() {
    return `
      <style>
        :host {
          display: block;
        }
        ha-card {
          padding: 16px;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 2px solid var(--divider-color);
        }
        .lock-status {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .status-icon {
          font-size: 32px;
        }
        .status-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .status-line {
          font-size: 0.9em;
          color: var(--secondary-text-color);
        }
        .lock-button {
          padding: 12px 24px;
          background: var(--primary-color);
          color: var(--text-primary-color);
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          transition: all 0.3s;
        }
        .lock-button:hover {
          opacity: 0.9;
          transform: scale(1.05);
        }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 16px 0 12px 0;
          padding: 8px 0;
          border-bottom: 1px solid var(--divider-color);
        }
        .section-header span {
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .refresh-button {
          padding: 6px 12px;
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
        }
        .refresh-button:hover {
          background: var(--divider-color);
        }
        .user-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 8px;
        }
        .user-table th {
          background: var(--table-row-alternative-background-color);
          padding: 10px 8px;
          text-align: left;
          font-weight: 600;
          font-size: 0.85em;
          color: var(--primary-text-color);
          border-bottom: 2px solid var(--divider-color);
        }
        .user-row {
          cursor: pointer;
          transition: background 0.2s;
        }
        .user-row:hover {
          background: var(--table-row-background-color);
        }
        .user-row td {
          padding: 12px 8px;
          border-bottom: 1px solid var(--divider-color);
        }
        .expanded-row {
          background: var(--table-row-alternative-background-color) !important;
        }
        .expanded-content {
          padding: 16px;
          background: var(--card-background-color);
          border-radius: 4px;
        }
        .expanded-content h3 {
          margin: 0 0 16px 0;
          color: var(--primary-color);
        }
        .form-group {
          margin-bottom: 16px;
        }
        .form-group label {
          display: block;
          margin-bottom: 6px;
          font-weight: 500;
          color: var(--primary-text-color);
        }
        .form-group input,
        .form-group select {
          width: 100%;
          padding: 10px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          box-sizing: border-box;
        }
        .action-button {
          padding: 8px 16px;
          background: var(--primary-color);
          color: var(--text-primary-color);
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
          margin-right: 8px;
          margin-top: 8px;
        }
        .action-button:hover {
          opacity: 0.9;
        }
        .action-button.secondary {
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          border: 1px solid var(--divider-color);
        }
        .action-button.small {
          padding: 4px 8px;
          font-size: 12px;
        }
        .code-type-icon {
          font-size: 18px;
        }
        .sync-indicator {
          font-size: 16px;
        }
        .sync-indicator.synced {
          color: var(--success-color, #4caf50);
        }
        .sync-indicator.unsynced {
          color: var(--warning-color, #ff9800);
        }
        .toggle-switch {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }
        .toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: var(--switch-unchecked-color, #ccc);
          transition: .4s;
          border-radius: 24px;
        }
        .slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: .4s;
          border-radius: 50%;
        }
        input:checked + .slider {
          background-color: var(--switch-checked-color, var(--primary-color));
        }
        input:checked + .slider:before {
          transform: translateX(20px);
        }
      </style>
    `;
  }

  getHTML(users, isLocked, batteryLevel, doorStatus, boltStatus, totalUsers, enabledUsers) {
    const userRows = Array.from({ length: 20 }, (_, i) => i + 1).map(slot => {
      const user = users[slot];
      const isExpanded = this._expandedSlot === slot;
      
      return `
        <tr class="user-row ${isExpanded ? 'expanded-row' : ''}" data-slot="${slot}">
          <td>${slot}</td>
          <td>
            ${user.name ? user.name : '<em style="color: var(--secondary-text-color)">Empty Slot</em>'}
          </td>
          <td>
            <span class="code-type-icon">
              ${user.code_type === 'pin' ? '🔢' : user.code_type === 'fob' ? '🏷️' : '--'}
            </span>
          </td>
          <td>
            <label class="toggle-switch" data-slot="${slot}">
              <input type="checkbox" ${user.enabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </td>
          <td>
            <span class="sync-indicator ${user.synced_to_lock ? 'synced' : 'unsynced'}">
              ${user.synced_to_lock ? '✓' : '⚠️'}
            </span>
          </td>
          <td>
            ${user.name ? `
              <button class="action-button small" data-action="push" data-slot="${slot}">Push</button>
            ` : `
              <button class="action-button small secondary" data-action="expand" data-slot="${slot}">Set</button>
            `}
          </td>
        </tr>
        ${isExpanded ? `
          <tr class="expanded-row">
            <td colspan="6">
              <div class="expanded-content">
                <h3>Slot ${slot} Settings</h3>
                
                <div class="form-group">
                  <label>User Name:</label>
                  <input type="text" id="name-${slot}" value="${user.name || ''}" placeholder="Enter name">
                </div>
                
                <div class="form-group">
                  <label>Code Type:</label>
                  <select id="type-${slot}">
                    <option value="pin" ${user.code_type === 'pin' ? 'selected' : ''}>PIN Code</option>
                    <option value="fob" ${user.code_type === 'fob' ? 'selected' : ''}>FOB/RFID Card</option>
                  </select>
                </div>
                
                ${user.code_type !== 'fob' ? `
                  <div class="form-group">
                    <label>PIN Code (4-10 digits):</label>
                    <input type="text" id="code-${slot}" value="${user.code || ''}" placeholder="Enter PIN code (e.g., 1234)" maxlength="10" pattern="[0-9]*">
                  </div>
                ` : `
                  <div class="form-group">
                    <label>FOB/RFID:</label>
                    <p style="color: var(--secondary-text-color); margin: 4px 0; padding: 8px; background: var(--table-row-alternative-background-color); border-radius: 4px;">
                      🏷️ This slot is for a FOB/RFID card. The code will be read automatically when the card is presented to the lock.
                    </p>
                  </div>
                `}
                
                <button class="action-button" data-action="set-code" data-slot="${slot}">
                  ${user.name ? 'Update User' : 'Set User'}
                </button>
                
                ${user.name ? `
                  <button class="action-button secondary" data-action="clear" data-slot="${slot}">Clear Slot</button>
                ` : ''}
                
                <hr style="margin: 16px 0; border: none; border-top: 1px solid var(--divider-color);">
                
                <div class="form-group">
                  <label>Schedule (optional):</label>
                  <p style="color: var(--secondary-text-color); font-size: 0.85em; margin: 4px 0 8px 0;">
                    ⏰ Set a time range when this code is valid. Leave blank for 24/7 access.
                  </p>
                  <div style="display: flex; gap: 8px; margin-top: 4px;">
                    <div style="flex: 1;">
                      <label style="font-size: 0.8em; color: var(--secondary-text-color);">Start Date/Time:</label>
                      <input type="datetime-local" id="start-${slot}" value="${user.schedule?.start ? user.schedule.start.substring(0, 16) : ''}">
                    </div>
                    <div style="flex: 1;">
                      <label style="font-size: 0.8em; color: var(--secondary-text-color);">End Date/Time:</label>
                      <input type="datetime-local" id="end-${slot}" value="${user.schedule?.end ? user.schedule.end.substring(0, 16) : ''}">
                    </div>
                  </div>
                  <button class="action-button secondary" style="margin-top: 8px;" data-action="save-schedule" data-slot="${slot}">
                    ${user.schedule?.start || user.schedule?.end ? 'Update Schedule' : 'Set Schedule'}
                  </button>
                </div>
                
                <div class="form-group">
                  <label>Usage Limit (optional):</label>
                  <p style="color: var(--secondary-text-color); font-size: 0.85em; margin: 4px 0 8px 0;">
                    🔢 Limit how many times this code can be used. Leave blank for unlimited.
                  </p>
                  <input type="number" id="limit-${slot}" value="${user.usage_limit || ''}" placeholder="Unlimited (e.g., 5 uses)" min="1">
                  ${user.usage_count ? `
                    <p style="color: var(--warning-color, #ff9800); font-size: 0.85em; margin: 4px 0;">
                      ⚠️ Used ${user.usage_count} time${user.usage_count !== 1 ? 's' : ''}${user.usage_limit ? ` / ${user.usage_limit} max` : ''}
                    </p>
                  ` : ''}
                  <button class="action-button secondary" style="margin-top: 8px;" data-action="save-limit" data-slot="${slot}">
                    ${user.usage_limit ? 'Update Limit' : 'Set Limit'}
                  </button>
                </div>
              </div>
            </td>
          </tr>
        ` : ''}
      `;
    }).join('');

    return `
      <ha-card>
        <div class="header">
          <div class="lock-status">
            <div class="status-icon">${isLocked ? '🔒' : '🔓'}</div>
            <div class="status-info">
              <div class="status-line">
                🔋 ${batteryLevel}% Battery
              </div>
              <div class="status-line">
                • Bolt: ${boltStatus.charAt(0).toUpperCase() + boltStatus.slice(1)}
                • Door: ${doorStatus.charAt(0).toUpperCase() + doorStatus.slice(1)}
              </div>
              <div class="status-line">
                ${totalUsers} users configured • ${enabledUsers} enabled
              </div>
            </div>
          </div>
          <button class="lock-button" id="lock-toggle">
            ${isLocked ? '🔓 Unlock' : '🔒 Lock'}
          </button>
        </div>

        <div class="section-header">
          <span>USER CODES</span>
          <button class="refresh-button" id="refresh-btn">
            ⟳ Refresh from Lock
          </button>
        </div>

        <table class="user-table">
          <thead>
            <tr>
              <th style="width: 40px">#</th>
              <th>Name</th>
              <th style="width: 60px">Type</th>
              <th style="width: 80px">Status</th>
              <th style="width: 60px">Sync</th>
              <th style="width: 100px">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${userRows}
          </tbody>
        </table>
      </ha-card>
    `;
  }

  getUserData() {
    if (!this._hass || !this._config) return {};
    
    const stateObj = this._hass.states[this._config.entity];
    if (!stateObj || !stateObj.attributes.users) return {};

    const users = {};
    const userData = stateObj.attributes.users;
    
    for (let i = 1; i <= 20; i++) {
      users[i] = userData[i] || {
        name: '',
        code: '',
        code_type: 'pin',
        enabled: false,
        synced_to_lock: false,
        schedule: null,
        usage_limit: null,
        usage_count: 0,
      };
    }
    
    return users;
  }

  attachEventListeners() {
    // Lock/unlock button
    const lockButton = this.shadowRoot.getElementById('lock-toggle');
    if (lockButton) {
      lockButton.addEventListener('click', () => this.handleLockToggle());
    }

    // Refresh button
    const refreshButton = this.shadowRoot.getElementById('refresh-btn');
    if (refreshButton) {
      refreshButton.addEventListener('click', () => this.handleRefresh());
    }

    // User row clicks (expand/collapse)
    this.shadowRoot.querySelectorAll('.user-row').forEach(row => {
      const slot = parseInt(row.dataset.slot);
      row.addEventListener('click', (e) => {
        // Don't toggle if clicking on buttons or toggle switches
        if (e.target.closest('button') || e.target.closest('.toggle-switch')) {
          return;
        }
        this.toggleExpand(slot);
      });
    });

    // Toggle switches
    this.shadowRoot.querySelectorAll('.toggle-switch').forEach(toggle => {
      const slot = parseInt(toggle.dataset.slot);
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const input = toggle.querySelector('input');
        this.handleToggleUser(slot, input.checked);
      });
    });

    // All action buttons
    this.shadowRoot.querySelectorAll('[data-action]').forEach(button => {
      const action = button.dataset.action;
      const slot = parseInt(button.dataset.slot);
      
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        
        switch (action) {
          case 'push':
            this.handlePushCode(slot);
            break;
          case 'expand':
            this.toggleExpand(slot);
            break;
          case 'set-code':
            this.handleSetCode(slot);
            break;
          case 'clear':
            this.handleClearCode(slot);
            break;
          case 'save-schedule':
            this.handleSaveSchedule(slot);
            break;
          case 'save-limit':
            this.handleSaveUsageLimit(slot);
            break;
        }
      });
    });
  }

  toggleExpand(slot) {
    this._expandedSlot = this._expandedSlot === slot ? null : slot;
    this.render();
  }

  async handleLockToggle() {
    const stateObj = this._hass.states[this._config.entity];
    const service = stateObj.state === 'locked' ? 'unlock' : 'lock';
    
    await this._hass.callService('lock', service, {
      entity_id: this._config.entity
    });
  }

  async handleRefresh() {
    await this._hass.callService('yale_lock_manager', 'pull_codes_from_lock', {
      entity_id: this._config.entity
    });
  }

  async handleSetCode(slot) {
    const name = this.shadowRoot.getElementById(`name-${slot}`).value.trim();
    const codeType = this.shadowRoot.getElementById(`type-${slot}`).value;
    const code = codeType === 'pin' ? this.shadowRoot.getElementById(`code-${slot}`)?.value.trim() : '';

    if (!name) {
      alert('Please enter a user name');
      return;
    }

    if (codeType === 'pin' && (!code || code.length < 4 || code.length > 10)) {
      alert('PIN code must be between 4-10 digits');
      return;
    }

    await this._hass.callService('yale_lock_manager', 'set_user_code', {
      entity_id: this._config.entity,
      slot: slot,
      name: name,
      code: code,
      code_type: codeType
    });

    alert(`✅ User code set for slot ${slot}`);
    this.render();
  }

  async handlePushCode(slot) {
    if (!confirm(`Push this code to the lock now?`)) return;

    await this._hass.callService('yale_lock_manager', 'push_code_to_lock', {
      entity_id: this._config.entity,
      slot: slot
    });

    alert(`✅ Code pushed to lock`);
  }

  async handleClearCode(slot) {
    if (!confirm(`Clear slot ${slot}? This will remove all settings.`)) return;

    await this._hass.callService('yale_lock_manager', 'clear_user_code', {
      entity_id: this._config.entity,
      slot: slot
    });

    this._expandedSlot = null;
    alert(`✅ Slot ${slot} cleared`);
    this.render();
  }

  async handleToggleUser(slot, currentState) {
    const service = currentState ? 'disable_user' : 'enable_user';
    await this._hass.callService('yale_lock_manager', service, {
      entity_id: this._config.entity,
      slot: slot
    });
  }

  async handleSaveSchedule(slot) {
    const start = this.shadowRoot.getElementById(`start-${slot}`).value;
    const end = this.shadowRoot.getElementById(`end-${slot}`).value;

    await this._hass.callService('yale_lock_manager', 'set_user_schedule', {
      entity_id: this._config.entity,
      slot: slot,
      start_datetime: start,
      end_datetime: end
    });

    alert(`✅ Schedule saved`);
  }

  async handleSaveUsageLimit(slot) {
    const limit = parseInt(this.shadowRoot.getElementById(`limit-${slot}`).value) || null;

    await this._hass.callService('yale_lock_manager', 'set_usage_limit', {
      entity_id: this._config.entity,
      slot: slot,
      max_uses: limit
    });

    alert(`✅ Usage limit saved`);
  }

  getCardSize() {
    return 10;
  }
}

customElements.define('yale-lock-manager-card', YaleLockManagerCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'yale-lock-manager-card',
  name: 'Yale Lock Manager Card',
  description: 'Card for managing Yale lock user codes',
  preview: true,
});
