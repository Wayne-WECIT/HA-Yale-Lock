/**
 * Yale Lock Manager Card
 * Refactored to LitElement - v1.8.2.34
 * 
 * Using LitElement reactive properties for proper form state management
 * Form values are stored as reactive properties and only update when explicitly changed
 */

import { LitElement, html, css } from 'https://cdn.jsdelivr.net/npm/lit@3/index.js';

class YaleLockManagerCard extends LitElement {
  static properties = {
    hass: { type: Object, attribute: false },
    config: { type: Object, attribute: false },
    expandedSlot: { type: Number, attribute: false },
    statusMessages: { type: Object, attribute: false },
    showClearCacheConfirm: { type: Boolean, attribute: false },
    // Form values as reactive properties - per slot
    formValues: { type: Object, attribute: false }
  };

  constructor() {
    super();
    this.hass = null;
    this.config = null;
    this.expandedSlot = null;
    this.statusMessages = {};
    this.showClearCacheConfirm = false;
    this.formValues = {}; // { slot: { name, code, type, cachedStatus } }
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('You must specify an entity');
    }
    this.config = config;
  }

  set hass(hass) {
    const oldHass = this.hass;
    this.hass = hass;
    // Only request update if entity state actually changed
    // Don't update if a slot is expanded (preserve form state)
    if (this.expandedSlot === null) {
      this.requestUpdate('hass', oldHass);
    }
  }

  // Initialize form values from entity state when slot is expanded
  initializeFormValues(slot) {
    const user = this.getUserData().find(u => u.slot === slot);
    if (user && !this.formValues[slot]) {
      this.formValues = {
        ...this.formValues,
        [slot]: {
          name: user.name || '',
          code: user.code || '',
          type: user.code_type || 'pin',
          cachedStatus: user.lock_status !== null && user.lock_status !== undefined 
            ? user.lock_status 
            : (user.enabled ? 1 : 2)
        }
      };
      this.requestUpdate();
    }
  }

  // Update form value for a specific slot
  updateFormValue(slot, field, value) {
    if (!this.formValues[slot]) {
      this.formValues[slot] = {};
    }
    this.formValues = {
      ...this.formValues,
      [slot]: {
        ...this.formValues[slot],
        [field]: value
      }
    };
    // Don't trigger full render - form field is already updated in DOM
  }

  // Get form value or fallback to entity state
  getFormValue(slot, field, defaultValue) {
    if (this.formValues[slot] && this.formValues[slot][field] !== undefined) {
      return this.formValues[slot][field];
    }
    return defaultValue;
  }

  getUserData() {
    const stateObj = this.hass?.states[this.config?.entity];
    const users = stateObj?.attributes?.users || {};
    const usersArray = [];
    
    for (let slot = 1; slot <= 20; slot++) {
      const user = users[slot.toString()] || { 
        name: '',
        code: '', 
        lock_code: '',
        code_type: 'pin',
        enabled: false,
        lock_status: null,
        lock_status_from_lock: null,
        lock_enabled: false,
        synced_to_lock: false,
        schedule: { start: null, end: null },
        usage_limit: null,
        usage_count: 0
      };
      usersArray.push({ slot, ...user });
    }
    
    return usersArray;
  }

  static styles = css`
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

  render() {
    if (!this.hass || !this.config) {
      return html`<ha-card><div class="error">Loading...</div></ha-card>`;
    }

    const entityId = this.config.entity;
    const stateObj = this.hass.states[entityId];

    if (!stateObj) {
      return html`
        <ha-card>
          <div class="error">⚠️ Entity "${entityId}" not found</div>
        </ha-card>
      `;
    }

    const users = this.getUserData();
    const isLocked = stateObj.state === 'locked';
    const batteryLevel = stateObj.attributes.battery_level || 0;
    const doorStatus = stateObj.attributes.door_status || 'unknown';
    const boltStatus = stateObj.attributes.bolt_status || 'unknown';
    const totalUsers = stateObj.attributes.total_users || 0;
    const enabledUsers = stateObj.attributes.enabled_users || 0;

    return html`
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
            <button @click=${this.toggleLock}>${isLocked ? 'Unlock' : 'Lock'}</button>
            <button class="secondary" @click=${this.refresh}>Refresh</button>
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
              <th>Status</th>
              <th>Synced</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(user => this.renderUserRow(user))}
          </tbody>
        </table>
        
        <hr style="margin: 24px 0 16px 0;">
        <div style="text-align: center; padding: 16px 0;">
          ${this.showClearCacheConfirm ? html`
            <div style="background: var(--warning-color-background, rgba(255, 152, 0, 0.1)); border: 1px solid var(--warning-color, #ff9800); border-radius: 4px; padding: 12px; margin-bottom: 12px;">
              <p style="margin: 0 0 12px 0; color: var(--warning-color, #ff9800); font-weight: 500;">⚠️ Are you sure you want to clear all local cache?</p>
              <div style="display: flex; gap: 8px; justify-content: center;">
                <button @click=${this.confirmClearCache} style="background: var(--error-color, #f44336); color: white;">Yes, Clear Cache</button>
                <button class="secondary" @click=${this.cancelClearCache}>Cancel</button>
              </div>
            </div>
          ` : ''}
          <button class="secondary" @click=${this.showClearCacheConfirm} style="background: var(--error-color-background, rgba(244, 67, 54, 0.1)); color: var(--error-color, #f44336); border: 1px solid var(--error-color, #f44336);">
            🗑️ Clear Local Cache
          </button>
          <p style="color: var(--secondary-text-color); font-size: 0.85em; margin-top: 8px;">
            This will remove all locally stored user data. Use "Refresh from lock" to reload from the physical lock.
          </p>
        </div>
      </ha-card>
    `;
  }

  renderUserRow(user) {
    const isExpanded = this.expandedSlot === user.slot;
    const isFob = user.code_type === 'fob';
    
    // Get form values (reactive properties)
    const formName = this.getFormValue(user.slot, 'name', user.name || '');
    const formCode = this.getFormValue(user.slot, 'code', user.code || '');
    const formType = this.getFormValue(user.slot, 'type', user.code_type || 'pin');
    const formCachedStatus = this.getFormValue(user.slot, 'cachedStatus', 
      user.lock_status !== null && user.lock_status !== undefined 
        ? user.lock_status 
        : (user.enabled ? 1 : 2));
    
    const statusText = this.getStatusText(user);
    const statusColor = this.getStatusColor(user);
    
    const hasLockPin = user.lock_code && user.lock_code.trim() !== '' && user.lock_code.trim() !== 'No PIN on lock';
    const hasCachedPin = formCode && formCode.trim() !== '';
    const hasName = formName && formName.trim() !== '' && formName.trim() !== `User ${user.slot}`;
    const hasData = hasLockPin || hasCachedPin || hasName;

    return html`
      <tr class="clickable" @click=${() => this.toggleExpand(user.slot)}>
        <td><strong>${user.slot}</strong></td>
        <td>${user.name || `User ${user.slot}`}</td>
        <td>${isFob ? '🏷️' : '🔑'}</td>
        <td>
          <span style="
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            background: ${statusColor}20;
            color: ${statusColor};
            font-weight: 500;
            font-size: 0.85em;
          ">${statusText}</span>
        </td>
        <td>${user.synced_to_lock ? '✓' : '⚠️'}</td>
      </tr>
      ${isExpanded ? html`
        <tr class="expanded-row">
          <td colspan="6">
            <div class="expanded-content">
              <h3>Slot ${user.slot} Settings</h3>
              
              <div id="status-${user.slot}">${this.renderStatusMessage(user.slot)}</div>
              
              <div class="form-group">
                <label>User Name:</label>
                <input 
                  type="text" 
                  id="name-${user.slot}" 
                  .value=${formName}
                  placeholder="Enter name"
                  @input=${(e) => this.updateFormValue(user.slot, 'name', e.target.value)}
                >
              </div>
              
              <div class="form-group">
                <label>Code Type:</label>
                <select 
                  id="type-${user.slot}" 
                  .value=${formType}
                  @change=${(e) => {
                    this.updateFormValue(user.slot, 'type', e.target.value);
                    this.changeType(user.slot, e.target.value);
                  }}
                >
                  <option value="pin">PIN Code</option>
                  <option value="fob">FOB/RFID Card</option>
                </select>
              </div>
              
              ${!isFob ? html`
                <div class="form-group">
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div>
                      <label>📝 Cached Status (editable):</label>
                      <select 
                        id="cached-status-${user.slot}" 
                        .value=${formCachedStatus.toString()}
                        @change=${(e) => this.changeStatus(user.slot, e.target.value)}
                        style="width: 100%;"
                      >
                        ${!hasData ? html`
                          <option value="0">Available</option>
                        ` : html`
                          <option value="1">Enabled</option>
                          <option value="2">Disabled</option>
                        `}
                      </select>
                      <p style="color: var(--secondary-text-color); font-size: 0.75em; margin: 4px 0 0 0;">Status stored locally</p>
                    </div>
                    <div>
                      <label>🔒 Lock Status (from lock):</label>
                      <select 
                        id="lock-status-${user.slot}" 
                        disabled 
                        style="width: 100%; background: var(--card-background-color); border: 1px solid var(--divider-color); color: var(--secondary-text-color);"
                      >
                        <option value="0" ?selected=${(user.lock_status_from_lock ?? user.lock_status) === 0}>Available</option>
                        <option value="1" ?selected=${(user.lock_status_from_lock ?? user.lock_status) === 1}>Enabled</option>
                        <option value="2" ?selected=${(user.lock_status_from_lock ?? user.lock_status) === 2}>Disabled</option>
                      </select>
                      <p style="color: var(--secondary-text-color); font-size: 0.75em; margin: 4px 0 0 0;">Status from physical lock</p>
                    </div>
                  </div>
                  ${this.renderStatusSyncMessage(user, formCachedStatus)}
                </div>
              ` : ''}
              
              <div id="code-field-${user.slot}" class="${isFob ? 'hidden' : ''}">
                <div class="form-group">
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div>
                      <label>📝 Cached PIN (editable):</label>
                      <input 
                        type="text" 
                        id="code-${user.slot}" 
                        .value=${formCode}
                        placeholder="Enter PIN code" 
                        maxlength="10" 
                        pattern="[0-9]*" 
                        style="width: 100%;"
                        @input=${(e) => this.updateFormValue(user.slot, 'code', e.target.value)}
                      >
                      <p style="color: var(--secondary-text-color); font-size: 0.75em; margin: 4px 0 0 0;">PIN stored locally</p>
                    </div>
                    <div>
                      <label>🔒 Lock PIN (from lock):</label>
                      <input 
                        type="text" 
                        id="lock-code-${user.slot}" 
                        .value=${user.lock_code || ''}
                        placeholder="No PIN on lock" 
                        maxlength="10" 
                        pattern="[0-9]*" 
                        readonly 
                        style="width: 100%; background: var(--card-background-color); border: 1px solid var(--divider-color); color: var(--secondary-text-color);"
                      >
                      <p style="color: var(--secondary-text-color); font-size: 0.75em; margin: 4px 0 0 0;">PIN from physical lock</p>
                    </div>
                  </div>
                  ${this.renderPinSyncMessage(user, formCode)}
                </div>
              </div>
              
              <div id="fob-notice-${user.slot}" class="fob-notice ${!isFob ? 'hidden' : ''}">
                🏷️ FOB/RFID cards don't require a PIN. The card ID is read automatically when presented to the lock.
              </div>
              
              <hr>
              
              ${this.renderScheduleSection(user)}
              
              ${!isFob ? this.renderUsageLimitSection(user) : ''}
              
              <hr>
              <div class="button-group">
                <button @click=${() => this.saveUser(user.slot)}>
                  ${user.name ? 'Update User' : 'Save User'}
                </button>
                ${user.name ? html`
                  <button class="secondary" @click=${() => this.clearSlot(user.slot)}>Clear Slot</button>
                ` : ''}
              </div>
              ${!isFob ? html`
                <div class="button-group" style="margin-top: 12px;">
                  <button 
                    @click=${() => this.pushCode(user.slot)}
                    style="${!user.synced_to_lock ? 'background: #ff9800; color: white; font-weight: bold;' : ''}"
                  >${user.synced_to_lock ? 'Push' : 'Push Required'}</button>
                </div>
              ` : ''}
            </div>
          </td>
        </tr>
      ` : ''}
    `;
  }

  // Helper methods continue... (keeping existing logic but adapted for LitElement)
  // Due to length, I'll continue with the key methods...

  getStatusText(user) {
    if (user.lock_status !== null && user.lock_status !== undefined) {
      if (user.lock_status === 0) return 'Available';
      if (user.lock_status === 1) return 'Enabled';
      if (user.lock_status === 2) return 'Disabled';
    }
    if (user.lock_enabled !== null && user.lock_enabled !== undefined) {
      return user.lock_enabled ? 'Enabled' : 'Disabled';
    }
    if (user.enabled !== null && user.enabled !== undefined) {
      return user.enabled ? 'Enabled' : 'Disabled';
    }
    return 'Unknown';
  }

  getStatusColor(user) {
    if (user.lock_status !== null && user.lock_status !== undefined) {
      if (user.lock_status === 0) return '#9e9e9e';
      if (user.lock_status === 1) return '#4caf50';
      if (user.lock_status === 2) return '#f44336';
    }
    const isEnabled = user.lock_enabled !== null && user.lock_enabled !== undefined ? user.lock_enabled : user.enabled;
    return isEnabled ? '#4caf50' : '#f44336';
  }

  renderStatusMessage(slot) {
    const status = this.statusMessages[slot];
    if (!status) return '';

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

    return html`
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
        ${status.type === 'confirm' ? html`
          <button class="btn-confirm" @click=${() => {
            const action = status.confirmAction;
            this.clearStatus(slot);
            if (action) action();
          }}>Yes</button>
          <button class="btn-cancel" @click=${() => this.clearStatus(slot)}>No</button>
        ` : status.type !== 'success' ? html`
          <button class="btn-close" @click=${() => this.clearStatus(slot)}>✕</button>
        ` : ''}
      </div>
    `;
  }

  renderStatusSyncMessage(user, formCachedStatus) {
    const lockStatus = user.lock_status_from_lock ?? user.lock_status;
    if (lockStatus === null || lockStatus === undefined) return '';
    
    if (formCachedStatus !== lockStatus) {
      return html`
        <div style="margin-top: 8px; padding: 8px; background: #ff980015; border-left: 4px solid #ff9800; border-radius: 4px;">
          <span style="color: #ff9800; font-size: 0.85em;">⚠️ Status doesn't match - Click "Push" to sync</span>
        </div>
      `;
    } else {
      return html`
        <div style="margin-top: 8px; padding: 8px; background: #4caf5015; border-left: 4px solid #4caf50; border-radius: 4px;">
          <span style="color: #4caf50; font-size: 0.85em;">✅ Status matches - Synced</span>
        </div>
      `;
    }
  }

  renderPinSyncMessage(user, formCode) {
    if (!formCode || !user.lock_code) return '';
    
    if (formCode !== user.lock_code) {
      return html`
        <div style="margin-top: 8px; padding: 8px; background: #ff980015; border-left: 4px solid #ff9800; border-radius: 4px;">
          <span style="color: #ff9800; font-size: 0.85em;">⚠️ PINs don't match - Click "Push" to sync</span>
        </div>
      `;
    } else {
      return html`
        <div style="margin-top: 8px; padding: 8px; background: #4caf5015; border-left: 4px solid #4caf50; border-radius: 4px;">
          <span style="color: #4caf50; font-size: 0.85em;">✅ PINs match - Synced</span>
        </div>
      `;
    }
  }

  renderScheduleSection(user) {
    return html`
      <div class="form-group">
        <label class="toggle-label">
          <label class="toggle-switch">
            <input 
              type="checkbox" 
              id="schedule-toggle-${user.slot}" 
              ?checked=${!!(user.schedule?.start || user.schedule?.end)}
              @change=${(e) => this.toggleSchedule(user.slot, e.target.checked)}
            >
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
              <input 
                type="datetime-local" 
                id="start-${user.slot}" 
                .value=${user.schedule?.start ? user.schedule.start.substring(0, 16) : ''}
              >
            </div>
            <div style="flex: 1; min-width: 200px;">
              <label style="font-size: 0.85em;">End:</label>
              <input 
                type="datetime-local" 
                id="end-${user.slot}" 
                .value=${user.schedule?.end ? user.schedule.end.substring(0, 16) : ''}
              >
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderUsageLimitSection(user) {
    return html`
      <div class="form-group">
        <label class="toggle-label">
          <label class="toggle-switch">
            <input 
              type="checkbox" 
              id="limit-toggle-${user.slot}" 
              ?checked=${!!user.usage_limit}
              @change=${(e) => this.toggleLimit(user.slot, e.target.checked)}
            >
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
              <input type="number" .value=${user.usage_count || 0} readonly style="background: var(--disabled-color, #f0f0f0);">
            </div>
            <div style="flex: 1;">
              <label style="font-size: 0.85em;">Max:</label>
              <input 
                type="number" 
                id="limit-${user.slot}" 
                .value=${user.usage_limit || ''}
                placeholder="e.g., 5" 
                min="1"
              >
            </div>
          </div>
          ${user.usage_limit && user.usage_count >= user.usage_limit ? html`
            <p style="color: var(--error-color); margin-top: 8px;">🚫 Limit reached!</p>
          ` : user.usage_count > 0 ? html`
            <p style="color: var(--warning-color); margin-top: 8px;">⚠️ ${user.usage_count} / ${user.usage_limit || '∞'} uses</p>
          ` : ''}
          ${user.usage_count > 0 ? html`
            <button class="secondary" style="margin-top: 8px; width: 100%;" @click=${() => this.resetCount(user.slot)}>Reset Counter</button>
          ` : ''}
        </div>
      </div>
    `;
  }

  // Action methods (keeping existing logic)
  async toggleLock() {
    const stateObj = this.hass.states[this.config.entity];
    const service = stateObj.state === 'locked' ? 'unlock' : 'lock';
    try {
      await this.hass.callService('lock', service, { entity_id: this.config.entity });
    } catch (error) {
      this.showStatus(0, `Failed to ${service}: ${error.message}`, 'error');
    }
  }

  async refresh() {
    try {
      this.showStatus(0, '⏳ Refreshing codes from lock... This may take a moment.', 'info');
      await this.hass.callService('yale_lock_manager', 'pull_codes_from_lock', {
        entity_id: this.config.entity
      });
      this.showStatus(0, '✅ Refreshed from lock successfully!', 'success');
      this.requestUpdate();
    } catch (error) {
      this.showStatus(0, `❌ Refresh failed: ${error.message}`, 'error');
    }
  }

  toggleExpand(slot) {
    const wasExpanded = this.expandedSlot === slot;
    this.expandedSlot = wasExpanded ? null : slot;
    
    if (wasExpanded) {
      this.clearStatus(slot);
    } else {
      // Initialize form values when slot is first expanded
      this.initializeFormValues(slot);
    }
    
    this.requestUpdate();
  }

  changeType(slot, newType) {
    const codeField = this.shadowRoot.getElementById(`code-field-${slot}`);
    const fobNotice = this.shadowRoot.getElementById(`fob-notice-${slot}`);
    
    if (newType === 'fob') {
      if (codeField) codeField.classList.add('hidden');
      if (fobNotice) fobNotice.classList.remove('hidden');
    } else {
      if (codeField) codeField.classList.remove('hidden');
      if (fobNotice) fobNotice.classList.add('hidden');
    }
  }

  toggleSchedule(slot, checked) {
    const fields = this.shadowRoot.getElementById(`schedule-fields-${slot}`);
    if (fields) {
      fields.classList.toggle('hidden', !checked);
    }
  }

  toggleLimit(slot, checked) {
    const fields = this.shadowRoot.getElementById(`limit-fields-${slot}`);
    if (fields) {
      fields.classList.toggle('hidden', !checked);
    }
  }

  showStatus(slot, message, type = 'info', confirmAction = null) {
    this.statusMessages = {
      ...this.statusMessages,
      [slot]: { message, type, confirmAction }
    };
    this.requestUpdate();
  }

  clearStatus(slot) {
    const newMessages = { ...this.statusMessages };
    delete newMessages[slot];
    this.statusMessages = newMessages;
    this.requestUpdate();
  }

  async changeStatus(slot, statusValue) {
    const status = parseInt(statusValue, 10);
    this.updateFormValue(slot, 'cachedStatus', status);
    
    try {
      await this.hass.callService('yale_lock_manager', 'set_user_status', {
        entity_id: this.config.entity,
        slot: parseInt(slot, 10),
        status: status
      });
      this.showStatus(slot, 'Status updated', 'success');
      setTimeout(() => {
        if (this.statusMessages[slot]?.message === 'Status updated') {
          this.clearStatus(slot);
        }
      }, 2000);
    } catch (error) {
      this.showStatus(slot, `Failed to set status: ${error.message}`, 'error');
    }
  }

  async pushCode(slot) {
    const user = this.getUserData().find(u => u.slot === slot);
    
    if (!user || !user.name) {
      this.showStatus(slot, 'No user configured in this slot', 'error');
      return;
    }

    this.clearStatus(slot);
    
    this.showStatus(slot, `Push "${user.name}" to the lock now?`, 'confirm', async () => {
      try {
        this.showStatus(slot, '⏳ Pushing code to lock...', 'info');
        
        await this.hass.callService('yale_lock_manager', 'push_code_to_lock', {
          entity_id: this.config.entity,
          slot: parseInt(slot, 10)
        });
        
        this.showStatus(slot, '✅ Code pushed successfully!', 'success');
        setTimeout(() => this.requestUpdate(), 1500);
      } catch (error) {
        this.showStatus(slot, `❌ Push failed: ${error.message}`, 'error');
      }
    });
  }

  async saveUser(slot) {
    // Get values from form (reactive properties)
    const nameField = this.shadowRoot.getElementById(`name-${slot}`);
    const codeTypeField = this.shadowRoot.getElementById(`type-${slot}`);
    const codeField = this.shadowRoot.getElementById(`code-${slot}`);
    const statusField = this.shadowRoot.getElementById(`cached-status-${slot}`);
    
    const name = nameField?.value.trim() || '';
    const codeType = codeTypeField?.value || 'pin';
    const code = codeType === 'pin' ? (codeField?.value.trim() || '') : '';
    const cachedStatus = parseInt(statusField?.value || '0', 10);
    
    // Update reactive properties
    this.updateFormValue(slot, 'name', name);
    this.updateFormValue(slot, 'code', code);
    this.updateFormValue(slot, 'type', codeType);
    this.updateFormValue(slot, 'cachedStatus', cachedStatus);

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
      this.showStatus(slot, '⏳ Saving user data...', 'info');
      
      await this.hass.callService('yale_lock_manager', 'set_user_code', {
        entity_id: this.config.entity,
        slot: parseInt(slot, 10),
        name: name,
        code: code,
        code_type: codeType,
        override_protection: false,
        status: cachedStatus
      });

      // Save schedule
      const scheduleToggle = this.shadowRoot.getElementById(`schedule-toggle-${slot}`);
      const startInput = this.shadowRoot.getElementById(`start-${slot}`);
      const endInput = this.shadowRoot.getElementById(`end-${slot}`);
      
      let start = null;
      let end = null;
      
      if (scheduleToggle?.checked) {
        const startVal = startInput?.value?.trim() || '';
        const endVal = endInput?.value?.trim() || '';
        
        if (startVal && endVal) {
          start = startVal;
          end = endVal;
        }
      }
      
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

      await this.hass.callService('yale_lock_manager', 'set_user_schedule', {
        entity_id: this.config.entity,
        slot: parseInt(slot, 10),
        start_datetime: start,
        end_datetime: end
      });

      // Save usage limit (PINs only)
      if (codeType === 'pin') {
        const limitToggle = this.shadowRoot.getElementById(`limit-toggle-${slot}`);
        const limitInput = this.shadowRoot.getElementById(`limit-${slot}`);
        
        const limit = (limitToggle?.checked && limitInput?.value) ? parseInt(limitInput.value, 10) : null;
        
        await this.hass.callService('yale_lock_manager', 'set_usage_limit', {
          entity_id: this.config.entity,
          slot: parseInt(slot, 10),
          max_uses: limit
        });
      }

      // Check sync status
      const user = this.getUserData().find(u => u.slot === slot);
      if (user) {
        const codesMatch = codeType === 'pin' ? (code === (user.lock_code || '')) : true;
        const statusMatch = user.lock_status_from_lock !== null && user.lock_status_from_lock !== undefined
          ? (cachedStatus === user.lock_status_from_lock)
          : false;
        const isSynced = codesMatch && statusMatch;
        
        if (!isSynced && codeType === 'pin') {
          this.showStatus(slot, '✅ User saved! ⚠️ Push required to sync with lock.', 'warning');
        } else {
          this.showStatus(slot, '✅ User saved successfully!', 'success');
        }
      } else {
        this.showStatus(slot, '✅ User saved successfully!', 'success');
      }
      
      // Form values are already updated in reactive properties
      // They will persist through entity state updates
      setTimeout(() => this.requestUpdate(), 500);
      
    } catch (error) {
      if (error.message && error.message.includes('occupied by an unknown code')) {
        this.showStatus(slot, 'Slot contains an unknown code. Overwrite it?', 'confirm', async () => {
          try {
            await this.hass.callService('yale_lock_manager', 'set_user_code', {
              entity_id: this.config.entity,
              slot: parseInt(slot, 10),
              name: name,
              code: code,
              code_type: codeType,
              override_protection: true,
              status: cachedStatus
            });
            this.showStatus(slot, '✅ User saved successfully!', 'success');
            setTimeout(() => this.requestUpdate(), 500);
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
        await this.hass.callService('yale_lock_manager', 'clear_user_code', {
          entity_id: this.config.entity,
          slot: parseInt(slot, 10)
        });
        this.expandedSlot = null;
        const newFormValues = { ...this.formValues };
        delete newFormValues[slot];
        this.formValues = newFormValues;
        this.showStatus(slot, 'Slot cleared', 'success');
        setTimeout(() => this.requestUpdate(), 1000);
      } catch (error) {
        this.showStatus(slot, `Clear failed: ${error.message}`, 'error');
      }
    });
  }

  async resetCount(slot) {
    this.showStatus(slot, 'Reset usage counter to 0?', 'confirm', async () => {
      try {
        await this.hass.callService('yale_lock_manager', 'reset_usage_count', {
          entity_id: this.config.entity,
          slot: parseInt(slot, 10)
        });
        this.showStatus(slot, 'Counter reset', 'success');
        setTimeout(() => this.requestUpdate(), 500);
      } catch (error) {
        this.showStatus(slot, `Reset failed: ${error.message}`, 'error');
      }
    });
  }

  showClearCacheConfirm() {
    this.showClearCacheConfirm = true;
    this.requestUpdate();
  }
  
  cancelClearCache() {
    this.showClearCacheConfirm = false;
    this.requestUpdate();
  }
  
  async confirmClearCache() {
    try {
      await this.hass.callService('yale_lock_manager', 'clear_local_cache', {
        entity_id: this.config.entity
      });
      this.showClearCacheConfirm = false;
      this.formValues = {};
      this.showStatus(0, 'Local cache cleared', 'success');
      setTimeout(() => this.requestUpdate(), 500);
    } catch (error) {
      this.showStatus(0, `Failed to clear cache: ${error.message}`, 'error');
    }
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
