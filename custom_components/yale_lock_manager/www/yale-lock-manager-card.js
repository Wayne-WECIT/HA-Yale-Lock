class YaleLockManagerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._expandedSlot = null;
    this._statusMessages = {}; // Store status messages per slot
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

  showStatus(slot, message, type = 'info') {
    this._statusMessages[slot] = { message, type };
    
    // Update only the status message area, not the whole card
    this.updateStatusMessage(slot);
    
    // Auto-clear success messages after 3 seconds
    if (type === 'success') {
      setTimeout(() => {
        delete this._statusMessages[slot];
        this.updateStatusMessage(slot);
      }, 3000);
    }
  }

  clearStatus(slot) {
    delete this._statusMessages[slot];
    this.updateStatusMessage(slot);
  }
  
  updateStatusMessage(slot) {
    // Find the status message container for this slot
    const expandedContent = this.shadowRoot.querySelector(`[data-slot="${slot}"] .expanded-content, button[data-slot="${slot}"]`)?.closest('tr')?.nextElementSibling?.querySelector('.expanded-content');
    
    if (!expandedContent) {
      // Slot not expanded or not found, do a full render
      this.render();
      return;
    }
    
    // Find or create status message area (it should be first after h3)
    let statusArea = expandedContent.querySelector('.status-message-area');
    if (!statusArea) {
      statusArea = document.createElement('div');
      statusArea.className = 'status-message-area';
      const h3 = expandedContent.querySelector('h3');
      if (h3) {
        h3.after(statusArea);
      } else {
        expandedContent.prepend(statusArea);
      }
    }
    
    // Update the status message HTML
    statusArea.innerHTML = this.getStatusMessageHTML(slot);
    
    // Re-attach event listeners for the new buttons in the status message
    statusArea.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = el.dataset.action;
        const slot = el.dataset.slot ? parseInt(el.dataset.slot, 10) : null;
        const confirmed = el.dataset.confirmed === 'true';
        this.handleAction(action, slot, el, confirmed);
      });
    });
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

  getUserData() {
    const stateObj = this._hass.states[this._config.entity];
    const users = stateObj?.attributes?.users || {};
    const usersArray = [];
    
    for (let slot = 1; slot <= 20; slot++) {
      const user = users[slot.toString()] || { name: '', code: '', code_type: 'pin', enabled: false };
      usersArray.push({
        slot,
        ...user
      });
    }
    
    return usersArray;
  }

  getStatusMessageHTML(slot) {
    const status = this._statusMessages[slot];
    if (!status) return '';

    const colors = {
      success: 'var(--success-color, #4caf50)',
      error: 'var(--error-color, #f44336)',
      warning: 'var(--warning-color, #ff9800)',
      info: 'var(--info-color, #2196f3)',
      confirm: 'var(--warning-color, #ff9800)'
    };

    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️',
      confirm: '❓'
    };

    return `
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
          <div style="display: flex; gap: 8px;">
            <button class="action-button small" data-action="${status.confirmAction}" data-slot="${slot}" data-confirmed="true">Yes</button>
            <button class="action-button small secondary" data-action="clear-status" data-slot="${slot}">No</button>
          </div>
        ` : status.type !== 'success' ? `
          <button class="action-button small secondary" data-action="clear-status" data-slot="${slot}">✕</button>
        ` : ''}
      </div>
    `;
  }

  getStyles() {
    return `
      <style>
        /* Base styles remain the same - keeping existing CSS */
        /* Adding new styles for status messages and improvements */
        .status-message {
          animation: slideIn 0.3s ease;
        }
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .action-button.small {
          padding: 6px 12px;
          font-size: 0.85em;
          min-width: auto;
        }
        .fob-notice {
          background: var(--table-row-alternative-background-color);
          border-radius: 8px;
          padding: 12px;
          margin: 12px 0;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--secondary-text-color);
        }
        .hidden {
          display: none !important;
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
        /* Existing styles... */
        :host { display: block; }
        ha-card { padding: 16px; }
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
        .status-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .status-line { font-size: 0.9em; }
        .controls {
          display: flex;
          gap: 8px;
        }
        .action-button {
          background: var(--primary-color);
          color: var(--text-primary-color);
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.9em;
          transition: opacity 0.2s;
        }
        .action-button:hover {
          opacity: 0.9;
        }
        .action-button.secondary {
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
        }
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
        tr:hover {
          background: var(--table-row-alternative-background-color);
        }
        .clickable {
          cursor: pointer;
        }
        .expanded-row {
          background: var(--card-background-color);
        }
        .expanded-content {
          padding: 16px;
          border-left: 3px solid var(--primary-color);
          background: var(--secondary-background-color);
        }
        .expanded-content h3 {
          margin-top: 0;
          margin-bottom: 16px;
          color: var(--primary-text-color);
        }
        .form-group {
          margin-bottom: 16px;
        }
        .form-group label {
          display: block;
          margin-bottom: 4px;
          font-weight: 500;
          color: var(--primary-text-color);
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
        hr {
          margin: 20px 0;
          border: none;
          border-top: 1px solid var(--divider-color);
        }
      </style>
    `;
  }

  getHTML(users, isLocked, batteryLevel, doorStatus, boltStatus, totalUsers, enabledUsers) {
    const rows = users.map(user => {
      const isExpanded = this._expandedSlot === user.slot;
      const isFob = user.code_type === 'fob';
      
      return `
        <tr class="clickable" data-action="toggle-expand" data-slot="${user.slot}">
          <td><strong>${user.slot}</strong></td>
          <td>${user.name || `User ${user.slot}`}</td>
          <td>${isFob ? '🏷️' : '🔑'}</td>
          <td>
            <label class="toggle-switch">
              <input type="checkbox" data-action="toggle-user" data-slot="${user.slot}" data-state="${user.enabled}" ${user.enabled ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </td>
          <td>${user.synced_to_lock ? '✓' : '✗'}</td>
          <td>
            <button class="action-button small" data-action="push" data-slot="${user.slot}">Push</button>
          </td>
        </tr>
        ${isExpanded ? `
          <tr class="expanded-row">
            <td colspan="6">
              <div class="expanded-content">
                <h3>Slot ${user.slot} Settings</h3>
                
                <div class="status-message-area">
                  ${this.getStatusMessageHTML(user.slot)}
                </div>
                
                <div class="form-group">
                  <label>User Name:</label>
                  <input type="text" id="name-${user.slot}" value="${user.name || ''}" placeholder="Enter name">
                </div>
                
                <div class="form-group">
                  <label>Code Type:</label>
                  <select id="type-${user.slot}" data-action="change-type" data-slot="${user.slot}">
                    <option value="pin" ${!isFob ? 'selected' : ''}>PIN Code</option>
                    <option value="fob" ${isFob ? 'selected' : ''}>FOB/RFID Card</option>
                  </select>
                </div>
                
                ${!isFob ? `
                  <div class="form-group">
                    <label>PIN Code (4-10 digits):</label>
                    <input type="text" id="code-${user.slot}" value="${user.code || ''}" placeholder="Enter PIN code" maxlength="10" pattern="[0-9]*">
                  </div>
                ` : `
                  <div class="fob-notice">
                    🏷️ FOB/RFID cards don't require a PIN. The card ID is read automatically when presented to the lock.
                  </div>
                `}
                
                ${!isFob ? `
                  <hr>
                  <div class="form-group">
                    <label class="toggle-label">
                      <label class="toggle-switch">
                        <input type="checkbox" id="schedule-toggle-${user.slot}" data-toggle="schedule-${user.slot}" ${user.schedule?.start || user.schedule?.end ? 'checked' : ''}>
                        <span class="slider"></span>
                      </label>
                      <span>⏰ Time-Based Schedule</span>
                    </label>
                    <p style="color: var(--secondary-text-color); font-size: 0.85em; margin: 4px 0 8px 20px;">
                      Limit when this code works. Leave disabled for 24/7 access.
                    </p>
                    
                    <div class="schedule-fields ${user.schedule?.start || user.schedule?.end ? '' : 'hidden'}" id="schedule-fields-${user.slot}">
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
                        <input type="checkbox" id="limit-toggle-${user.slot}" data-toggle="limit-${user.slot}" ${user.usage_limit ? 'checked' : ''}>
                        <span class="slider"></span>
                      </label>
                      <span>🔢 Usage Limit</span>
                    </label>
                    <p style="color: var(--secondary-text-color); font-size: 0.85em; margin: 4px 0 8px 20px;">
                      Limit how many times this code can be used.
                    </p>
                    
                    <div class="limit-fields ${user.usage_limit ? '' : 'hidden'}" id="limit-fields-${user.slot}">
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
                        <button class="action-button secondary" style="margin-top: 8px; width: 100%;" data-action="reset-count" data-slot="${user.slot}">Reset Counter</button>
                      ` : ''}
                    </div>
                  </div>
                ` : ''}
                
                <hr>
                <div class="button-group">
                  <button class="action-button" data-action="save-all" data-slot="${user.slot}">
                    ${user.name ? 'Update User' : 'Save User'}
                  </button>
                  ${user.name ? `
                    <button class="action-button secondary" data-action="clear" data-slot="${user.slot}">Clear Slot</button>
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
            <button class="action-button" data-action="lock">${isLocked ? 'Unlock' : 'Lock'}</button>
            <button class="action-button secondary" data-action="refresh">Refresh</button>
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

  attachEventListeners() {
    this.shadowRoot.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = el.dataset.action;
        const slot = el.dataset.slot ? parseInt(el.dataset.slot, 10) : null;
        const confirmed = el.dataset.confirmed === 'true';
        
        this.handleAction(action, slot, el, confirmed);
      });
    });

    // Handle toggles - show/hide fields WITHOUT re-rendering
    this.shadowRoot.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('change', (e) => {
        e.stopPropagation();
        const toggleId = el.dataset.toggle;
        const fields = this.shadowRoot.getElementById(`${toggleId}-fields`);
        if (fields) {
          fields.classList.toggle('hidden', !e.target.checked);
        }
      });
    });

    // Handle type changes - DON'T re-render, just show/hide fields
    this.shadowRoot.querySelectorAll('[data-action="change-type"]').forEach(el => {
      el.addEventListener('change', (e) => {
        e.stopPropagation();
        const slot = el.dataset.slot;
        const newType = e.target.value;
        
        // Get the expanded content for this slot
        const codeField = this.shadowRoot.getElementById(`code-${slot}`)?.parentElement;
        const fobNotice = this.shadowRoot.querySelector(`.fob-notice`);
        const scheduleSection = this.shadowRoot.getElementById(`schedule-fields-${slot}`)?.closest('.form-group');
        const limitSection = this.shadowRoot.getElementById(`limit-fields-${slot}`)?.closest('.form-group');
        const hr = scheduleSection?.previousElementSibling;
        
        if (newType === 'fob') {
          // Hide PIN field, schedule, usage limit
          if (codeField) codeField.style.display = 'none';
          if (scheduleSection) scheduleSection.style.display = 'none';
          if (limitSection) limitSection.style.display = 'none';
          if (hr) hr.style.display = 'none';
          
          // Show FOB notice (create if doesn't exist)
          if (!this.shadowRoot.querySelector('.fob-notice')) {
            const notice = document.createElement('div');
            notice.className = 'fob-notice';
            notice.innerHTML = '🏷️ FOB/RFID cards don\'t require a PIN. The card ID is read automatically when presented to the lock.';
            el.parentElement.parentElement.insertBefore(notice, el.parentElement.nextSibling);
          }
        } else {
          // Show PIN field, schedule, usage limit
          if (codeField) codeField.style.display = '';
          if (scheduleSection) scheduleSection.style.display = '';
          if (limitSection) limitSection.style.display = '';
          if (hr) hr.style.display = '';
          
          // Remove FOB notice
          this.shadowRoot.querySelectorAll('.fob-notice').forEach(n => n.remove());
        }
      });
    });
  }

  async handleAction(action, slot, element, confirmed = false) {
    try {
      switch (action) {
        case 'toggle-expand':
          this._expandedSlot = this._expandedSlot === slot ? null : slot;
          this.render();
          break;

        case 'lock':
          const service = this._hass.states[this._config.entity].state === 'locked' ? 'unlock' : 'lock';
          await this._hass.callService('lock', service, { entity_id: this._config.entity });
          break;

        case 'refresh':
          await this.handleRefresh();
          break;

        case 'toggle-user':
          const currentState = element.dataset.state === 'true';
          await this.handleToggleUser(slot, currentState);
          break;

        case 'push':
          await this.handlePushCode(slot, confirmed);
          break;

        case 'save-all':
          await this.handleSaveAll(slot, confirmed);
          break;

        case 'clear':
          await this.handleClearCode(slot, confirmed);
          break;

        case 'reset-count':
          await this.handleResetUsageCount(slot, confirmed);
          break;

        case 'clear-status':
          this.clearStatus(slot);
          break;
      }
    } catch (error) {
      this.showStatus(slot, `Error: ${error.message}`, 'error');
    }
  }

  async handleRefresh() {
    try {
      await this._hass.callService('yale_lock_manager', 'pull_codes_from_lock', {
        entity_id: this._config.entity
      });
      this.showStatus(0, 'Refreshed from lock', 'success');
    } catch (error) {
      this.showStatus(0, `Refresh failed: ${error.message}`, 'error');
    }
  }

  async handleToggleUser(slot, currentState) {
    const service = currentState ? 'disable_user' : 'enable_user';
    try {
      await this._hass.callService('yale_lock_manager', service, {
        entity_id: this._config.entity,
        slot: parseInt(slot, 10)
      });
      this.showStatus(slot, `User ${currentState ? 'disabled' : 'enabled'}`, 'success');
      
      // Update the toggle's data-state attribute immediately for visual feedback
      const toggle = this.shadowRoot.querySelector(`[data-action="toggle-user"][data-slot="${slot}"]`);
      if (toggle) {
        toggle.dataset.state = (!currentState).toString();
      }
    } catch (error) {
      this.showStatus(slot, `Failed to ${currentState ? 'disable' : 'enable'} user: ${error.message}`, 'error');
      // Revert the toggle
      const toggle = this.shadowRoot.querySelector(`[data-action="toggle-user"][data-slot="${slot}"]`);
      if (toggle) {
        toggle.checked = currentState;
      }
    }
  }

  async handlePushCode(slot, confirmed) {
    const user = this.getUserData().find(u => u.slot === slot);
    
    if (!user || !user.name) {
      this.showStatus(slot, 'No user configured in this slot', 'error');
      return;
    }

    if (!confirmed) {
      this.showStatus(slot, `Push "${user.name}" to the lock now?`, 'confirm');
      this._statusMessages[slot].confirmAction = 'push';
      this.render();
      return;
    }

    this.clearStatus(slot);
    await this._hass.callService('yale_lock_manager', 'push_code_to_lock', {
      entity_id: this._config.entity,
      slot: parseInt(slot, 10)
    });
    this.showStatus(slot, 'Code pushed to lock', 'success');
  }

  async handleSaveAll(slot, confirmed) {
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
      // Set the user code
      await this._hass.callService('yale_lock_manager', 'set_user_code', {
        entity_id: this._config.entity,
        slot: parseInt(slot, 10),
        name: name,
        code: code,
        code_type: codeType,
        override_protection: false
      });

      // For PINs, also save schedule and usage if enabled
      if (codeType === 'pin') {
        const scheduleToggle = this.shadowRoot.getElementById(`schedule-toggle-${slot}`);
        if (scheduleToggle?.checked) {
          const start = this.shadowRoot.getElementById(`start-${slot}`)?.value || null;
          const end = this.shadowRoot.getElementById(`end-${slot}`)?.value || null;
          
          // Only send schedule if at least one date is set
          if (start || end) {
            // Validate dates
            const now = new Date();
            if (start && new Date(start) < now) {
              this.showStatus(slot, 'Start date must be in the future', 'error');
              return;
            }
            if (end && new Date(end) < now) {
              this.showStatus(slot, 'End date must be in the future', 'error');
              return;
            }
            if (start && end && new Date(end) <= new Date(start)) {
              this.showStatus(slot, 'End date must be after start date', 'error');
              return;
            }

            await this._hass.callService('yale_lock_manager', 'set_user_schedule', {
              entity_id: this._config.entity,
              slot: parseInt(slot, 10),
              start_datetime: start,
              end_datetime: end
            });
          }
        } else {
          // Clear schedule - don't send empty strings, send null
          await this._hass.callService('yale_lock_manager', 'set_user_schedule', {
            entity_id: this._config.entity,
            slot: parseInt(slot, 10),
            start_datetime: null,
            end_datetime: null
          });
        }

        const limitToggle = this.shadowRoot.getElementById(`limit-toggle-${slot}`);
        if (limitToggle?.checked) {
          const limit = parseInt(this.shadowRoot.getElementById(`limit-${slot}`)?.value) || null;
          if (limit) {
            await this._hass.callService('yale_lock_manager', 'set_usage_limit', {
              entity_id: this._config.entity,
              slot: parseInt(slot, 10),
              max_uses: limit
            });
          }
        } else {
          // Clear limit
          await this._hass.callService('yale_lock_manager', 'set_usage_limit', {
            entity_id: this._config.entity,
            slot: parseInt(slot, 10),
            max_uses: null
          });
        }
      }

      this.showStatus(slot, 'User saved successfully', 'success');
      // DON'T call this.render() here - it clears the form!
      
    } catch (error) {
      if (error.message && error.message.includes('occupied by an unknown code')) {
        if (!confirmed) {
          this.showStatus(slot, 'Slot contains an unknown code. Overwrite it?', 'confirm');
          this._statusMessages[slot].confirmAction = 'save-all';
          // DON'T call render() - it will clear the form fields!
          // showStatus() already calls render()
          return;
        } else {
          // Retry with override (re-read form values since we're in a retry)
          const retryName = this.shadowRoot.getElementById(`name-${slot}`).value.trim();
          const retryCodeType = this.shadowRoot.getElementById(`type-${slot}`).value;
          const retryCode = retryCodeType === 'pin' ? (this.shadowRoot.getElementById(`code-${slot}`)?.value.trim() || '') : '';
          
          await this._hass.callService('yale_lock_manager', 'set_user_code', {
            entity_id: this._config.entity,
            slot: parseInt(slot, 10),
            name: retryName,
            code: retryCode,
            code_type: retryCodeType,
            override_protection: true
          });
          this.showStatus(slot, 'User saved (unknown code overwritten)', 'success');
        }
      } else {
        throw error;
      }
    }
  }

  async handleClearCode(slot, confirmed) {
    if (!confirmed) {
      this.showStatus(slot, 'Clear this slot? This will remove all settings.', 'confirm');
      this._statusMessages[slot].confirmAction = 'clear';
      this.render();
      return;
    }

    this.clearStatus(slot);
    await this._hass.callService('yale_lock_manager', 'clear_user_code', {
      entity_id: this._config.entity,
      slot: parseInt(slot, 10)
    });
    this._expandedSlot = null;
    this.showStatus(slot, 'Slot cleared', 'success');
  }

  async handleResetUsageCount(slot, confirmed) {
    if (!confirmed) {
      this.showStatus(slot, 'Reset usage counter to 0?', 'confirm');
      this._statusMessages[slot].confirmAction = 'reset-count';
      this.render();
      return;
    }

    this.clearStatus(slot);
    await this._hass.callService('yale_lock_manager', 'reset_usage_count', {
      entity_id: this._config.entity,
      slot: parseInt(slot, 10)
    });
    this.showStatus(slot, 'Counter reset', 'success');
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
