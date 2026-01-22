class YaleLockManagerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = null;
    this._expandedSlot = null;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Please define an entity');
    }
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  async callService(service, data) {
    await this._hass.callService('yale_lock_manager', service, data);
    // Request update after a short delay
    setTimeout(() => this._hass.callService('homeassistant', 'update_entity', {
      entity_id: this._config.entity
    }), 1000);
  }

  toggleExpand(slot) {
    this._expandedSlot = this._expandedSlot === slot ? null : slot;
    this.render();
  }

  async handleLockToggle() {
    const lockEntity = this._hass.states[this._config.entity];
    const isLocked = lockEntity.state === 'locked';
    
    await this._hass.callService('lock', isLocked ? 'unlock' : 'lock', {
      entity_id: this._config.entity
    });
  }

  async handleSetCode(slot) {
    const name = this.shadowRoot.getElementById(`name-${slot}`).value;
    const codeType = this.shadowRoot.getElementById(`type-${slot}`).value;
    
    if (!name) {
      alert('Please enter a user name');
      return;
    }

    let code = '';
    
    // Only require PIN code for PIN type
    if (codeType === 'pin') {
      const codeInput = this.shadowRoot.getElementById(`code-${slot}`);
      code = codeInput ? codeInput.value : '';
      
      if (!code) {
        alert('Please enter a PIN code');
        return;
      }

      if (code.length < 4 || code.length > 10) {
        alert('PIN code must be 4-10 digits');
        return;
      }
      
      if (!/^\d+$/.test(code)) {
        alert('PIN code must contain only numbers');
        return;
      }
    }

    try {
      await this.callService('set_user_code', {
        slot: slot,
        name: name,
        code: code || null,
        code_type: codeType
      });
      alert(`User "${name}" configured successfully!${codeType === 'fob' ? '\n\nPresent the FOB/RFID card to the lock to pair it with this slot.' : ''}`);
    } catch (err) {
      alert('Error setting user: ' + err.message);
    }
  }

  async handlePushCode(slot) {
    try {
      await this.callService('push_code_to_lock', { slot: slot });
      alert('Code pushed to lock successfully!');
    } catch (err) {
      alert('Error pushing code: ' + err.message);
    }
  }

  async handleClearCode(slot) {
    if (!confirm(`Are you sure you want to clear code for slot ${slot}?`)) {
      return;
    }

    try {
      await this.callService('clear_user_code', { slot: slot });
      alert('Code cleared successfully!');
    } catch (err) {
      alert('Error clearing code: ' + err.message);
    }
  }

  async handleToggleUser(slot, enabled) {
    try {
      await this.callService(enabled ? 'disable_user' : 'enable_user', { slot: slot });
    } catch (err) {
      alert('Error toggling user: ' + err.message);
    }
  }

  async handleSaveSchedule(slot) {
    const startDate = this.shadowRoot.getElementById(`start-${slot}`).value;
    const endDate = this.shadowRoot.getElementById(`end-${slot}`).value;

    try {
      await this.callService('set_user_schedule', {
        slot: slot,
        start_datetime: startDate || null,
        end_datetime: endDate || null
      });
      alert('Schedule saved successfully!');
    } catch (err) {
      alert('Error saving schedule: ' + err.message);
    }
  }

  async handleSaveUsageLimit(slot) {
    const maxUses = this.shadowRoot.getElementById(`limit-${slot}`).value;

    try {
      await this.callService('set_usage_limit', {
        slot: slot,
        max_uses: maxUses ? parseInt(maxUses) : null
      });
      alert('Usage limit saved successfully!');
    } catch (err) {
      alert('Error saving usage limit: ' + err.message);
    }
  }

  async handleRefresh() {
    try {
      await this.callService('pull_codes_from_lock', {});
      alert('Codes refreshed from lock!');
    } catch (err) {
      alert('Error refreshing codes: ' + err.message);
    }
  }

  getUserData() {
    // Get user data from the lock entity attributes
    const lockEntity = this._hass.states[this._config.entity];
    if (!lockEntity || !lockEntity.attributes.users) {
      // Return empty structure if no data available
      const users = {};
      for (let i = 1; i <= 20; i++) {
        users[i] = {
          slot: i,
          name: '',
          code: '',
          code_type: 'pin',
          enabled: false,
          synced_to_lock: false,
          schedule: { start: null, end: null },
          usage_limit: null,
          usage_count: 0
        };
      }
      return users;
    }
    
    // Get real user data from entity attributes
    const userData = lockEntity.attributes.users || {};
    const users = {};
    
    for (let i = 1; i <= 20; i++) {
      if (userData[i]) {
        users[i] = {
          slot: i,
          name: userData[i].name || '',
          code: userData[i].code || '',
          code_type: userData[i].code_type || 'pin',
          enabled: userData[i].enabled || false,
          synced_to_lock: userData[i].synced_to_lock || false,
          schedule: userData[i].schedule || { start: null, end: null },
          usage_limit: userData[i].usage_limit || null,
          usage_count: userData[i].usage_count || 0
        };
      } else {
        users[i] = {
          slot: i,
          name: '',
          code: '',
          code_type: 'pin',
          enabled: false,
          synced_to_lock: false,
          schedule: { start: null, end: null },
          usage_limit: null,
          usage_count: 0
        };
      }
    }
    
    return users;
  }

  render() {
    if (!this._hass || !this._config) return;

    const lockEntity = this._hass.states[this._config.entity];
    if (!lockEntity) {
      this.shadowRoot.innerHTML = `<ha-card>Entity ${this._config.entity} not found</ha-card>`;
      return;
    }

    const isLocked = lockEntity.state === 'locked';
    const battery = lockEntity.attributes.battery_level || 'N/A';
    const doorStatus = lockEntity.attributes.door_status || 'unknown';
    const totalUsers = lockEntity.attributes.total_users || 0;
    const enabledUsers = lockEntity.attributes.enabled_users || 0;

    // Get battery sensor
    const batterySensor = this._hass.states[this._config.entity.replace('lock.', 'sensor.') + '_battery'];
    const batteryLevel = batterySensor ? batterySensor.state : battery;

    const users = this.getUserData();

    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          padding: 16px;
          max-width: 1200px;
          width: 100%;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--divider-color);
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .lock-icon {
          font-size: 32px;
        }
        .header-info h2 {
          margin: 0;
          font-size: 1.5em;
        }
        .status-line {
          color: var(--secondary-text-color);
          font-size: 0.9em;
          margin-top: 4px;
        }
        .lock-button {
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          background: var(--primary-color);
          color: white;
          cursor: pointer;
          font-size: 1em;
          font-weight: 500;
        }
        .lock-button:hover {
          opacity: 0.8;
        }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 20px 0 12px 0;
          font-weight: 500;
          font-size: 1.1em;
        }
        .refresh-button {
          padding: 6px 12px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: transparent;
          cursor: pointer;
        }
        .user-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 8px;
        }
        .user-table th {
          text-align: left;
          padding: 8px;
          background: var(--table-row-background-color);
          font-weight: 500;
          font-size: 0.9em;
          border-bottom: 2px solid var(--divider-color);
        }
        .user-table td {
          padding: 8px;
          border-bottom: 1px solid var(--divider-color);
        }
        .user-row {
          cursor: pointer;
        }
        .user-row:hover {
          background: var(--table-row-alternative-background-color);
        }
        input[type="text"], input[type="datetime-local"], input[type="number"], select {
          padding: 6px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          width: 100%;
          box-sizing: border-box;
        }
        .action-button {
          padding: 6px 12px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--primary-color);
          color: white;
          cursor: pointer;
          font-size: 0.9em;
          margin-right: 4px;
        }
        .action-button.secondary {
          background: transparent;
          color: var(--primary-text-color);
        }
        .toggle-switch {
          position: relative;
          width: 40px;
          height: 20px;
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
          background-color: #ccc;
          transition: .4s;
          border-radius: 20px;
        }
        .slider:before {
          position: absolute;
          content: "";
          height: 14px;
          width: 14px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: .4s;
          border-radius: 50%;
        }
        input:checked + .slider {
          background-color: var(--primary-color);
        }
        input:checked + .slider:before {
          transform: translateX(20px);
        }
        .expanded-row {
          background: var(--table-row-alternative-background-color);
          border-left: 3px solid var(--primary-color);
        }
        .expanded-content {
          padding: 16px;
        }
        .form-group {
          margin-bottom: 12px;
        }
        .form-group label {
          display: block;
          margin-bottom: 4px;
          font-weight: 500;
          font-size: 0.9em;
        }
        .sync-indicator {
          font-size: 1.2em;
        }
        .sync-indicator.synced { color: green; }
        .sync-indicator.unsynced { color: orange; }
        .code-type-icon {
          font-size: 1.2em;
        }
        .battery-bar {
          display: inline-block;
          width: 60px;
          height: 12px;
          background: var(--divider-color);
          border-radius: 2px;
          overflow: hidden;
          vertical-align: middle;
          margin-left: 4px;
        }
        .battery-fill {
          height: 100%;
          background: var(--primary-color);
          transition: width 0.3s;
        }
      </style>
      
      <ha-card>
        <div class="header">
          <div class="header-left">
            <div class="lock-icon">${isLocked ? '🔐' : '🔓'}</div>
            <div class="header-info">
              <h2>${lockEntity.attributes.friendly_name || 'Yale Lock'}</h2>
              <div class="status-line">
                Battery: ${batteryLevel}% 
                <span class="battery-bar"><span class="battery-fill" style="width: ${batteryLevel}%"></span></span>
                • Door: ${doorStatus.charAt(0).toUpperCase() + doorStatus.slice(1)}
              </div>
              <div class="status-line">
                ${totalUsers} users configured • ${enabledUsers} enabled
              </div>
            </div>
          </div>
          <button class="lock-button" @click="${() => this.handleLockToggle()}">
            ${isLocked ? '🔓 Unlock' : '🔒 Lock'}
          </button>
        </div>

        <div class="section-header">
          <span>USER CODES</span>
          <button class="refresh-button" @click="${() => this.handleRefresh()}">
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
            ${Array.from({ length: 20 }, (_, i) => i + 1).map(slot => {
              const user = users[slot];
              const isExpanded = this._expandedSlot === slot;
              
              return `
                <tr class="user-row ${isExpanded ? 'expanded-row' : ''}" @click="${() => this.toggleExpand(slot)}">
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
                    <label class="toggle-switch" @click="${(e) => { e.stopPropagation(); this.handleToggleUser(slot, user.enabled); }}">
                      <input type="checkbox" ${user.enabled ? 'checked' : ''}>
                      <span class="slider"></span>
                    </label>
                  </td>
                  <td>
                    <span class="sync-indicator ${user.synced_to_lock ? 'synced' : 'unsynced'}">
                      ${user.synced_to_lock ? '✓' : '⚠️'}
                    </span>
                  </td>
                  <td @click="${(e) => e.stopPropagation()}">
                    ${user.name ? `
                      <button class="action-button" @click="${() => this.handlePushCode(slot)}">Push</button>
                    ` : `
                      <button class="action-button secondary">Set</button>
                    `}
                  </td>
                </tr>
                ${isExpanded ? `
                  <tr class="expanded-row">
                    <td colspan="6">
                      <div class="expanded-content" @click="${(e) => e.stopPropagation()}">
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
                        
                        <button class="action-button" @click="${() => this.handleSetCode(slot)}">
                          ${user.name ? 'Update User' : 'Set User'}
                        </button>
                        
                        ${user.name ? `
                          <button class="action-button secondary" @click="${() => this.handleClearCode(slot)}">Clear Slot</button>
                          
                          <hr style="margin: 16px 0; border: none; border-top: 1px solid var(--divider-color);">
                          
                          <div class="form-group">
                            <label>Schedule (optional):</label>
                            <div style="display: flex; gap: 8px; margin-top: 4px;">
                              <div style="flex: 1;">
                                <label style="font-size: 0.8em; color: var(--secondary-text-color);">Start:</label>
                                <input type="datetime-local" id="start-${slot}" value="${user.schedule?.start ? user.schedule.start.substring(0, 16) : ''}">
                              </div>
                              <div style="flex: 1;">
                                <label style="font-size: 0.8em; color: var(--secondary-text-color);">End:</label>
                                <input type="datetime-local" id="end-${slot}" value="${user.schedule?.end ? user.schedule.end.substring(0, 16) : ''}">
                              </div>
                            </div>
                            <button class="action-button secondary" style="margin-top: 8px;" @click="${() => this.handleSaveSchedule(slot)}">Save Schedule</button>
                          </div>
                          
                          <div class="form-group">
                            <label>Usage Limit (optional):</label>
                            <input type="number" id="limit-${slot}" value="${user.usage_limit || ''}" placeholder="Unlimited" min="1">
                            <p style="color: var(--secondary-text-color); font-size: 0.85em; margin: 4px 0;">
                              Used ${user.usage_count || 0} times${user.usage_limit ? ` / ${user.usage_limit} max` : ''}
                            </p>
                            <button class="action-button secondary" @click="${() => this.handleSaveUsageLimit(slot)}">Save Limit</button>
                          </div>
                        ` : ''}
                      </div>
                    </td>
                  </tr>
                ` : ''}
              `;
            }).join('')}
          </tbody>
        </table>
      </ha-card>
    `;

    // Attach event listeners
    this.attachEventListeners();
  }

  attachEventListeners() {
    const buttons = this.shadowRoot.querySelectorAll('[\\@click]');
    buttons.forEach(button => {
      const handler = button.getAttribute('@click');
      if (handler) {
        button.removeAttribute('@click');
        button.addEventListener('click', () => {
          eval(handler);
        });
      }
    });
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
