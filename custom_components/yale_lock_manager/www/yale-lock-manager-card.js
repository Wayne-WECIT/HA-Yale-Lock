/**
 * Yale Lock Manager Card
 * Complete rewrite with clean architecture
 */

class YaleLockManagerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._expandedSlot = null;
    this._statusMessages = {}; // Per-slot status messages
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

  // ========== STATUS MESSAGE SYSTEM ==========
  
  showStatus(slot, message, type = 'info', confirmAction = null) {
    this._statusMessages[slot] = { message, type, confirmAction };
    this.renderStatusMessage(slot);
    
    // Auto-clear success messages
    if (type === 'success') {
      setTimeout(() => {
        delete this._statusMessages[slot];
        this.renderStatusMessage(slot);
      }, 3000);
    }
  }

  clearStatus(slot) {
    delete this._statusMessages[slot];
    this.renderStatusMessage(slot);
  }
  
  renderStatusMessage(slot) {
    const container = this.shadowRoot.querySelector(`#status-${slot}`);
    if (!container) return; // Slot not expanded
    
    const status = this._statusMessages[slot];
    if (!status) {
      container.innerHTML = '';
      return;
    }

    const colors = {
      success: '#4caf50',
      error: '#f44336',
      warning: '#ff9800',
      info: '#2196f3',
      confirm: '#ff9800'
    };

    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️',
      confirm: '❓'
    };

    container.innerHTML = `
      <div class="status-message ${status.type}" style="
        background: ${colors[status.type]}15;
        border-left: 4px solid ${colors[status.type]};
        padding: 12px;
        margin: 12px 0;
        border-radius: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
      ">
        <span style="font-size: 18px;">${icons[status.type]}</span>
        <span style="flex: 1;">${status.message}</span>
        ${status.type === 'confirm' ? `
          <button class="btn-confirm" data-slot="${slot}">Yes</button>
          <button class="btn-cancel" data-slot="${slot}">No</button>
        ` : status.type !== 'success' ? `
          <button class="btn-close" data-slot="${slot}">✕</button>
        ` : ''}
      </div>
    `;

    // Attach event listeners to new buttons
    if (status.type === 'confirm') {
      container.querySelector('.btn-confirm').onclick = () => {
        const action = this._statusMessages[slot].confirmAction;
        this.clearStatus(slot);
        if (action) action();
      };
      container.querySelector('.btn-cancel').onclick = () => this.clearStatus(slot);
    } else if (status.type !== 'success') {
      container.querySelector('.btn-close').onclick = () => this.clearStatus(slot);
    }
  }

  // ========== DATA HELPERS ==========
  
  getUserData() {
    const stateObj = this._hass.states[this._config.entity];
    const users = stateObj?.attributes?.users || {};
    const usersArray = [];
    
    for (let slot = 1; slot <= 20; slot++) {
      const user = users[slot.toString()] || { 
        name: '', 
        code: '', 
        lock_code: '',  // PIN from lock (read-only)
        code_type: 'pin', 
        enabled: false,
        lock_enabled: false,  // Enabled status from lock
        synced_to_lock: false,
        schedule: { start: null, end: null },
        usage_limit: null,
        usage_count: 0
      };
      usersArray.push({ slot, ...user });
    }
    
    return usersArray;
  }

  // ========== RENDERING ==========
  
  render() {
    if (!this._hass || !this._config) return;

    const entityId = this._config.entity;
    const stateObj = this._hass.states[entityId];

    if (!stateObj) {
      this.shadowRoot.innerHTML = `
        <style>${this.getStyles()}</style>
        <ha-card>
          <div class="error">⚠️ Entity "${entityId}" not found</div>
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

    this.shadowRoot.innerHTML = `
      <style>${this.getStyles()}</style>
      ${this.getHTML(users, isLocked, batteryLevel, doorStatus, boltStatus, totalUsers, enabledUsers)}
    `;

    this.attachEventListeners();
  }

  getStyles() {
    return `
      :host { display: block; }
      ha-card { padding: 16px; }
      
      .error {
        color: var(--error-color);
        padding: 16px;
        background: var(--error-color-background, rgba(255, 0, 0, 0.1));
        border-radius: 4px;
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
      
      .status-icon { font-size: 32px; }
      .status-info { display: flex; flex-direction: column; gap: 4px; }
      .status-line { font-size: 0.9em; }
      
      .controls { display: flex; gap: 8px; }
      
      button, .btn-confirm, .btn-cancel, .btn-close {
        background: var(--primary-color);
        color: var(--text-primary-color);
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9em;
        transition: opacity 0.2s;
      }
      
      button:hover { opacity: 0.9; }
      
      button.secondary, .btn-cancel, .btn-close {
        background: var(--secondary-background-color);
        color: var(--primary-text-color);
      }
      
      .btn-confirm { background: var(--primary-color); padding: 6px 12px; }
      .btn-cancel, .btn-close { background: var(--secondary-background-color); padding: 6px 12px; }
      
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 16px;
      }
      
      th, td {
        text-align: left;
        padding: 12px 8px;
        border-bottom: 1px solid var(--divider-color);
      }
      
      th {
        background: var(--table-header-background-color, var(--secondary-background-color));
        font-weight: bold;
        font-size: 0.85em;
        color: var(--secondary-text-color);
      }
      
      tr:hover { background: var(--table-row-alternative-background-color); }
      .clickable { cursor: pointer; }
      
      .expanded-content {
        padding: 16px;
        border-left: 3px solid var(--primary-color);
        background: var(--secondary-background-color);
      }
      
      .expanded-content h3 {
        margin-top: 0;
        margin-bottom: 16px;
      }
      
      .form-group {
        margin-bottom: 16px;
      }
      
      .form-group label {
        display: block;
        margin-bottom: 4px;
        font-weight: 500;
      }
      
      .form-group input, .form-group select {
        width: 100%;
        padding: 8px;
        border: 1px solid var(--divider-color);
        border-radius: 4px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        box-sizing: border-box;
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
        background-color: var(--disabled-color, #ccc);
        transition: 0.3s;
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
        transition: 0.3s;
        border-radius: 50%;
      }
      
      input:checked + .slider {
        background-color: var(--primary-color);
      }
      
      input:checked + .slider:before {
        transform: translateX(20px);
      }
      
      .toggle-label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        margin-bottom: 8px;
      }
      
      .hidden { display: none !important; }
      
      .fob-notice {
        background: var(--table-row-alternative-background-color);
        border-radius: 8px;
        padding: 12px;
        margin: 12px 0;
      }
      
      hr {
        margin: 20px 0;
        border: none;
        border-top: 1px solid var(--divider-color);
      }
      
      .button-group {
        display: flex;
        gap: 8px;
        margin-top: 16px;
        flex-wrap: wrap;
      }
      
      .button-group button {
        flex: 1;
        min-width: 120px;
      }
    `;
  }

  getHTML(users, isLocked, batteryLevel, doorStatus, boltStatus, totalUsers, enabledUsers) {
    const rows = users.map(user => {
      const isExpanded = this._expandedSlot === user.slot;
      const isFob = user.code_type === 'fob';
      
      return `
        <tr class="clickable" onclick="card.toggleExpand(${user.slot})">
          <td><strong>${user.slot}</strong></td>
          <td>${user.name || `User ${user.slot}`}</td>
          <td>${isFob ? '🏷️' : '🔑'}</td>
          <td>
            <label class="toggle-switch" onclick="event.stopPropagation()">
              <input type="checkbox" onchange="card.toggleUser(${user.slot}, this.checked)" ${user.enabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </td>
          <td>${user.synced_to_lock ? '✓' : '✗'}</td>
          <td>
            <button onclick="event.stopPropagation(); card.pushCode(${user.slot})">Push</button>
          </td>
        </tr>
        ${isExpanded ? `
          <tr class="expanded-row">
            <td colspan="6">
              <div class="expanded-content">
                <h3>Slot ${user.slot} Settings</h3>
                
                <div id="status-${user.slot}"></div>
                
                <div class="form-group">
                  <label>User Name:</label>
                  <input type="text" id="name-${user.slot}" value="${user.name || ''}" placeholder="Enter name">
                </div>
                
                <div class="form-group">
                  <label>Code Type:</label>
                  <select id="type-${user.slot}" onchange="card.changeType(${user.slot}, this.value)">
                    <option value="pin" ${!isFob ? 'selected' : ''}>PIN Code</option>
                    <option value="fob" ${isFob ? 'selected' : ''}>FOB/RFID Card</option>
                  </select>
                </div>
                
                <div id="code-field-${user.slot}" class="${isFob ? 'hidden' : ''}">
                  <div class="form-group">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                      <div>
                        <label>📝 Cached PIN (editable):</label>
                        <input type="text" id="code-${user.slot}" value="${user.code || ''}" placeholder="Enter PIN code" maxlength="10" pattern="[0-9]*" style="width: 100%;">
                        <p style="color: var(--secondary-text-color); font-size: 0.75em; margin: 4px 0 0 0;">PIN stored locally</p>
                      </div>
                      <div>
                        <label>🔒 Lock PIN (from lock):</label>
                        <input type="text" id="lock-code-${user.slot}" value="${user.lock_code || ''}" placeholder="No PIN on lock" maxlength="10" pattern="[0-9]*" readonly style="width: 100%; background: var(--card-background-color); border: 1px solid var(--divider-color); color: var(--secondary-text-color);">
                        <p style="color: var(--secondary-text-color); font-size: 0.75em; margin: 4px 0 0 0;">PIN from physical lock</p>
                      </div>
                    </div>
                    ${user.code && user.lock_code && user.code !== user.lock_code ? `
                      <div style="margin-top: 8px; padding: 8px; background: #ff980015; border-left: 4px solid #ff9800; border-radius: 4px;">
                        <span style="color: #ff9800; font-size: 0.85em;">⚠️ PINs don't match - Click "Push" to sync</span>
                      </div>
                    ` : user.code && user.lock_code && user.code === user.lock_code ? `
                      <div style="margin-top: 8px; padding: 8px; background: #4caf5015; border-left: 4px solid #4caf50; border-radius: 4px;">
                        <span style="color: #4caf50; font-size: 0.85em;">✅ PINs match - Synced</span>
                      </div>
                    ` : ''}
                  </div>
                </div>
                
                <div id="fob-notice-${user.slot}" class="fob-notice ${!isFob ? 'hidden' : ''}">
                  🏷️ FOB/RFID cards don't require a PIN. The card ID is read automatically when presented to the lock.
                </div>
                
                <div id="pin-features-${user.slot}" class="${isFob ? 'hidden' : ''}">
                  <hr>
                  
                  <div class="form-group">
                    <label class="toggle-label">
                      <label class="toggle-switch">
                        <input type="checkbox" id="schedule-toggle-${user.slot}" onchange="card.toggleSchedule(${user.slot}, this.checked)" ${user.schedule?.start || user.schedule?.end ? 'checked' : ''}>
                        <span class="slider"></span>
                      </label>
                      <span>⏰ Time-Based Schedule</span>
                    </label>
                    <p style="color: var(--secondary-text-color); font-size: 0.85em; margin: 4px 0 8px 20px;">
                      Limit when this code works. Leave disabled for 24/7 access.
                    </p>
                    
                    <div id="schedule-fields-${user.slot}" class="${user.schedule?.start || user.schedule?.end ? '' : 'hidden'}">
                      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 200px;">
                          <label style="font-size: 0.85em;">Start:</label>
                          <input type="datetime-local" id="start-${user.slot}" value="${user.schedule?.start ? user.schedule.start.substring(0, 16) : ''}">
                        </div>
                        <div style="flex: 1; min-width: 200px;">
                          <label style="font-size: 0.85em;">End:</label>
                          <input type="datetime-local" id="end-${user.slot}" value="${user.schedule?.end ? user.schedule.end.substring(0, 16) : ''}">
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div class="form-group">
                    <label class="toggle-label">
                      <label class="toggle-switch">
                        <input type="checkbox" id="limit-toggle-${user.slot}" onchange="card.toggleLimit(${user.slot}, this.checked)" ${user.usage_limit ? 'checked' : ''}>
                        <span class="slider"></span>
                      </label>
                      <span>🔢 Usage Limit</span>
                    </label>
                    <p style="color: var(--secondary-text-color); font-size: 0.85em; margin: 4px 0 8px 20px;">
                      Limit how many times this code can be used.
                    </p>
                    
                    <div id="limit-fields-${user.slot}" class="${user.usage_limit ? '' : 'hidden'}">
                      <div style="display: flex; gap: 12px;">
                        <div style="flex: 1;">
                          <label style="font-size: 0.85em;">Current:</label>
                          <input type="number" value="${user.usage_count || 0}" readonly style="background: var(--disabled-color, #f0f0f0);">
                        </div>
                        <div style="flex: 1;">
                          <label style="font-size: 0.85em;">Max:</label>
                          <input type="number" id="limit-${user.slot}" value="${user.usage_limit || ''}" placeholder="e.g., 5" min="1">
                        </div>
                      </div>
                      ${user.usage_limit && user.usage_count >= user.usage_limit ? `
                        <p style="color: var(--error-color); margin-top: 8px;">🚫 Limit reached!</p>
                      ` : user.usage_count > 0 ? `
                        <p style="color: var(--warning-color); margin-top: 8px;">⚠️ ${user.usage_count} / ${user.usage_limit || '∞'} uses</p>
                      ` : ''}
                      ${user.usage_count > 0 ? `
                        <button class="secondary" style="margin-top: 8px; width: 100%;" onclick="card.resetCount(${user.slot})">Reset Counter</button>
                      ` : ''}
                    </div>
                  </div>
                </div>
                
                <hr>
                <div class="button-group">
                  <button onclick="card.saveUser(${user.slot})">
                    ${user.name ? 'Update User' : 'Save User'}
                  </button>
                  ${user.name ? `
                    <button class="secondary" onclick="card.clearSlot(${user.slot})">Clear Slot</button>
                  ` : ''}
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
              <div class="status-line">🔋 ${batteryLevel}% Battery</div>
              <div class="status-line">• Bolt: ${boltStatus} • Door: ${doorStatus}</div>
            </div>
          </div>
          <div class="controls">
            <button onclick="card.toggleLock()">${isLocked ? 'Unlock' : 'Lock'}</button>
            <button class="secondary" onclick="card.refresh()">Refresh</button>
          </div>
        </div>
        
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span>👥 ${enabledUsers} / ${totalUsers} active users</span>
        </div>

        <table>
          <thead>
            <tr>
              <th>Slot</th>
              <th>Name</th>
              <th>Type</th>
              <th>Enabled</th>
              <th>Synced</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </ha-card>
    `;
  }

  // ========== EVENT HANDLING ==========
  
  attachEventListeners() {
    // Make card globally accessible for onclick handlers
    window.card = this;
  }

  toggleExpand(slot) {
    this._expandedSlot = this._expandedSlot === slot ? null : slot;
    this.render();
  }

  changeType(slot, newType) {
    const codeField = this.shadowRoot.getElementById(`code-field-${slot}`);
    const fobNotice = this.shadowRoot.getElementById(`fob-notice-${slot}`);
    const pinFeatures = this.shadowRoot.getElementById(`pin-features-${slot}`);
    
    if (newType === 'fob') {
      codeField.classList.add('hidden');
      fobNotice.classList.remove('hidden');
      pinFeatures.classList.add('hidden');
    } else {
      codeField.classList.remove('hidden');
      fobNotice.classList.add('hidden');
      pinFeatures.classList.remove('hidden');
    }
  }

  toggleSchedule(slot, checked) {
    const fields = this.shadowRoot.getElementById(`schedule-fields-${slot}`);
    if (fields) {
      if (checked) {
        fields.classList.remove('hidden');
      } else {
        fields.classList.add('hidden');
      }
    }
  }

  toggleLimit(slot, checked) {
    const fields = this.shadowRoot.getElementById(`limit-fields-${slot}`);
    if (fields) {
      if (checked) {
        fields.classList.remove('hidden');
      } else {
        fields.classList.add('hidden');
      }
    }
  }

  // ========== ACTIONS ==========

  async toggleLock() {
    const stateObj = this._hass.states[this._config.entity];
    const service = stateObj.state === 'locked' ? 'unlock' : 'lock';
    try {
      await this._hass.callService('lock', service, { entity_id: this._config.entity });
    } catch (error) {
      this.showStatus(0, `Failed to ${service}: ${error.message}`, 'error');
    }
  }

  async refresh() {
    try {
      await this._hass.callService('yale_lock_manager', 'pull_codes_from_lock', {
        entity_id: this._config.entity
      });
      this.showStatus(0, 'Refreshed from lock', 'success');
    } catch (error) {
      this.showStatus(0, `Refresh failed: ${error.message}`, 'error');
    }
  }

  async toggleUser(slot, checked) {
    const service = checked ? 'enable_user' : 'disable_user';
    try {
      await this._hass.callService('yale_lock_manager', service, {
        entity_id: this._config.entity,
        slot: parseInt(slot, 10)
      });
      this.showStatus(slot, `User ${checked ? 'enabled' : 'disabled'}`, 'success');
    } catch (error) {
      this.showStatus(slot, `Failed: ${error.message}`, 'error');
    }
  }

  async pushCode(slot) {
    const user = this.getUserData().find(u => u.slot === slot);
    
    if (!user || !user.name) {
      this.showStatus(slot, 'No user configured in this slot', 'error');
      return;
    }

    this.showStatus(slot, `Push "${user.name}" to the lock now?`, 'confirm', async () => {
      try {
        await this._hass.callService('yale_lock_manager', 'push_code_to_lock', {
          entity_id: this._config.entity,
          slot: parseInt(slot, 10)
        });
        this.showStatus(slot, 'Code pushed to lock', 'success');
      } catch (error) {
        this.showStatus(slot, `Push failed: ${error.message}`, 'error');
      }
    });
  }

  async saveUser(slot) {
    const name = this.shadowRoot.getElementById(`name-${slot}`).value.trim();
    const codeType = this.shadowRoot.getElementById(`type-${slot}`).value;
    const code = codeType === 'pin' ? (this.shadowRoot.getElementById(`code-${slot}`)?.value.trim() || '') : '';

    // Validation
    if (!name) {
      this.showStatus(slot, 'Please enter a user name', 'error');
      return;
    }

    if (codeType === 'pin' && (!code || code.length < 4)) {
      this.showStatus(slot, 'PIN must be at least 4 digits', 'error');
      return;
    }

    try {
      // Set user code
      await this._hass.callService('yale_lock_manager', 'set_user_code', {
        entity_id: this._config.entity,
        slot: parseInt(slot, 10),
        name: name,
        code: code,
        code_type: codeType,
        override_protection: false
      });

      // For PINs, save schedule and usage if enabled
      if (codeType === 'pin') {
        const scheduleToggle = this.shadowRoot.getElementById(`schedule-toggle-${slot}`);
        const startInput = this.shadowRoot.getElementById(`start-${slot}`);
        const endInput = this.shadowRoot.getElementById(`end-${slot}`);
        
        // Determine schedule values
        // If toggle is unchecked, always clear (send null)
        // If toggle is checked but fields are empty, also clear (send null)
        let start = null;
        let end = null;
        
        if (scheduleToggle?.checked) {
          // Toggle is on - check if dates are provided
          const startVal = startInput?.value?.trim() || '';
          const endVal = endInput?.value?.trim() || '';
          
          // Only set dates if both fields have values
          // If either is empty, clear both (null)
          if (startVal && endVal) {
            start = startVal;
            end = endVal;
          } else {
            // At least one field is empty - clear the schedule
            start = null;
            end = null;
          }
        } else {
          // Toggle is off - always clear schedule
          start = null;
          end = null;
        }
        
        // Validate dates if provided
        if (start && end) {
          const now = new Date();
          if (new Date(start) < now) {
            this.showStatus(slot, 'Start date must be in the future', 'error');
            return;
          }
          if (new Date(end) < now) {
            this.showStatus(slot, 'End date must be in the future', 'error');
            return;
          }
          if (new Date(end) <= new Date(start)) {
            this.showStatus(slot, 'End date must be after start date', 'error');
            return;
          }
        }

        // Always send schedule service call (null clears it)
        await this._hass.callService('yale_lock_manager', 'set_user_schedule', {
          entity_id: this._config.entity,
          slot: parseInt(slot, 10),
          start_datetime: start,
          end_datetime: end
        });

        // Handle usage limit
        const limitToggle = this.shadowRoot.getElementById(`limit-toggle-${slot}`);
        const limitInput = this.shadowRoot.getElementById(`limit-${slot}`);
        
        const limit = (limitToggle?.checked && limitInput?.value) ? parseInt(limitInput.value, 10) : null;
        
        // Send usage limit (null clears it)
        await this._hass.callService('yale_lock_manager', 'set_usage_limit', {
          entity_id: this._config.entity,
          slot: parseInt(slot, 10),
          max_uses: limit
        });
      }

      this.showStatus(slot, 'User saved successfully', 'success');
      
    } catch (error) {
      if (error.message && error.message.includes('occupied by an unknown code')) {
        this.showStatus(slot, 'Slot contains an unknown code. Overwrite it?', 'confirm', async () => {
          try {
            await this._hass.callService('yale_lock_manager', 'set_user_code', {
              entity_id: this._config.entity,
              slot: parseInt(slot, 10),
              name: name,
              code: code,
              code_type: codeType,
              override_protection: true
            });
            this.showStatus(slot, 'User saved (unknown code overwritten)', 'success');
          } catch (retryError) {
            this.showStatus(slot, `Failed: ${retryError.message}`, 'error');
          }
        });
      } else {
        this.showStatus(slot, `Failed: ${error.message}`, 'error');
      }
    }
  }

  async clearSlot(slot) {
    this.showStatus(slot, 'Clear this slot? This will remove all settings.', 'confirm', async () => {
      try {
        await this._hass.callService('yale_lock_manager', 'clear_user_code', {
          entity_id: this._config.entity,
          slot: parseInt(slot, 10)
        });
        this._expandedSlot = null;
        this.showStatus(slot, 'Slot cleared', 'success');
        setTimeout(() => this.render(), 1000);
      } catch (error) {
        this.showStatus(slot, `Clear failed: ${error.message}`, 'error');
      }
    });
  }

  async resetCount(slot) {
    this.showStatus(slot, 'Reset usage counter to 0?', 'confirm', async () => {
      try {
        await this._hass.callService('yale_lock_manager', 'reset_usage_count', {
          entity_id: this._config.entity,
          slot: parseInt(slot, 10)
        });
        this.showStatus(slot, 'Counter reset', 'success');
      } catch (error) {
        this.showStatus(slot, `Reset failed: ${error.message}`, 'error');
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
