/**
 * Yale Lock Manager Card
 * Clean, simple logic - v1.8.2.30
 * 
 * Rules:
 * 1. When slot is expanded/being edited - NO refreshes of editable fields
 * 2. When save is clicked - NO refresh of editable fields, only update message area
 * 3. After confirmed save - refresh editable fields from entity state, compare with lock, update sync status
 * 4. After push - verify push, update lock fields, update sync status
 */

class YaleLockManagerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._expandedSlot = null;
    this._statusMessages = {}; // Per-slot status messages
    this._showClearCacheConfirm = false;
    this._showExportConfirm = false;
    this._showImportConfirm = false;
    this._formValues = {}; // Store form field values independently per slot
    // Format: { slot: { name, code, type, cachedStatus, schedule, usageLimit, notificationsEnabled, notificationServices } }
    this._refreshProgressListener = null; // Event listener for refresh progress
    this._refreshProgress = null; // Current refresh progress data
    this._unsavedChanges = {}; // Track unsaved changes per slot
    this._refreshSnapshot = null; // Snapshot of user data before refresh
    this._debugMode = false; // Debug mode flag for detailed logging
    this._localStorageKey = null; // Will be set when config is available
    this._debugLog = []; // Array of debug log entries
    this._showDebugPanel = false; // Toggle debug panel visibility
    this._savedSlots = {}; // Track which slots have been saved (enables Push button)
    this._lockAffectingChanges = {}; // Track if PIN or status changed (requires push)
    this._availableNotificationServices = null; // Cached list of available notification services
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('You must specify an entity');
    }
    this._config = config;
    // Set localStorage key based on entity ID
    this._localStorageKey = `yale_lock_manager_form_values_${config.entity}`;
    // Load form values from localStorage on config set
    this._loadFormValuesFromStorage();
  }

  set hass(hass) {
    const oldHass = this._hass;
    
    // Compare actual user data content, not object references
    const oldUsers = oldHass?.states[this._config?.entity]?.attributes?.users || {};
    const newUsers = hass?.states[this._config?.entity]?.attributes?.users || {};
    const oldUsersJson = JSON.stringify(oldUsers);
    const newUsersJson = JSON.stringify(newUsers);
    const entityChanged = oldHass && hass && oldUsersJson !== newUsersJson;
    
    // Always log when set hass() is called during push operations (for debugging)
    if (this._expandedSlot !== null) {
      const slotUser = newUsers[this._expandedSlot];
      if (slotUser) {
        console.log(`[Yale Lock Manager] set hass() called - Slot ${this._expandedSlot} lock_code: ${slotUser.lock_code || 'NOT SET'}`);
      }
    }
    
    if (this._debugMode) {
      if (entityChanged) {
        console.log('[Yale Lock Manager] [REFRESH DEBUG] set hass() called - entity state changed');
        console.log('[Yale Lock Manager] [REFRESH DEBUG] Old users count:', Object.keys(oldUsers).length);
        console.log('[Yale Lock Manager] [REFRESH DEBUG] New users count:', Object.keys(newUsers).length);
      } else {
        console.log('[Yale Lock Manager] [REFRESH DEBUG] set hass() called - entity state unchanged');
      }
    }
    
    this._hass = hass;
    
    // Load available notification services when hass is set (so card shows UI, All Mobiles, and individual devices)
    if (hass && !this._availableNotificationServices) {
      this.getAvailableNotificationServices().then(() => {
        if (this._expandedSlot !== null) {
          this.render(); // Re-render to show updated services in chips
        }
      });
    }
    
    // Subscribe to refresh progress events when hass is first set
    if (hass && !this._refreshProgressListener && hass.connection) {
      this._subscribeToRefreshProgress();
    }
    
    // CRITICAL: Don't re-render if a slot is expanded (preserves user input)
    // Only update if entity state actually changed and no slot is expanded
    if (this._expandedSlot === null) {
      // No slot expanded - safe to render
      if (this._debugMode && entityChanged) {
        console.log('[Yale Lock Manager] [REFRESH DEBUG] set hass() - calling render() (no slot expanded)');
      }
    this.render();
    } else {
      // Slot is expanded - only update non-editable parts (status messages, lock fields)
      if (this._debugMode && entityChanged) {
        console.log('[Yale Lock Manager] [REFRESH DEBUG] set hass() - calling _updateNonEditableParts() (slot expanded)');
      }
      this._updateNonEditableParts();
    }
  }
  
  connectedCallback() {
    // Load form values from localStorage when component connects
    if (this._localStorageKey) {
      this._loadFormValuesFromStorage();
    }
    // Subscribe to events when component is connected
    if (this._hass && this._hass.connection && !this._refreshProgressListener) {
      this._subscribeToRefreshProgress();
    }
  }
  
  disconnectedCallback() {
    // Unsubscribe from events when component is disconnected
    if (this._refreshProgressListener && typeof this._refreshProgressListener === 'function') {
      this._refreshProgressListener();
      this._refreshProgressListener = null;
    }
  }
  
  _subscribeToRefreshProgress() {
    if (!this._hass || !this._hass.connection) {
      console.warn('[Yale Lock Manager] Cannot subscribe to events: hass.connection not available');
      return;
    }
    
    try {
      // Subscribe to refresh progress events
      this._refreshProgressListener = this._hass.connection.subscribeEvents(
        (event) => {
          console.log('[Yale Lock Manager] Refresh progress event received:', event);
          this._handleRefreshProgress(event);
        },
        "yale_lock_manager_refresh_progress"
      );
      console.log('[Yale Lock Manager] Subscribed to refresh progress events');
    } catch (error) {
      console.error('[Yale Lock Manager] Failed to subscribe to refresh progress events:', error);
    }
  }
  
  _handleRefreshProgress(event) {
    // Try both event.detail and event.data (different event structures)
    const data = event.detail || event.data || event;
    if (!data || !data.action) {
      console.error('[Yale Lock Manager] Invalid refresh progress event data:', event);
      return;
    }
    
    // Always log complete events for debugging
    if (data.action === "complete") {
      console.log('[Yale Lock Manager] Refresh complete event received:', data);
    }
    
    if (this._debugMode) {
      console.log('[Yale Lock Manager] [REFRESH DEBUG] _handleRefreshProgress() called with event:', event);
    }
    
    this._refreshProgress = data;
    
    // Update the progress display
    this._updateRefreshProgress();
    
    // Also update status message for slot 0
    if (data.action === "start") {
      if (this._debugMode) {
        console.log('[Yale Lock Manager] [REFRESH DEBUG] Refresh started');
      }
      this.showStatus(0, `⏳ Starting refresh - scanning ${data.total_slots} slots...`, 'info');
      this.renderStatusMessage(0); // Explicitly render
    } else if (data.action === "progress") {
      const percent = Math.round((data.current_slot / data.total_slots) * 100);
      this.showStatus(0, 
        `⏳ Scanning slot ${data.current_slot}/${data.total_slots} (${percent}%)... ` +
        `Found: ${data.codes_found} (${data.codes_new} new, ${data.codes_updated} updated)`, 
        'info'
      );
      this.renderStatusMessage(0); // Explicitly render
    } else if (data.action === "complete") {
      console.log('[Yale Lock Manager] ✅ Refresh complete event received - Found', data.codes_found, 'codes (', data.codes_new, 'new,', data.codes_updated, 'updated)');
      if (this._debugMode) {
        console.log('[Yale Lock Manager] [REFRESH DEBUG] Refresh complete event received');
        console.log('[Yale Lock Manager] [REFRESH DEBUG] Codes found:', data.codes_found, 'new:', data.codes_new, 'updated:', data.codes_updated);
      }
      this.showStatus(0, 
        `✅ Refresh complete! Found ${data.codes_found} codes (${data.codes_new} new, ${data.codes_updated} updated)`, 
        'success'
      );
      this.renderStatusMessage(0); // Explicitly render
      
      // Wait for entity state to actually change (compare to snapshot)
      console.log('[Yale Lock Manager] Starting polling for entity state update...');
      let attempts = 0;
      const maxAttempts = 20; // Wait up to 6 seconds (20 * 300ms)
      const checkInterval = setInterval(() => {
        attempts++;
        const stateObj = this._hass?.states[this._config?.entity];
        const newUsers = stateObj?.attributes?.users || {};
        
        if (attempts === 1) {
          console.log('[Yale Lock Manager] First poll - Current users:', Object.keys(newUsers).length, 'Snapshot users:', this._refreshSnapshot ? Object.keys(this._refreshSnapshot).length : 0);
          if (this._debugMode) {
            this._logUserData(newUsers, 'First poll - Current');
            this._logUserData(this._refreshSnapshot, 'First poll - Snapshot');
          }
        }
        
        // Check if data has actually changed by comparing to snapshot
        const comparison = this._compareUserData(this._refreshSnapshot, newUsers);
        
        // Force update if we have users in entity state (even if comparison doesn't detect change)
        const hasUsers = Object.keys(newUsers).length > 0;
        const shouldUpdate = comparison.hasChanged || attempts >= maxAttempts || (hasUsers && attempts >= 3);
        
        if (attempts % 5 === 0 || attempts === 1) {
          console.log(`[Yale Lock Manager] Poll attempt ${attempts}/${maxAttempts}, hasChanged:`, comparison.hasChanged, 'hasUsers:', hasUsers, 'shouldUpdate:', shouldUpdate);
          if (comparison.details.length > 0 && this._debugMode) {
            console.log('[Yale Lock Manager] [REFRESH DEBUG] Change details:', comparison.details);
          }
        }
        
        if (shouldUpdate) {
          clearInterval(checkInterval);
          console.log(`[Yale Lock Manager] Polling complete after ${attempts} attempts, hasChanged:`, comparison.hasChanged, 'hasUsers:', hasUsers);
          if (this._debugMode && comparison.details.length > 0) {
            console.log('[Yale Lock Manager] [REFRESH DEBUG] Final change details:', comparison.details);
          }
          this._refreshSnapshot = null; // Clear snapshot
          
          // Merge entity state with localStorage values
          // Prefer localStorage for editable fields, entity state for read-only fields
          const stateObj = this._hass?.states[this._config?.entity];
          const newUsers = stateObj?.attributes?.users || {};
          const entitySlotKeys = new Set(Object.keys(newUsers));
          
          // Remove slots from localStorage that no longer exist in entity state
          Object.keys(this._formValues).forEach(slot => {
            if (!entitySlotKeys.has(slot) && this._expandedSlot !== parseInt(slot, 10)) {
              delete this._formValues[slot];
            }
          });
          
          // Update localStorage with entity state data (after refresh, entity state is source of truth)
          Object.keys(newUsers).forEach(slot => {
            const user = newUsers[slot];
            // Only update localStorage if slot is not currently being edited
            if (this._expandedSlot !== parseInt(slot, 10)) {
              // After refresh, update localStorage with entity state data
              // This ensures localStorage has the latest data from the lock
              this._formValues[slot] = {
                name: user.name || '',
                code: user.code || '',
                type: user.code_type || 'pin',
                cachedStatus: user.lock_status !== null && user.lock_status !== undefined 
                  ? user.lock_status 
                  : (user.enabled ? 1 : 2),
                schedule: user.schedule || { start: null, end: null },
                usageLimit: user.usage_limit || null,
                notificationsEnabled: user.notifications_enabled || false
              };
            }
          });
          // Save updated values to localStorage
          this._saveFormValuesToStorage();
          
          // Log after refresh
          const afterRefreshCached = JSON.parse(JSON.stringify(this._formValues));
          this._addDebugLog('After Refresh', null, {
            cached_slots: Object.keys(afterRefreshCached).length,
            entity_slots: Object.keys(newUsers).length
          });
          
          console.log('[Yale Lock Manager] Updated localStorage with', Object.keys(newUsers).length, 'users from entity state');
          
          // Entity state updated - refresh UI
          if (this._expandedSlot === null) {
            if (this._debugMode) {
              console.log('[Yale Lock Manager] [REFRESH DEBUG] Calling render() (no slot expanded)');
            }
            this.render(); // Full refresh to show new data
          } else {
            if (this._debugMode) {
              console.log('[Yale Lock Manager] [REFRESH DEBUG] Calling _updateSlotFromEntityState() (slot expanded)');
            }
            // Update the expanded slot from entity state (with focus protection)
            // This will use localStorage values for editable fields
            this._updateSlotFromEntityState(this._expandedSlot);
          }
        }
      }, 300); // Check every 300ms
      
      // Clear progress after a delay
      setTimeout(() => {
        this._refreshProgress = null;
        this._updateRefreshProgress();
      }, 5000);
    }
  }
  
  _updateRefreshProgress() {
    if (!this._refreshProgress || !this.shadowRoot) return;
    
    let progressContainer = this.shadowRoot.querySelector('#refresh-progress');
    if (!progressContainer) {
      console.warn('[Yale Lock Manager] Progress container not found, ensuring render...');
      // Force a render to create containers if they don't exist
      if (this._expandedSlot === null) {
        this.render();
        // Try again after render
        progressContainer = this.shadowRoot.querySelector('#refresh-progress');
        if (!progressContainer) {
          console.error('[Yale Lock Manager] Progress container still not found after render');
      return;
        }
      } else {
        return;
      }
    }
    
    if (this._refreshProgress.action === "progress") {
      const percent = (this._refreshProgress.current_slot / this._refreshProgress.total_slots) * 100;
      progressContainer.innerHTML = `
        <div style="margin: 8px 0;">
          <div style="background: var(--divider-color, #e0e0e0); height: 8px; border-radius: 4px; overflow: hidden;">
            <div style="background: var(--primary-color, #03a9f4); height: 100%; width: ${percent}%; transition: width 0.3s ease;"></div>
          </div>
          <div style="font-size: 0.85em; color: var(--secondary-text-color, #757575); margin-top: 4px; text-align: center;">
            Slot ${this._refreshProgress.current_slot} of ${this._refreshProgress.total_slots}
          </div>
        </div>
      `;
      progressContainer.style.display = 'block';
    } else if (this._refreshProgress.action === "complete" || this._refreshProgress.action === "start") {
      // Keep progress bar visible during start and complete
      if (this._refreshProgress.action === "start") {
        progressContainer.innerHTML = `
          <div style="margin: 8px 0;">
            <div style="background: var(--divider-color, #e0e0e0); height: 8px; border-radius: 4px; overflow: hidden;">
              <div style="background: var(--primary-color, #03a9f4); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
            </div>
          </div>
        `;
      } else {
        progressContainer.innerHTML = `
          <div style="margin: 8px 0;">
            <div style="background: var(--divider-color, #e0e0e0); height: 8px; border-radius: 4px; overflow: hidden;">
              <div style="background: var(--primary-color, #03a9f4); height: 100%; width: 100%; transition: width 0.3s ease;"></div>
            </div>
          </div>
        `;
      }
      progressContainer.style.display = 'block';
    } else {
      progressContainer.style.display = 'none';
    }
  }
  
  _updateSlotFromEntityState(slot, preserveCachedCode = false) {
    /**
     * Update a slot's form fields from entity state (source of truth).
     * This is called after save/push operations to refresh the UI with latest data.
     * CRITICAL: Only updates editable fields if they don't have focus (prevents overwriting user input).
     * 
     * @param {number} slot - The slot number to update
     * @param {boolean} preserveCachedCode - If true, don't update the cached PIN field (used after push to preserve the pushed code)
     */
    const user = this.getUserData().find(u => u.slot === slot);
    if (!user) {
      console.warn(`[Yale Lock Manager] User not found for slot ${slot}`);
      return;
    }

    if (this._expandedSlot === slot) {
      // Slot is expanded - update form fields directly (don't destroy DOM)
      const nameField = this.shadowRoot.getElementById(`name-${slot}`);
      const codeField = this.shadowRoot.getElementById(`code-${slot}`);
      const statusField = this.shadowRoot.getElementById(`cached-status-${slot}`);
      const lockCodeField = this.shadowRoot.querySelector(`#lock-code-${slot}`);
      const lockStatusField = this.shadowRoot.querySelector(`#lock-status-${slot}`);
      
      // CRITICAL: Only update editable fields if they don't have focus
      // This prevents overwriting user input while they're typing
      if (nameField) {
        if (document.activeElement !== nameField) {
          nameField.value = user.name || '';
        } else {
          console.log(`[Yale Lock Manager] Skipping name field update for slot ${slot} - field has focus`);
        }
      }
      
      // CRITICAL: After push, preserve the cached PIN that was just pushed
      // Don't overwrite it with entity.code which might be stale
      if (codeField && !preserveCachedCode) {
        if (document.activeElement !== codeField) {
          codeField.value = user.code || '';
        } else {
          console.log(`[Yale Lock Manager] Skipping code field update for slot ${slot} - field has focus`);
        }
      } else if (preserveCachedCode) {
        console.log(`[Yale Lock Manager] Preserving cached PIN for slot ${slot} after push operation`);
      }
      
      if (statusField) {
        if (document.activeElement !== statusField) {
          const cachedStatus = user.lock_status !== null && user.lock_status !== undefined 
            ? user.lock_status 
            : (user.enabled ? 1 : 2);
          statusField.value = cachedStatus.toString();
        } else {
          console.log(`[Yale Lock Manager] Skipping status field update for slot ${slot} - field has focus`);
        }
      }
      
      // Always update lock fields (read-only) - safe to update anytime
      if (lockCodeField) {
        lockCodeField.value = user.lock_code || '';
      } else {
        console.warn(`[Yale Lock Manager] Lock code field not found for slot ${slot}`);
      }
      
      if (lockStatusField) {
        const lockStatus = user.lock_status_from_lock ?? user.lock_status;
        lockStatusField.value = lockStatus !== null && lockStatus !== undefined ? lockStatus.toString() : '0';
      } else {
        console.warn(`[Yale Lock Manager] Lock status field not found for slot ${slot}`);
      }
      
      // Update schedule and usage limit fields if they exist
      const scheduleToggle = this.shadowRoot.getElementById(`schedule-toggle-${slot}`);
      const startInput = this.shadowRoot.getElementById(`start-${slot}`);
      const endInput = this.shadowRoot.getElementById(`end-${slot}`);
      const limitToggle = this.shadowRoot.getElementById(`limit-toggle-${slot}`);
      const limitInput = this.shadowRoot.getElementById(`limit-${slot}`);
      
      if (user.schedule && user.schedule.start && user.schedule.end) {
        if (scheduleToggle && !scheduleToggle.checked) {
          scheduleToggle.checked = true;
          this.toggleSchedule(slot, true);
        }
        if (startInput && document.activeElement !== startInput) {
          startInput.value = user.schedule.start;
        }
        if (endInput && document.activeElement !== endInput) {
          endInput.value = user.schedule.end;
        }
      }
      
      if (user.usage_limit !== null && user.usage_limit !== undefined) {
        if (limitToggle && !limitToggle.checked) {
          limitToggle.checked = true;
          this.toggleLimit(slot, true);
        }
        if (limitInput && document.activeElement !== limitInput) {
          limitInput.value = user.usage_limit.toString();
        }
      }
      
      // Update notification toggle
      const notificationToggle = this.shadowRoot.getElementById(`notification-toggle-${slot}`);
      if (notificationToggle) {
        const notificationsEnabled = user.notifications_enabled || false;
        if (notificationToggle.checked !== notificationsEnabled) {
          notificationToggle.checked = notificationsEnabled;
          this._setFormValue(slot, 'notificationsEnabled', notificationsEnabled);
        }
      }
      
      // Sync notification service chips
      // Support both old format (string) and new format (array)
      let notificationServices = user.notification_services;
      if (!notificationServices) {
        notificationServices = user.notification_service ? [user.notification_service] : ['notify.persistent_notification'];
      } else if (!Array.isArray(notificationServices)) {
        notificationServices = [notificationServices];
      }
      
      // Update form values
      const currentServices = this._formValues[slot]?.notificationServices || [];
      const currentServicesArray = Array.isArray(currentServices) ? currentServices : (currentServices ? [currentServices] : []);
      if (JSON.stringify([...currentServicesArray].sort()) !== JSON.stringify([...notificationServices].sort())) {
        this._setFormValue(slot, 'notificationServices', notificationServices);
        // Re-render chips if slot is visible
        const chipsContainer = this.shadowRoot.getElementById(`notification-services-${slot}`);
        if (chipsContainer) {
          chipsContainer.innerHTML = this.renderNotificationServiceChips(slot, user);
        }
      }
      
      // Update _formValues - prefer localStorage values, fall back to entity state
      // This preserves user input even if entity state is stale
      const storedValues = this._formValues[slot] || {};
      this._formValues[slot] = {
        name: storedValues.name !== undefined ? storedValues.name : (user.name || ''),
        code: storedValues.code !== undefined ? storedValues.code : (user.code || ''),
        type: storedValues.type !== undefined ? storedValues.type : (user.code_type || 'pin'),
        cachedStatus: storedValues.cachedStatus !== undefined 
          ? storedValues.cachedStatus 
          : (user.lock_status !== null && user.lock_status !== undefined 
            ? user.lock_status 
            : (user.enabled ? 1 : 2)),
        schedule: storedValues.schedule || (user.schedule || { start: null, end: null }),
        usageLimit: storedValues.usageLimit !== undefined ? storedValues.usageLimit : (user.usage_limit || null),
        notificationsEnabled: storedValues.notificationsEnabled !== undefined ? storedValues.notificationsEnabled : (user.notifications_enabled || false),
        notificationService: storedValues.notificationService !== undefined ? storedValues.notificationService : (user.notification_service || 'notify.persistent_notification')
      };
      // Save to localStorage after merging
      this._saveFormValuesToStorage();
      
      // Update sync indicators and status badges
      this._updateNonEditableParts();
      
      // Clear unsaved changes warning
      this._checkForUnsavedChanges(slot);
    } else {
      // Slot not expanded - safe to do full render
      this.render();
    }
  }

  _updateNonEditableParts() {
    // Update only non-editable parts when slot is expanded
    // This preserves form field values while updating lock status, sync status, etc.
    if (!this._hass || !this._config) return;
    
    const stateObj = this._hass.states[this._config.entity];
    if (!stateObj) return;
    
    const users = this.getUserData();
    
    // Update sync status indicators in table
    users.forEach(user => {
      const syncCell = this.shadowRoot?.querySelector(`#sync-${user.slot}`);
      if (syncCell) {
        syncCell.textContent = user.synced_to_lock ? '✓' : '⚠️';
      }
      
      // Update status badge
      const statusCell = this.shadowRoot?.querySelector(`#status-badge-${user.slot}`);
      if (statusCell) {
        // Check if there's a cached PIN
        const hasCachedPin = user.code && user.code.trim() !== '';
        const lockStatus = user.lock_status_from_lock ?? user.lock_status;
        const isLockAvailable = (lockStatus === 0 || lockStatus === null || lockStatus === undefined);
        
        const getStatusText = (status, lockEnabled, enabled, hasCachedPin, isLockAvailable) => {
          // If no cached PIN and lock is available, show "Available"
          if (!hasCachedPin && isLockAvailable) {
            return 'Available';
          }
          
          if (status !== null && status !== undefined) {
            if (status === 0) return 'Available';
            if (status === 1) return 'Enabled';
            if (status === 2) return 'Disabled';
          }
          if (lockEnabled !== null && lockEnabled !== undefined) {
            return lockEnabled ? 'Enabled' : 'Disabled';
          }
          if (enabled !== null && enabled !== undefined) {
            return enabled ? 'Enabled' : 'Disabled';
          }
          return 'Unknown';
        };
        
        const getStatusColor = (status, lockEnabled, enabled, hasCachedPin, isLockAvailable) => {
          // If no cached PIN and lock is available, use gray for "Available"
          if (!hasCachedPin && isLockAvailable) {
            return '#9e9e9e';
          }
          
          if (status !== null && status !== undefined) {
            if (status === 0) return '#9e9e9e';
            if (status === 1) return '#4caf50';
            if (status === 2) return '#f44336';
          }
          if (lockEnabled !== null && lockEnabled !== undefined || enabled !== null && enabled !== undefined) {
            const isEnabled = lockEnabled !== null && lockEnabled !== undefined ? lockEnabled : enabled;
            return isEnabled ? '#4caf50' : '#f44336';
          }
          return '#9e9e9e';
        };
        
        const statusText = getStatusText(user.lock_status, user.lock_enabled, user.enabled, hasCachedPin, isLockAvailable);
        const statusColor = getStatusColor(user.lock_status, user.lock_enabled, user.enabled, hasCachedPin, isLockAvailable);
        
        statusCell.innerHTML = `
          <span style="
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            background: ${statusColor}20;
            color: ${statusColor};
            font-weight: 500;
            font-size: 0.85em;
          ">${statusText}</span>
        `;
      }
      
      // Update lock fields (read-only) in expanded slot
      if (this._expandedSlot === user.slot) {
        const lockCodeField = this.shadowRoot?.querySelector(`#lock-code-${user.slot}`);
        const lockStatusField = this.shadowRoot?.querySelector(`#lock-status-${user.slot}`);
        
        if (lockCodeField) {
          lockCodeField.value = user.lock_code || '';
        }
        if (lockStatusField) {
          const lockStatus = user.lock_status_from_lock ?? user.lock_status;
          lockStatusField.value = lockStatus !== null && lockStatus !== undefined ? lockStatus.toString() : '0';
        }
      }
    });
    
    // Update header info (battery, door status, etc.)
    const batteryLevel = stateObj.attributes.battery_level || 0;
    const doorStatus = stateObj.attributes.door_status || 'unknown';
    const boltStatus = stateObj.attributes.bolt_status || 'unknown';
    const totalUsers = stateObj.attributes.total_users || 0;
    const enabledUsers = stateObj.attributes.enabled_users || 0;
    
    const batteryInfo = this.shadowRoot?.querySelector('.status-line');
    if (batteryInfo) {
      batteryInfo.textContent = `🔋 ${batteryLevel}% Battery • Bolt: ${boltStatus} • Door: ${doorStatus}`;
    }
    
    const userCount = this.shadowRoot?.querySelector('.user-count');
    if (userCount) {
      userCount.textContent = `👥 ${enabledUsers} / ${totalUsers} active users`;
    }
  }

  _getFormValue(slot, field, defaultValue) {
    // Get form value from _formValues, or use entity state as fallback
    // CRITICAL: Always prefer _formValues over entity state for editable fields
    if (this._formValues[slot] && this._formValues[slot][field] !== undefined) {
      return this._formValues[slot][field];
    }
    // Only fall back to entity state if _formValues doesn't exist for this slot
    return defaultValue;
  }

  _setFormValue(slot, field, value) {
    // Store form value independently
    if (!this._formValues[slot]) {
      this._formValues[slot] = {};
    }
    this._formValues[slot][field] = value;
    // Save to localStorage immediately
    this._saveFormValuesToStorage();
  }
  
  // Make _setFormValue accessible from inline handlers
  setFormValue(slot, field, value) {
    this._setFormValue(slot, field, value);
  }

  // ========== LOCALSTORAGE PERSISTENCE ==========
  
  _getStorageKey() {
    return this._localStorageKey || `yale_lock_manager_form_values_${this._config?.entity || 'default'}`;
  }
  
  _saveFormValuesToStorage() {
    try {
      const key = this._getStorageKey();
      if (key && this._formValues) {
        localStorage.setItem(key, JSON.stringify(this._formValues));
        if (this._debugMode) {
          console.log('[Yale Lock Manager] Saved form values to localStorage:', Object.keys(this._formValues).length, 'slots');
        }
      }
    } catch (error) {
      console.warn('[Yale Lock Manager] Failed to save form values to localStorage:', error);
    }
  }
  
  _loadFormValuesFromStorage() {
    try {
      const key = this._getStorageKey();
      if (key) {
        const stored = localStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object') {
            // Merge with existing _formValues (don't overwrite if slot is currently being edited)
            Object.keys(parsed).forEach(slot => {
              // Only load if slot is not currently expanded (preserve active edits)
              if (this._expandedSlot !== parseInt(slot, 10)) {
                this._formValues[slot] = { ...this._formValues[slot], ...parsed[slot] };
              }
            });
            if (this._debugMode) {
              console.log('[Yale Lock Manager] Loaded form values from localStorage:', Object.keys(parsed).length, 'slots');
            }
          }
        }
      }
    } catch (error) {
      console.warn('[Yale Lock Manager] Failed to load form values from localStorage:', error);
    }
  }
  
  _clearFormValuesFromStorage() {
    try {
      const key = this._getStorageKey();
      if (key) {
        localStorage.removeItem(key);
        this._formValues = {};
        if (this._debugMode) {
          console.log('[Yale Lock Manager] Cleared form values from localStorage');
        }
      }
    } catch (error) {
      console.warn('[Yale Lock Manager] Failed to clear form values from localStorage:', error);
    }
  }

  _syncFormValuesFromEntity(slot, force = false) {
    // Sync form values from entity state (only when slot is first expanded, or if force=true)
    // CRITICAL: Prefer localStorage values over entity state to preserve user input
    // Only sync from entity state if localStorage doesn't have values for this slot
    if (!force && this._formValues[slot]) {
      // localStorage has values - don't overwrite (preserve user's edits)
      return;
    }

    // Try to load from localStorage first
    this._loadFormValuesFromStorage();
    
    // If still no values, sync from entity state
    if (!this._formValues[slot]) {
      const user = this.getUserData().find(u => u.slot === slot);
      if (user) {
        this._formValues[slot] = {
          name: user.name || '',
          code: user.code || '',
          type: user.code_type || 'pin',
          cachedStatus: user.lock_status !== null && user.lock_status !== undefined 
            ? user.lock_status 
            : (user.enabled ? 1 : 2),
          schedule: user.schedule || { start: null, end: null },
          usageLimit: user.usage_limit || null,
          notificationsEnabled: user.notifications_enabled || false
        };
        // Save to localStorage after syncing from entity
        this._saveFormValuesToStorage();
      }
    }
  }

  // ========== STATUS MESSAGE SYSTEM ==========
  
  showStatus(slot, message, type = 'info', confirmAction = null) {
    this._statusMessages[slot] = { message, type, confirmAction };
    this.renderStatusMessage(slot);
  }

  clearStatus(slot) {
    delete this._statusMessages[slot];
    this.renderStatusMessage(slot);
  }
  
  renderStatusMessage(slot) {
    const container = this.shadowRoot?.querySelector(`#status-${slot}`);
    if (!container) return;
    
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

    // Attach event listeners
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

  _storeRefreshSnapshot() {
    /** Store snapshot of current user data before refresh starts. */
    const stateObj = this._hass?.states[this._config?.entity];
    const currentUsers = stateObj?.attributes?.users || {};
    this._refreshSnapshot = JSON.parse(JSON.stringify(currentUsers)); // Deep copy
    
    if (this._debugMode) {
      console.log('[Yale Lock Manager] [REFRESH DEBUG] _storeRefreshSnapshot() - stored', Object.keys(this._refreshSnapshot).length, 'users');
    }
    
    return this._refreshSnapshot;
  }

  _compareUserData(snapshot, current) {
    /** Compare snapshot to current user data and return change details. */
    if (!snapshot) {
      return { hasChanged: Object.keys(current).length > 0, details: ['No snapshot'] };
    }
    
    const details = [];
    let hasChanged = false;
    
    // Check for new users
    for (const slot in current) {
      if (!(slot in snapshot)) {
        hasChanged = true;
        details.push(`Slot ${slot}: new user added`);
      }
    }
    
    // Check for changed users
    for (const slot in current) {
      const newUser = current[slot];
      const oldUser = snapshot[slot];
      
      if (!oldUser) {
        continue; // Already handled as new user
      }
      
      const changes = [];
      if (newUser.lock_status !== oldUser.lock_status) {
        changes.push(`lock_status: ${oldUser.lock_status} -> ${newUser.lock_status}`);
      }
      if (newUser.lock_code !== oldUser.lock_code) {
        changes.push(`lock_code changed`);
      }
      if (newUser.lock_status_from_lock !== oldUser.lock_status_from_lock) {
        changes.push(`lock_status_from_lock: ${oldUser.lock_status_from_lock} -> ${newUser.lock_status_from_lock}`);
      }
      if (newUser.name !== oldUser.name) {
        changes.push(`name: ${oldUser.name} -> ${newUser.name}`);
      }
      if (newUser.code !== oldUser.code) {
        changes.push(`code changed`);
      }
      
      if (changes.length > 0) {
        hasChanged = true;
        details.push(`Slot ${slot}: ${changes.join(', ')}`);
      }
    }
    
    return { hasChanged, details };
  }

  _getUserDataHash(users) {
    /** Get a simple hash of user data for quick comparison. */
    const keys = Object.keys(users).sort();
    const hash = keys.map(slot => {
      const user = users[slot];
      return `${slot}:${user.lock_status}:${user.lock_code}:${user.lock_status_from_lock}:${user.name}:${user.code}`;
    }).join('|');
    return hash;
  }

  renderNotificationServiceChips(slot, user) {
    // Get selected services (support both old and new format)
    let selectedServices = [];
    if (user.notification_services) {
      selectedServices = Array.isArray(user.notification_services) ? user.notification_services : [user.notification_services];
    } else if (user.notification_service) {
      // Backward compatibility
      selectedServices = [user.notification_service];
    } else {
      selectedServices = ['notify.persistent_notification'];
    }
    
    // Get available services (use cached or default)
    const availableServices = this._availableNotificationServices || [
      { id: 'notify.persistent_notification', name: 'UI', type: 'ui' },
      { id: 'notify.mobile_app', name: 'All Mobiles', type: 'all' }
    ];
    
    // Always show UI and All Mobiles first, then individual devices
    const alwaysShow = availableServices.filter(s => s.type === 'ui' || s.type === 'all');
    const devices = availableServices.filter(s => s.type === 'device');
    
    const allServices = [...alwaysShow, ...devices];
    
    return allServices.map(service => {
      const isSelected = selectedServices.includes(service.id);
      return `
        <span 
          class="notification-chip ${isSelected ? 'selected' : ''}"
          onclick="card.toggleNotificationService(${slot}, '${service.id}').catch(err => console.error('Error toggling service:', err))"
          title="${service.id}"
        >
          <span class="notification-chip-icon">${isSelected ? '✓' : '○'}</span>
          ${service.name}
        </span>
      `;
    }).join('');
  }

  formatLastUsed(lastUsed) {
    /** Format last_used timestamp as YYYY-MM-DD HH:MM (24-hour clock) or "Never" if not used. */
    if (!lastUsed) return 'Never';
    try {
      const dt = new Date(lastUsed);
      if (isNaN(dt.getTime())) return 'Never';
      const year = dt.getFullYear();
      const month = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      const hours = String(dt.getHours()).padStart(2, '0');
      const minutes = String(dt.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch (e) {
      return 'Never';
    }
  }

  _logUserData(users, label = 'User Data') {
    /** Log user data in readable format (debug mode only). */
    if (!this._debugMode) return;
    
    console.log(`[Yale Lock Manager] [REFRESH DEBUG] ${label}:`, Object.keys(users).length, 'users');
    for (const slot in users) {
      const user = users[slot];
      console.log(`[Yale Lock Manager] [REFRESH DEBUG]   Slot ${slot}:`, {
        name: user.name,
        lock_status: user.lock_status,
        lock_code: user.lock_code ? '***' : 'None',
        lock_status_from_lock: user.lock_status_from_lock
      });
    }
  }

  _addDebugLog(operation, slot, details = {}) {
    /** Add an entry to the debug log. */
    const timestamp = new Date().toLocaleTimeString();
    const entry = {
      timestamp,
      operation,
      slot: slot || null,
      details: { ...details }
    };
    
    // Get current cached values for this slot
    // In debug mode, show actual codes (not masked)
    if (slot) {
      const cached = this._formValues[slot] || {};
      const entity = this.getUserData().find(u => u.slot === slot);
      entry.cached = {
        name: cached.name || '',
        code: cached.code || '', // Show actual code in debug
        type: cached.type || '',
        cachedStatus: cached.cachedStatus,
        schedule: cached.schedule,
        usageLimit: cached.usageLimit
      };
      entry.entity = entity ? {
        name: entity.name || '',
        code: entity.code || '', // Show actual code in debug
        lock_code: entity.lock_code || '', // Show actual code in debug
        lock_status: entity.lock_status,
        lock_status_from_lock: entity.lock_status_from_lock,
        synced_to_lock: entity.synced_to_lock
      } : null;
    }
    
    this._debugLog.push(entry);
    
    // Keep only last 100 entries
    if (this._debugLog.length > 100) {
      this._debugLog.shift();
    }
    
    // Update debug panel if visible
    if (this._showDebugPanel) {
      this._updateDebugPanel();
    }
    
    // Also log to console (with actual codes for debugging)
    console.log(`[Yale Lock Manager] [DEBUG] ${timestamp} - ${operation}${slot ? ` (Slot ${slot})` : ''}`, {
      ...details,
      cached: entry.cached,
      entity: entry.entity
    });
  }

  _updateDebugPanel() {
    /** Update the debug panel content. */
    const panel = this.shadowRoot?.querySelector('#debug-panel-content');
    if (!panel) return;
    
    const logHtml = this._debugLog.slice(-50).reverse().map(entry => {
      const cachedHtml = entry.cached ? `
        <div style="margin-top: 4px; padding-left: 12px; font-size: 0.85em;">
          <strong>Cached:</strong> name="${entry.cached.name}", code="${entry.cached.code}", status=${entry.cached.cachedStatus}, type=${entry.cached.type}
        </div>
      ` : '';
      
      const entityHtml = entry.entity ? `
        <div style="margin-top: 4px; padding-left: 12px; font-size: 0.85em;">
          <strong>Entity:</strong> name="${entry.entity.name}", code="${entry.entity.code}", lock_code="${entry.entity.lock_code}", lock_status=${entry.entity.lock_status}, synced=${entry.entity.synced_to_lock}
        </div>
      ` : '';
      
      const detailsHtml = Object.keys(entry.details).length > 0 ? `
        <div style="margin-top: 4px; padding-left: 12px; font-size: 0.85em; color: var(--secondary-text-color);">
          ${JSON.stringify(entry.details)}
        </div>
      ` : '';
      
      return `
        <div style="padding: 8px; border-bottom: 1px solid var(--divider-color);">
          <div style="font-weight: 500; color: var(--primary-color);">
            [${entry.timestamp}] ${entry.operation}${entry.slot ? ` - Slot ${entry.slot}` : ''}
          </div>
          ${cachedHtml}
          ${entityHtml}
          ${detailsHtml}
        </div>
      `;
    }).join('');
    
    panel.innerHTML = logHtml || '<div style="padding: 16px; text-align: center; color: var(--secondary-text-color);">No debug entries yet</div>';
  }

  toggleDebugPanel() {
    /** Toggle debug panel visibility. */
    this._showDebugPanel = !this._showDebugPanel;
    this.render();
    if (this._showDebugPanel) {
      this._updateDebugPanel();
    }
  }

  getUserData() {
    const stateObj = this._hass?.states[this._config?.entity];
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
        usage_count: 0,
        notifications_enabled: false
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
      
        .notification-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          align-items: center;
        }
        
        .notification-chip {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 0.75em;
          cursor: pointer;
          user-select: none;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          transition: all 0.2s;
        }
        
        .notification-chip.selected {
          background: var(--primary-color);
          color: var(--text-primary-color, white);
          border-color: var(--primary-color);
        }
        
        .notification-chip:hover {
          opacity: 0.8;
        }
        
        .notification-chip-icon {
          margin-right: 4px;
          font-size: 0.9em;
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
      
      // Get form values (or use entity state as fallback)
      const formName = this._getFormValue(user.slot, 'name', user.name || '');
      const formCode = this._getFormValue(user.slot, 'code', user.code || '');
      const formType = this._getFormValue(user.slot, 'type', user.code_type || 'pin');
      const formCachedStatus = this._getFormValue(user.slot, 'cachedStatus', 
        user.lock_status !== null && user.lock_status !== undefined 
          ? user.lock_status 
          : (user.enabled ? 1 : 2));
      
      // Check if there's a cached PIN
      const hasCachedPin = formCode && formCode.trim() !== '';
      const lockStatus = user.lock_status_from_lock ?? user.lock_status;
      const isLockAvailable = (lockStatus === 0 || lockStatus === null || lockStatus === undefined);
      
      const getStatusText = (status, lockEnabled, enabled, hasCachedPin, isLockAvailable) => {
        // If no cached PIN and lock is available, show "Available"
        if (!hasCachedPin && isLockAvailable) {
          return 'Available';
        }
        
        if (status !== null && status !== undefined) {
          if (status === 0) return 'Available';
          if (status === 1) return 'Enabled';
          if (status === 2) return 'Disabled';
        }
        if (lockEnabled !== null && lockEnabled !== undefined) {
          return lockEnabled ? 'Enabled' : 'Disabled';
        }
        if (enabled !== null && enabled !== undefined) {
          return enabled ? 'Enabled' : 'Disabled';
        }
        return 'Unknown';
      };
      
      const getStatusColor = (status, lockEnabled, enabled, hasCachedPin, isLockAvailable) => {
        // If no cached PIN and lock is available, use gray for "Available"
        if (!hasCachedPin && isLockAvailable) {
          return '#9e9e9e';
        }
        
        if (status !== null && status !== undefined) {
          if (status === 0) return '#9e9e9e';
          if (status === 1) return '#4caf50';
          if (status === 2) return '#f44336';
        }
        if (lockEnabled !== null && lockEnabled !== undefined || enabled !== null && enabled !== undefined) {
          const isEnabled = lockEnabled !== null && lockEnabled !== undefined ? lockEnabled : enabled;
          return isEnabled ? '#4caf50' : '#f44336';
        }
        return '#9e9e9e';
      };
      
      const statusText = getStatusText(user.lock_status, user.lock_enabled, user.enabled, hasCachedPin, isLockAvailable);
      const statusColor = getStatusColor(user.lock_status, user.lock_enabled, user.enabled, hasCachedPin, isLockAvailable);
      
      // Determine status dropdown options
      const hasLockPin = user.lock_code && user.lock_code.trim() !== '' && user.lock_code.trim() !== 'No PIN on lock';
      // hasCachedPin already declared above
      const hasName = formName && formName.trim() !== '' && formName.trim() !== `User ${user.slot}`;
      const hasData = hasLockPin || hasCachedPin || hasName;
      const scheduleHasWindow = user.schedule && (user.schedule.start || user.schedule.end);
      const outsideWindow = scheduleHasWindow && user.schedule_valid_now === false;
      // Use _formValues for notification chips so re-render after chip click shows updated selection (entity state lags)
      const chipUser = {
        ...user,
        notification_services: (this._formValues[user.slot]?.notificationServices != null)
          ? (Array.isArray(this._formValues[user.slot].notificationServices)
            ? this._formValues[user.slot].notificationServices
            : [this._formValues[user.slot].notificationServices])
          : (user.notification_services ?? (user.notification_service ? [user.notification_service] : ['notify.persistent_notification']))
      };
              
              return `
        <tr class="clickable" onclick="card.toggleExpand(${user.slot})">
          <td><strong>${user.slot}</strong></td>
          <td>${user.name || `User ${user.slot}`}</td>
          <td>${isFob ? '🏷️' : '🔑'}</td>
          <td>
            <span id="status-badge-${user.slot}" style="
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
          <td>${this.formatLastUsed(user.last_used)}</td>
                </tr>
                ${isExpanded ? `
                  <tr class="expanded-row">
                    <td colspan="6">
              <div class="expanded-content">
                <h3>Slot ${user.slot} Settings</h3>
                
                <div id="status-${user.slot}"></div>
                
                <!-- Validation error message -->
                <div id="validation-error-${user.slot}" style="display: none;"></div>
                
                <!-- Unsaved changes warning -->
                <div id="unsaved-warning-${user.slot}" style="display: none;"></div>
                        
                        <div class="form-group">
                          <label>User Name:</label>
                  <input 
                    type="text" 
                    id="name-${user.slot}" 
                    value="${formName}" 
                    placeholder="Enter name"
                    oninput="card.setFormValue(${user.slot}, 'name', this.value); card.updateStatusOptions(${user.slot}); card._checkForUnsavedChanges(${user.slot}); card._validateSlot(${user.slot})"
                  >
                        </div>
                        
                          <div class="form-group">
                            <label>Code Type:</label>
                  <select 
                    id="type-${user.slot}" 
                    onchange="card.changeType(${user.slot}, this.value); card.setFormValue(${user.slot}, 'type', this.value)"
                  >
                    <option value="pin" ${formType === 'pin' ? 'selected' : ''}>PIN Code</option>
                    <option value="fob" ${formType === 'fob' ? 'selected' : ''}>FOB/RFID Card</option>
                  </select>
                          </div>
                        
                ${!isFob ? `
                        <div id="status-section-${user.slot}" class="form-group">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                      <div>
                        <label>📝 Cached Status (editable):</label>
                        <select 
                          id="cached-status-${user.slot}" 
                          onchange="card.changeStatus(${user.slot}, this.value); card._checkForUnsavedChanges(${user.slot}); card._validateSlot(${user.slot})" 
                          style="width: 100%;"
                          ${outsideWindow && formCachedStatus === 1 ? 'disabled' : ''}
                        >
                          ${outsideWindow ? `
                          <option value="2" selected>Disabled</option>
                          ` : `
                          <option value="1" ${formCachedStatus === 1 ? 'selected' : ''}>Enabled</option>
                          <option value="2" ${formCachedStatus === 2 ? 'selected' : ''}>Disabled</option>
                          `}
                          </select>
                        ${outsideWindow && formCachedStatus === 1 ? `
                        <p style="color: var(--secondary-text-color); font-size: 0.75em; margin: 4px 0 0 0;">Stored status is Enabled; scheduler will apply when schedule is active. Only Disabled can be set outside the schedule window.</p>
                        ` : `
                        <p style="color: var(--secondary-text-color); font-size: 0.75em; margin: 4px 0 0 0;">Status stored locally (Enabled = code on lock, Disabled = code cleared)</p>
                        `}
                        </div>
                      <div>
                        <label>🔒 Lock Status (from lock):</label>
                        <select 
                          id="lock-status-${user.slot}" 
                          disabled 
                          style="width: 100%; background: var(--card-background-color); border: 1px solid var(--divider-color); color: var(--secondary-text-color);"
                        >
                          <option value="0" ${(user.lock_status_from_lock ?? user.lock_status) === 0 ? 'selected' : ''}>Available</option>
                          <option value="1" ${(user.lock_status_from_lock ?? user.lock_status) === 1 ? 'selected' : ''}>Enabled</option>
                          <option value="2" ${(user.lock_status_from_lock ?? user.lock_status) === 2 ? 'selected' : ''}>Disabled</option>
                        </select>
                        <p style="color: var(--secondary-text-color); font-size: 0.75em; margin: 4px 0 0 0;">Status from physical lock (read-only)</p>
                      </div>
                    </div>
                    ${(() => {
                      const lockStatus = user.lock_status_from_lock ?? user.lock_status;
                      const hasCachedPin = formCode && formCode.trim() !== '';
                      const isLockAvailable = (lockStatus === 0 || lockStatus === null || lockStatus === undefined);
                      
                      // If no cached PIN and lock is available, don't show sync indicator (blank)
                      if (!hasCachedPin && isLockAvailable) {
                        return '';
                      }
                      
                      // Status comparison logic:
                      // - Cached=Enabled (1) + Lock=Enabled (1) = Synced ✅
                      // - Cached=Disabled (2) + Lock=Available (0) = Synced ✅ (expected when disabled)
                      // - Cached=Enabled (1) + Lock=Available (0) = Not synced ⚠️ (needs push)
                      // - Cached=Disabled (2) + Lock=Enabled (1) = Not synced ⚠️ (needs clear)
                      if (lockStatus !== null && lockStatus !== undefined) {
                        if (formCachedStatus === 1 && lockStatus === 1) {
                          // Enabled + Enabled = Synced
                          return `
                            <div style="margin-top: 8px; padding: 8px; background: #4caf5015; border-left: 4px solid #4caf50; border-radius: 4px;">
                              <span style="color: #4caf50; font-size: 0.85em;">✅ Status synced - Enabled on lock</span>
                            </div>
                          `;
                        } else if (formCachedStatus === 2 && lockStatus === 0) {
                          // Disabled + Available = Synced (expected when disabled)
                          return `
                            <div style="margin-top: 8px; padding: 8px; background: #4caf5015; border-left: 4px solid #4caf50; border-radius: 4px;">
                              <span style="color: #4caf50; font-size: 0.85em;">✅ Status synced - Code cleared from lock</span>
                            </div>
                          `;
                        } else if (formCachedStatus === 1 && lockStatus === 0) {
                          // Enabled + Available = Not synced (needs push)
                          return `
                            <div style="margin-top: 8px; padding: 8px; background: #ff980015; border-left: 4px solid #ff9800; border-radius: 4px;">
                              <span style="color: #ff9800; font-size: 0.85em;">⚠️ Status not synced - Click "Push" to set code on lock</span>
                            </div>
                          `;
                        } else if (formCachedStatus === 2 && lockStatus === 1) {
                          // Disabled + Enabled = Not synced (needs clear)
                          return `
                            <div style="margin-top: 8px; padding: 8px; background: #ff980015; border-left: 4px solid #ff9800; border-radius: 4px;">
                              <span style="color: #ff9800; font-size: 0.85em;">⚠️ Status not synced - Click "Push" to clear code from lock</span>
                            </div>
                          `;
                        } else if (formCachedStatus !== lockStatus) {
                          // Other mismatches
                          return `
                            <div style="margin-top: 8px; padding: 8px; background: #ff980015; border-left: 4px solid #ff9800; border-radius: 4px;">
                              <span style="color: #ff9800; font-size: 0.85em;">⚠️ Status doesn't match - Click "Push" to sync</span>
                            </div>
                          `;
                        }
                      }
                      return '';
                    })()}
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
                          value="${formCode}" 
                          placeholder="Enter PIN code (4-8 digits)" 
                          maxlength="8" 
                          pattern="[0-9]*" 
                          style="width: 100%;"
                          oninput="card.setFormValue(${user.slot}, 'code', this.value); card._checkForUnsavedChanges(${user.slot}); card._validateSlot(${user.slot})"
                        >
                        <p style="color: var(--secondary-text-color); font-size: 0.75em; margin: 4px 0 0 0;">PIN stored locally</p>
                      </div>
                      <div>
                        <label>🔒 Lock PIN (from lock):</label>
                        <input 
                          type="text" 
                          id="lock-code-${user.slot}" 
                          value="${user.lock_code || ''}" 
                          placeholder="No PIN on lock" 
                          maxlength="10" 
                          pattern="[0-9]*" 
                          readonly 
                          style="width: 100%; background: var(--card-background-color); border: 1px solid var(--divider-color); color: var(--secondary-text-color);"
                        >
                        <p style="color: var(--secondary-text-color); font-size: 0.75em; margin: 4px 0 0 0;">PIN from physical lock</p>
                      </div>
                    </div>
                    ${formCode && user.lock_code && formCode !== user.lock_code ? `
                      <div style="margin-top: 8px; padding: 8px; background: #ff980015; border-left: 4px solid #ff9800; border-radius: 4px;">
                        <span style="color: #ff9800; font-size: 0.85em;">⚠️ PINs don't match - Click "Push" to sync</span>
                      </div>
                    ` : formCode && user.lock_code && formCode === user.lock_code ? `
                      <div style="margin-top: 8px; padding: 8px; background: #4caf5015; border-left: 4px solid #4caf50; border-radius: 4px;">
                        <span style="color: #4caf50; font-size: 0.85em;">✅ PINs match - Synced</span>
                      </div>
                        ` : ''}
                  </div>
                </div>
                        
                <div id="fob-notice-${user.slot}" class="fob-notice ${!isFob ? 'hidden' : ''}">
                  🏷️ FOB/RFID cards don't require a PIN. The card ID is read automatically when presented to the lock.
                </div>
                          
                <hr>
                          
                ${!isFob ? `
                          <div id="schedule-section-${user.slot}" class="form-group">
                  <label class="toggle-label">
                    <label class="toggle-switch">
                      <input 
                        type="checkbox" 
                        id="schedule-toggle-${user.slot}" 
                        onchange="card.toggleSchedule(${user.slot}, this.checked)" 
                        ${user.schedule?.start || user.schedule?.end ? 'checked' : ''}
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
                          value="${user.schedule?.start ? user.schedule.start.substring(0, 16) : ''}"
                          onchange="card._checkForUnsavedChanges(${user.slot})"
                        >
                              </div>
                      <div style="flex: 1; min-width: 200px;">
                        <label style="font-size: 0.85em;">End:</label>
                        <input 
                          type="datetime-local" 
                          id="end-${user.slot}" 
                          value="${user.schedule?.end ? user.schedule.end.substring(0, 16) : ''}"
                          onchange="card._checkForUnsavedChanges(${user.slot})"
                        >
                              </div>
                            </div>
                  </div>
                          </div>
                ` : ''}
                          
                ${!isFob ? `
                          <div id="limit-section-${user.slot}" class="form-group">
                    <label class="toggle-label">
                      <label class="toggle-switch">
                        <input 
                          type="checkbox" 
                          id="limit-toggle-${user.slot}" 
                          onchange="card.toggleLimit(${user.slot}, this.checked)" 
                          ${user.usage_limit ? 'checked' : ''}
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
                          <input type="number" value="${user.usage_count || 0}" readonly style="background: var(--disabled-color, #f0f0f0);">
                              </div>
                              <div style="flex: 1;">
                          <label style="font-size: 0.85em;">Max:</label>
                          <input 
                            type="number" 
                            id="limit-${user.slot}" 
                            value="${user.usage_limit || ''}" 
                            placeholder="e.g., 5" 
                            min="1"
                            oninput="card._checkForUnsavedChanges(${user.slot})"
                          >
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
                ` : ''}
                
                <div class="form-group">
                  <label>Notifications:</label>
                  <label class="toggle-switch">
                    <input 
                      type="checkbox" 
                      id="notification-toggle-${user.slot}" 
                      onchange="card.toggleNotification(${user.slot}, this.checked).catch(err => console.error('Error toggling notification:', err))" 
                      ${user.notifications_enabled ? 'checked' : ''}
                    >
                    <span class="slider"></span>
                  </label>
                </div>
                
                <div class="form-group">
                  <label>Notification Service:</label>
                  <div class="notification-chips" id="notification-services-${user.slot}">
                    ${this.renderNotificationServiceChips(user.slot, chipUser)}
                  </div>
                </div>
                          
                <hr>
                <div class="button-group">
                  <button id="save-button-${user.slot}" onclick="card.saveUser(${user.slot})">
                    ${user.name ? 'Update User' : 'Save User'}
                  </button>
                  ${user.name ? `
                    <button class="secondary" onclick="card.clearSlot(${user.slot})">Clear Slot</button>
                  ` : ''}
                </div>
                ${!isFob ? `
                  <div class="button-group" style="margin-top: 12px;">
                    <button 
                      id="push-button-${user.slot}"
                      onclick="card.pushCode(${user.slot})"
                      style="${!user.synced_to_lock && !outsideWindow ? 'background: #ff9800; color: white; font-weight: bold;' : ''}"
                      disabled
                      ${outsideWindow ? 'title="Push is handled by the scheduler when the schedule is active."' : ''}
                    >${user.synced_to_lock ? 'Push' : 'Push Required'}</button>
                          </div>
                        ` : ''}
                      </div>
                    </td>
                  </tr>
                ` : ''}
              `;
    }).join('');

    const cardStateObj = this._hass?.states?.[this._config?.entity];
    const currentTimeIso = cardStateObj?.attributes?.current_time_iso;
    const haTime = currentTimeIso ? new Date(currentTimeIso).toISOString().slice(0, 16).replace('T', ' ') : '—';

    return `
      <ha-card>
        <div class="header">
          <div class="lock-status">
            <div class="status-icon">${isLocked ? '🔒' : '🔓'}</div>
            <div class="status-info">
              <div class="status-line">HA time: ${haTime}</div>
              <div class="status-line">🔋 ${batteryLevel}% Battery • Bolt: ${boltStatus} • Door: ${doorStatus}</div>
            </div>
          </div>
          <div class="controls">
            <button onclick="card.toggleLock()">${isLocked ? 'Unlock' : 'Lock'}</button>
            <button class="secondary" onclick="card.refresh()">Refresh</button>
            <button class="secondary" onclick="card.showExportConfirm()">Export</button>
          </div>
        </div>
        
        <!-- Global status container for refresh progress -->
        <div id="status-0" style="margin: 8px 0;"></div>
        
        <!-- Refresh progress bar -->
        <div id="refresh-progress" style="display: none;"></div>
        
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span class="user-count">👥 ${enabledUsers} / ${totalUsers} active users</span>
        </div>

        <table>
          <thead>
            <tr>
              <th>Slot</th>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th>Synced</th>
              <th>Last Used</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        
        <hr style="margin: 24px 0 16px 0;">
        <div style="text-align: center; margin-bottom: 12px;">
          ${this._showExportConfirm ? `
            <div style="background: var(--warning-color-background, rgba(255, 152, 0, 0.1)); border: 1px solid var(--warning-color, #ff9800); border-radius: 4px; padding: 12px; margin-bottom: 12px;">
              <p style="margin: 0 0 12px 0; color: var(--warning-color, #ff9800); font-weight: 500;">The backup file contains sensitive data (PINs and codes). Store it securely. Download anyway?</p>
              <div style="display: flex; gap: 8px; justify-content: center;">
                <button onclick="card.confirmExportDownload()">Download</button>
                <button class="secondary" onclick="card.cancelExportConfirm()">Cancel</button>
              </div>
            </div>
          ` : ''}
          ${this._showImportConfirm ? `
            <div style="background: var(--warning-color-background, rgba(255, 152, 0, 0.1)); border: 1px solid var(--warning-color, #ff9800); border-radius: 4px; padding: 12px; margin-bottom: 12px;">
              <p style="margin: 0 0 12px 0; color: var(--warning-color, #ff9800); font-weight: 500;">Import replaces all stored user/slot data (names, codes, schedules, notifications) with the backup. Current data will be lost. The lock is not updated until you Push. Continue to choose a file?</p>
              <div style="display: flex; gap: 8px; justify-content: center;">
                <button onclick="card.confirmImportChooseFile()">Choose backup file</button>
                <button class="secondary" onclick="card.cancelImportConfirm()">Cancel</button>
              </div>
            </div>
          ` : ''}
          <button class="secondary" onclick="card.showExportConfirm()">Export backup</button>
          <button class="secondary" onclick="card.showImportConfirm()">Import backup</button>
        </div>
        <input type="file" id="import-file-input" accept=".json" style="display: none;">
        <div id="clear-cache-section" style="text-align: center; padding: 16px 0;">
          ${this._showClearCacheConfirm ? `
            <div style="background: var(--warning-color-background, rgba(255, 152, 0, 0.1)); border: 1px solid var(--warning-color, #ff9800); border-radius: 4px; padding: 12px; margin-bottom: 12px;">
              <p style="margin: 0 0 12px 0; color: var(--warning-color, #ff9800); font-weight: 500;">⚠️ Are you sure you want to clear all local cache?</p>
              <div style="display: flex; gap: 8px; justify-content: center;">
                <button onclick="card.confirmClearCache()" style="background: var(--error-color, #f44336); color: white;">Yes, Clear Cache</button>
                <button class="secondary" onclick="card.cancelClearCache()">Cancel</button>
              </div>
            </div>
          ` : ''}
          <button class="secondary" onclick="card.showClearCacheConfirm()" style="background: var(--error-color-background, rgba(244, 67, 54, 0.1)); color: var(--error-color, #f44336); border: 1px solid var(--error-color, #f44336);">
            🗑️ Clear Local Cache
          </button>
          <p style="color: var(--secondary-text-color); font-size: 0.85em; margin-top: 8px;">
            This will remove all locally stored user data. Use "Refresh from lock" to reload from the physical lock.
          </p>
        </div>
        
        <hr style="margin: 24px 0 16px 0;">
        <div style="text-align: center;">
          <button class="secondary" onclick="card.toggleDebugPanel()" style="background: var(--info-color-background, rgba(33, 150, 243, 0.1)); color: var(--info-color, #2196f3); border: 1px solid var(--info-color, #2196f3);">
            ${this._showDebugPanel ? '🔽 Hide' : '▶️ Show'} Debug Panel
          </button>
        </div>
        
        ${this._showDebugPanel ? `
          <div id="debug-panel" style="margin-top: 16px; border: 1px solid var(--divider-color); border-radius: 4px; background: var(--card-background-color);">
            <div style="padding: 12px; background: var(--primary-color); color: white; border-radius: 4px 4px 0 0; font-weight: 500;">
              🐛 Debug Log - PIN Code Change Flow
            </div>
            <div id="debug-panel-content" style="max-height: 400px; overflow-y: auto; padding: 8px;">
              <!-- Debug log entries will be inserted here -->
            </div>
            <div style="padding: 8px; background: var(--table-row-alternative-background-color); border-top: 1px solid var(--divider-color); text-align: center;">
              <button class="secondary" onclick="card._debugLog = []; card._updateDebugPanel();" style="font-size: 0.85em;">
                Clear Log
              </button>
            </div>
          </div>
        ` : ''}
      </ha-card>
    `;
  }

  // ========== EVENT HANDLING ==========

  attachEventListeners() {
    window.card = this;
    
    // Update status dropdown when name/PIN changes and check for unsaved changes
    if (this._expandedSlot) {
      const slot = this._expandedSlot;
      const nameField = this.shadowRoot.getElementById(`name-${slot}`);
      const codeField = this.shadowRoot.getElementById(`code-${slot}`);
      const statusField = this.shadowRoot.getElementById(`cached-status-${slot}`);
      
      if (nameField) {
        nameField.addEventListener('input', () => {
          this.updateStatusOptions(slot);
          this.setFormValue(slot, 'name', nameField.value);
          this._checkForUnsavedChanges(slot);
        });
      }
      if (codeField) {
        codeField.addEventListener('input', () => {
          const oldCode = this._formValues[slot]?.code || '';
          this.updateStatusOptions(slot);
          this.setFormValue(slot, 'code', codeField.value);
          this._checkForUnsavedChanges(slot);
          
          // Log PIN change
          if (codeField.value !== oldCode) {
          this._addDebugLog('Cached PIN Changed', slot, {
            old_code: oldCode || '',
            new_code: codeField.value || ''
          });
          }
        });
      }
      if (statusField) {
        statusField.addEventListener('change', () => {
          this.setFormValue(slot, 'cachedStatus', parseInt(statusField.value, 10));
          this._checkForUnsavedChanges(slot);
        });
      }
    }
  }
  
  _checkForUnsavedChanges(slot) {
    const user = this.getUserData().find(u => u.slot === slot);
    if (!user) return;
    
    const nameField = this.shadowRoot.getElementById(`name-${slot}`);
    const codeField = this.shadowRoot.getElementById(`code-${slot}`);
    const statusField = this.shadowRoot.getElementById(`cached-status-${slot}`);
    const startField = this.shadowRoot.getElementById(`start-${slot}`);
    const endField = this.shadowRoot.getElementById(`end-${slot}`);
    const limitField = this.shadowRoot.getElementById(`limit-${slot}`);
    const scheduleToggle = this.shadowRoot.getElementById(`schedule-toggle-${slot}`);
    const limitToggle = this.shadowRoot.getElementById(`limit-toggle-${slot}`);
    const notificationToggle = this.shadowRoot.getElementById(`notification-toggle-${slot}`);
    
    if (!nameField || !statusField) return;
    
    const currentName = nameField.value.trim() || '';
    const currentCode = codeField ? codeField.value.trim() || '' : '';
    const currentStatus = parseInt(statusField.value || '0', 10);
    const currentStart = startField ? startField.value : '';
    const currentEnd = endField ? endField.value : '';
    const currentLimit = limitField ? parseInt(limitField.value || '0', 10) : 0;
    const scheduleEnabled = scheduleToggle ? scheduleToggle.checked : false;
    const limitEnabled = limitToggle ? limitToggle.checked : false;
    const notificationsEnabled = notificationToggle ? notificationToggle.checked : false;
    
    // Get current selected services from form values
    const currentServices = this._formValues[slot]?.notificationServices || [];
    const currentServicesArray = Array.isArray(currentServices) ? currentServices : (currentServices ? [currentServices] : []);
    
    const savedName = user.name || '';
    const savedCode = user.code || '';
    const savedStatus = user.lock_status !== null && user.lock_status !== undefined 
      ? user.lock_status 
      : (user.enabled ? 1 : 2);
    const savedStart = user.schedule?.start ? user.schedule.start.substring(0, 16) : '';
    const savedEnd = user.schedule?.end ? user.schedule.end.substring(0, 16) : '';
    const savedLimit = user.usage_limit || 0;
    const savedScheduleEnabled = !!(user.schedule?.start || user.schedule?.end);
    // Note: Notification settings (toggle and services) are now saved instantly,
    // so we don't check for notification changes here
    
    // Check if PIN or status changed (these affect Push button)
    const pinChanged = (currentCode !== savedCode);
    const statusChanged = (currentStatus !== savedStatus);
    const nameChanged = (currentName !== savedName);
    const scheduleChanged = (currentStart !== savedStart) || (currentEnd !== savedEnd) || (scheduleEnabled !== savedScheduleEnabled);
    const limitChanged = (currentLimit !== savedLimit) || (limitEnabled !== !!savedLimit);
    const hasChanges = nameChanged || pinChanged || statusChanged || scheduleChanged || limitChanged;
    
    // Track lock-affecting changes (PIN or status) separately from non-lock changes (username, schedule, usage_limit)
    const lockAffectingChanged = pinChanged || statusChanged;
    
    const warningDiv = this.shadowRoot.querySelector(`#unsaved-warning-${slot}`);
    const saveButton = this.shadowRoot.getElementById(`save-button-${slot}`);
    const pushButton = this.shadowRoot.getElementById(`push-button-${slot}`);
    
    if (hasChanges) {
      this._unsavedChanges[slot] = true;
      
      // Track lock-affecting changes (PIN or status)
      if (lockAffectingChanged) {
        this._lockAffectingChanges[slot] = true;
        // If PIN or status changed, mark slot as unsaved (disables Push, enables Save)
        delete this._savedSlots[slot];
      } else {
        // Only non-lock changes (username, schedule, usage_limit) - don't affect Push button
        this._lockAffectingChanges[slot] = false;
      }
      
      // Show warning message
      if (warningDiv) {
        warningDiv.style.display = 'block';
        warningDiv.innerHTML = `
          <div style="padding: 8px; background: #ff980015; border-left: 4px solid #ff9800; border-radius: 4px; margin-bottom: 8px;">
            <span style="color: #ff9800; font-size: 0.85em;">⚠️ You have unsaved changes. Click "Update User" to save them.</span>
          </div>
        `;
      }
      
      // Enable Save button if validation passes
      if (saveButton && !saveButton.disabled) {
        // Button will be enabled/disabled by _validateSlot
      }
      
      // Disable Push button if PIN or status changed
      if (pushButton && (pinChanged || statusChanged)) {
        pushButton.disabled = true;
        pushButton.style.opacity = '0.5';
        pushButton.style.cursor = 'not-allowed';
      }
    } else {
      delete this._unsavedChanges[slot];
      if (warningDiv) {
        warningDiv.style.display = 'none';
      }
    }
    
    // Validate slot and update button states based on saved status
    this._validateSlot(slot);
    this._updateButtonStates(slot);
  }
  
  _updateButtonStates(slot) {
    /**Update Save and Push button states based on saved status and validation.
     * 
     * Rules:
     * - Save button: Enabled if validation passes AND there are unsaved changes
     * - Push button: Enabled only if slot has been saved (no unsaved changes) AND lock-affecting changes (PIN/status) were made AND not outside schedule window
     */
    const saveButton = this.shadowRoot.getElementById(`save-button-${slot}`);
    const pushButton = this.shadowRoot.getElementById(`push-button-${slot}`);
    const hasUnsavedChanges = this._unsavedChanges[slot];
    const isSaved = this._savedSlots[slot];
    const hasLockAffectingChanges = this._lockAffectingChanges[slot] === true;
    const user = this.getUserData().find(u => u.slot === slot);
    const scheduleHasWindow = user && user.schedule && (user.schedule.start || user.schedule.end);
    const outsideWindow = scheduleHasWindow && user.schedule_valid_now === false;
    
    // Save button: enabled if validation passes (handled by _validateSlot) AND has unsaved changes
    // We don't disable it here - _validateSlot handles that
    
    // Push button: enabled only if slot is saved (no unsaved changes) AND lock-affecting changes were made AND not outside schedule window
    if (pushButton) {
      if (outsideWindow) {
        pushButton.disabled = true;
        pushButton.style.opacity = '0.5';
        pushButton.style.cursor = 'not-allowed';
        pushButton.title = 'Push is handled by the scheduler when the schedule is active.';
      } else if (isSaved && !hasUnsavedChanges && hasLockAffectingChanges) {
        pushButton.disabled = false;
        pushButton.style.opacity = '1';
        pushButton.style.cursor = 'pointer';
        pushButton.title = '';
      } else {
        pushButton.disabled = true;
        pushButton.style.opacity = '0.5';
        pushButton.style.cursor = 'not-allowed';
        pushButton.title = '';
      }
    }
  }

  _validateSlot(slot) {
    /**Validate slot data and enable/disable save button accordingly.
     * 
     * Rules:
     * - Username is always required
     * - If status is Enabled (1) and code type is PIN, PIN must be 4-8 characters
     * - If status is Enabled (1) and PIN is empty, show error and disable button
     * - If PIN is too short (< 4) or too long (> 8), show error and disable button
     * - If status is Enabled and usage_count >= usage_limit, show error and disable button
     */
    const nameField = this.shadowRoot.getElementById(`name-${slot}`);
    const codeField = this.shadowRoot.getElementById(`code-${slot}`);
    const statusField = this.shadowRoot.getElementById(`cached-status-${slot}`);
    const typeField = this.shadowRoot.getElementById(`type-${slot}`);
    const saveButton = this.shadowRoot.getElementById(`save-button-${slot}`);
    const errorDiv = this.shadowRoot.getElementById(`validation-error-${slot}`);
    
    if (!statusField || !typeField || !saveButton) return;
    
    const name = nameField ? nameField.value.trim() || '' : '';
    const codeType = typeField.value;
    const cachedStatus = parseInt(statusField.value || '0', 10);
    const code = codeField ? codeField.value.trim() || '' : '';
    const isEnabled = cachedStatus === 1;
    const isPin = codeType === 'pin';
    
    // Get current user data to check usage limit
    const user = this.getUserData().find(u => u.slot === slot);
    const usageCount = user ? (user.usage_count || 0) : 0;
    const usageLimit = user ? (user.usage_limit || null) : null;
    
    let errorMessage = '';
    let isValid = true;
    
    // Username is always required
    if (!name || name === `User ${slot}`) {
      errorMessage = '⚠️ Username is required';
      isValid = false;
    }
    
    // Only validate PINs (FOBs don't need PIN validation)
    if (isPin && isValid) {
      if (isEnabled && !code) {
        errorMessage = '⚠️ PIN is required when status is Enabled';
        isValid = false;
      } else if (code) {
        if (code.length < 4) {
          errorMessage = '⚠️ PIN must be at least 4 digits';
          isValid = false;
        } else if (code.length > 8) {
          errorMessage = '⚠️ PIN cannot be longer than 8 digits';
          isValid = false;
        }
      }
    }
    
    // Check usage limit: Cannot enable if usage_count >= usage_limit
    if (isPin && isValid && isEnabled && usageLimit !== null && usageCount >= usageLimit) {
      errorMessage = '⚠️ Cannot enable user: usage limit reached. Reset counter or increase limit.';
      isValid = false;
    }
    
    // Update error display
    if (errorDiv) {
      if (errorMessage) {
        errorDiv.style.display = 'block';
        errorDiv.innerHTML = `
          <div style="padding: 8px; background: #f4433615; border-left: 4px solid #f44336; border-radius: 4px; margin-bottom: 8px;">
            <span style="color: #f44336; font-size: 0.85em;">${errorMessage}</span>
          </div>
        `;
      } else {
        errorDiv.style.display = 'none';
        errorDiv.innerHTML = '';
      }
    }
    
    // Enable/disable save button based on validation AND unsaved changes
    if (saveButton) {
      const hasUnsavedChanges = this._unsavedChanges[slot];
      
      // Save button is enabled if:
      // - Validation passes AND
      // - Has unsaved changes (stays disabled after save until new changes detected)
      if (isValid && hasUnsavedChanges) {
        saveButton.disabled = false;
        saveButton.style.opacity = '1';
        saveButton.style.cursor = 'pointer';
      } else {
        saveButton.disabled = true;
        saveButton.style.opacity = '0.5';
        saveButton.style.cursor = 'not-allowed';
      }
    }
    
    // Update Push button state
    this._updateButtonStates(slot);
  }

  updateStatusOptions(slot) {
    const nameField = this.shadowRoot.getElementById(`name-${slot}`);
    const codeField = this.shadowRoot.getElementById(`code-${slot}`);
    const lockCodeField = this.shadowRoot.getElementById(`lock-code-${slot}`);
    const statusSelect = this.shadowRoot.getElementById(`cached-status-${slot}`);
    
    if (!statusSelect) return;
    
    const hasName = nameField && nameField.value.trim() !== '' && nameField.value.trim() !== `User ${slot}`;
    const hasCode = codeField && codeField.value.trim() !== '';
    const hasLockCode = lockCodeField && lockCodeField.value.trim() !== '' && lockCodeField.value.trim() !== 'No PIN on lock';
    const hasData = hasName || hasCode || hasLockCode;
    
    const currentValue = statusSelect.value;
    statusSelect.innerHTML = '';
    
    if (!hasData) {
      const option = document.createElement('option');
      option.value = '0';
      option.textContent = 'Available';
      option.selected = currentValue === '0';
      statusSelect.appendChild(option);
    } else {
      const enabledOption = document.createElement('option');
      enabledOption.value = '1';
      enabledOption.textContent = 'Enabled';
      enabledOption.selected = currentValue === '1';
      statusSelect.appendChild(enabledOption);
      
      const disabledOption = document.createElement('option');
      disabledOption.value = '2';
      disabledOption.textContent = 'Disabled';
      disabledOption.selected = currentValue === '2';
      statusSelect.appendChild(disabledOption);
      
      // Only change value if it was '0' (Available) - but don't trigger changeStatus if user doesn't exist
      if (currentValue === '0') {
        const user = this.getUserData().find(u => u.slot === slot);
        if (user) {
          // User exists - safe to change status (will trigger onchange which calls changeStatus)
          statusSelect.value = '1';
        } else {
          // User doesn't exist yet - temporarily remove onchange handler, change value, then restore
          // This prevents changeStatus from being called for non-existent users
          const originalOnchange = statusSelect.getAttribute('onchange');
          statusSelect.removeAttribute('onchange');
          this._setFormValue(slot, 'cachedStatus', 1);
          statusSelect.value = '1';
          // Restore onchange handler after a brief delay
          setTimeout(() => {
            if (originalOnchange) {
              statusSelect.setAttribute('onchange', originalOnchange);
            }
          }, 100);
        }
      }
    }
  }

  toggleExpand(slot) {
    const wasExpanded = this._expandedSlot === slot;
    this._expandedSlot = wasExpanded ? null : slot;
    
    if (wasExpanded) {
      this.clearStatus(slot);
    } else {
      // When slot is first expanded, sync form values from entity state (force=true to initialize)
      this._syncFormValuesFromEntity(slot, true);
      
      // Log slot expansion with cached details
      const cached = this._formValues[slot] || {};
      const entity = this.getUserData().find(u => u.slot === slot);
      this._addDebugLog('Slot Expanded', slot, {
        cached_name: cached.name || '',
        cached_code: cached.code || '',
        cached_status: cached.cachedStatus,
        entity_name: entity?.name || '',
        entity_code: entity?.code || '',
        entity_lock_code: entity?.lock_code || ''
      });
      
      // Validate slot after expansion to set initial button state
      setTimeout(() => {
        this._validateSlot(slot);
        this._updateButtonStates(slot);
      }, 100);
    }
    
    this.render();
    
    // After render, check for unsaved changes if slot is now expanded
    if (this._expandedSlot === slot) {
      setTimeout(() => {
        this._checkForUnsavedChanges(slot);
      }, 100);
    }
  }

  changeType(slot, newType) {
    const codeField = this.shadowRoot.getElementById(`code-field-${slot}`);
    const fobNotice = this.shadowRoot.getElementById(`fob-notice-${slot}`);
    const statusSection = this.shadowRoot.getElementById(`status-section-${slot}`);
    const scheduleSection = this.shadowRoot.getElementById(`schedule-section-${slot}`);
    const limitSection = this.shadowRoot.getElementById(`limit-section-${slot}`);
    
    if (newType === 'fob') {
      if (codeField) codeField.classList.add('hidden');
      if (fobNotice) fobNotice.classList.remove('hidden');
      if (statusSection) statusSection.classList.add('hidden');
      if (scheduleSection) scheduleSection.classList.add('hidden');
      if (limitSection) limitSection.classList.add('hidden');
    } else {
      if (codeField) codeField.classList.remove('hidden');
      if (fobNotice) fobNotice.classList.add('hidden');
      if (statusSection) statusSection.classList.remove('hidden');
      if (scheduleSection) scheduleSection.classList.remove('hidden');
      if (limitSection) limitSection.classList.remove('hidden');
    }
  }

  toggleSchedule(slot, checked) {
    const fields = this.shadowRoot.getElementById(`schedule-fields-${slot}`);
    if (fields) {
      fields.classList.toggle('hidden', !checked);
    }
    // Mark as having unsaved changes when schedule toggle is changed
    this._checkForUnsavedChanges(slot);
  }

  toggleLimit(slot, checked) {
    const fields = this.shadowRoot.getElementById(`limit-fields-${slot}`);
    if (fields) {
      fields.classList.toggle('hidden', !checked);
    }
    // Mark as having unsaved changes when limit toggle is changed
    this._checkForUnsavedChanges(slot);
  }

  async toggleNotification(slot, checked) {
    try {
      // Get current notification services
      const currentServices = this._formValues[slot]?.notificationServices || [];
      const servicesArray = Array.isArray(currentServices) ? currentServices : 
        (currentServices ? [currentServices] : ['notify.persistent_notification']);
      
      // Save immediately
      await this._hass.callService('yale_lock_manager', 'set_notification_enabled', {
        entity_id: this._config.entity,
        slot: parseInt(slot, 10),
        enabled: checked,
        notification_services: servicesArray.length > 0 ? servicesArray : ['notify.persistent_notification']
      });
      
      // Update form values
      this._setFormValue(slot, 'notificationsEnabled', checked);
      
      // Show success message
      this.showStatus(slot, '✅ Notifications updated', 'success');
    } catch (error) {
      console.error('[Yale Lock Manager] Error updating notifications:', error);
      this.showStatus(slot, `❌ Failed to update notifications: ${error.message}`, 'error');
    }
  }

  async getAvailableNotificationServices() {
    // Return cached services if available
    if (this._availableNotificationServices !== null) {
      return this._availableNotificationServices;
    }
    
    try {
      // Query Home Assistant for available services
      const services = await this._hass.callWS({
        type: 'get_services',
      });
      // Debug: raw response structure (API may return { result: { notify: {...} } } or unwrapped)
      console.log('[Yale Lock Manager] get_services raw response top-level keys:', Object.keys(services || {}));
      const notifyDomain = (services?.result && services.result.notify) ? services.result.notify : (services?.notify || {});
      console.log('[Yale Lock Manager] notify service keys used:', Object.keys(notifyDomain));
      
      // Filter for notify services - treat any key containing mobile_app_ (except "mobile_app") as a device
      const notifyServices = [];
      if (Object.keys(notifyDomain).length > 0) {
        const keys = Object.keys(notifyDomain);
        if (this._debugMode) {
          console.log('[Yale Lock Manager] Available notify service IDs:', keys);
        }
        for (const key of keys) {
          const id = key.startsWith('notify.') ? key : `notify.${key}`;
          if (key === 'persistent_notification') {
            notifyServices.push({ id: 'notify.persistent_notification', name: 'UI', type: 'ui' });
          } else if (key === 'mobile_app') {
            notifyServices.push({ id: 'notify.mobile_app', name: 'All Mobiles', type: 'all' });
          } else if (key.includes('mobile_app_') && key !== 'mobile_app') {
            // Individual device: notify.mobile_app_{phone_name} or mobile_app_{phone_name}
            const afterPrefix = key.split('mobile_app_').slice(1).join('mobile_app_');
            const deviceName = afterPrefix.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            notifyServices.push({
              id: id,
              name: deviceName || key,
              type: 'device'
            });
          }
        }
      }
      
      if (this._debugMode) {
        console.log('[Yale Lock Manager] Discovered notification services:', notifyServices);
      }
      
      // Always include UI and All Mobiles if not found
      const hasUI = notifyServices.some(s => s.id === 'notify.persistent_notification');
      const hasAllMobiles = notifyServices.some(s => s.id === 'notify.mobile_app');
      
      if (!hasUI) {
        notifyServices.unshift({
          id: 'notify.persistent_notification',
          name: 'UI',
          type: 'ui'
        });
      }
      if (!hasAllMobiles) {
        notifyServices.splice(hasUI ? 1 : 0, 0, {
          id: 'notify.mobile_app',
          name: 'All Mobiles',
          type: 'all'
        });
      }
      
      // Fallback: if get_services did not return any device entries, get list from backend (same source as All Mobiles)
      const hasDevices = notifyServices.some(s => s.type === 'device');
      if (!hasDevices && this._hass.connection) {
        try {
          const res = await this._hass.callWS({ type: 'yale_lock_manager/get_notification_services' });
          const list = (res?.result?.services != null) ? res.result.services : (res?.services || []);
          if (Array.isArray(list) && list.length > 0) {
            const devices = list.filter(s => s.type === 'device');
            if (devices.length > 0) {
              const uiAndAll = notifyServices.filter(s => s.type === 'ui' || s.type === 'all');
              notifyServices.length = 0;
              notifyServices.push(...uiAndAll, ...devices);
              console.log('[Yale Lock Manager] Notification services from backend fallback:', notifyServices.length, 'total,', devices.length, 'devices');
            }
          }
        } catch (e) {
          console.warn('[Yale Lock Manager] Backend get_notification_services fallback failed:', e);
        }
      }
      
      this._availableNotificationServices = notifyServices;
      return notifyServices;
    } catch (error) {
      console.error('[Yale Lock Manager] Error fetching notification services:', error);
      // Return default services on error
      return [
        { id: 'notify.persistent_notification', name: 'UI', type: 'ui' },
        { id: 'notify.mobile_app', name: 'All Mobiles', type: 'all' }
      ];
    }
  }

  async toggleNotificationService(slot, serviceId) {
    try {
      // Get current state
      const currentServices = this._formValues[slot]?.notificationServices || [];
      const servicesArray = Array.isArray(currentServices) ? currentServices : 
        (currentServices ? [currentServices] : []);
      
      // Toggle service in list
      const index = servicesArray.indexOf(serviceId);
      if (index > -1) {
        servicesArray.splice(index, 1);
      } else {
        servicesArray.push(serviceId);
      }
      
      // Get notification enabled state
      const notificationToggle = this.shadowRoot.getElementById(`notification-toggle-${slot}`);
      const notificationsEnabled = notificationToggle ? notificationToggle.checked : 
        (this._formValues[slot]?.notificationsEnabled ?? false);
      
      // Save immediately
      await this._hass.callService('yale_lock_manager', 'set_notification_enabled', {
        entity_id: this._config.entity,
        slot: parseInt(slot, 10),
        enabled: notificationsEnabled,
        notification_services: servicesArray.length > 0 ? servicesArray : ['notify.persistent_notification']
      });
      
      // Update form values and UI
      this._setFormValue(slot, 'notificationServices', servicesArray);
      
      // Re-render to update chips
      this.render();
      
      // Show success message
      this.showStatus(slot, '✅ Notification service updated', 'success');
    } catch (error) {
      console.error('[Yale Lock Manager] Error updating notification service:', error);
      this.showStatus(slot, `❌ Failed to update service: ${error.message}`, 'error');
    }
  }

  changeNotificationService(slot, service) {
    // Legacy method - redirect to toggleNotificationService
    this.toggleNotificationService(slot, service);
  }

  showExportConfirm() {
    this._showExportConfirm = true;
    this.render();
  }

  cancelExportConfirm() {
    this._showExportConfirm = false;
    this.render();
  }

  async confirmExportDownload() {
    try {
      await this.exportBackup();
    } finally {
      this._showExportConfirm = false;
      this.render();
    }
  }

  showImportConfirm() {
    this._showImportConfirm = true;
    this.render();
  }

  cancelImportConfirm() {
    this._showImportConfirm = false;
    this.render();
  }

  confirmImportChooseFile() {
    this._showImportConfirm = false;
    this.render();
    this.triggerImportBackup();
  }

  async exportBackup() {
    try {
      this.showStatus(0, 'Exporting...', 'info');
      const res = await this._hass.callWS({ type: 'yale_lock_manager/export_user_data' });
      const data = res?.result?.data ?? res?.data;
      if (data == null) {
        this.showStatus(0, 'No data to export', 'error');
        return;
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `yale_lock_manager_backup_${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showStatus(0, 'Backup exported', 'success');
    } catch (error) {
      console.error('[Yale Lock Manager] Export failed:', error);
      this.showStatus(0, `Export failed: ${error.message}`, 'error');
    }
  }

  triggerImportBackup() {
    const input = this.shadowRoot.getElementById('import-file-input');
    if (input) {
      input.value = '';
      input.onchange = (e) => this.importBackupFromFile(e);
      input.click();
    }
  }

  async importBackupFromFile(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    try {
      this.showStatus(0, 'Importing...', 'info');
      const text = await file.text();
      const data = JSON.parse(text);
      await this._hass.callService('yale_lock_manager', 'import_user_data', {
        entity_id: this._config.entity,
        data: data
      });
      this.showStatus(0, 'Backup imported successfully', 'success');
      this.render();
    } catch (error) {
      console.error('[Yale Lock Manager] Import failed:', error);
      this.showStatus(0, `Import failed: ${error.message}`, 'error');
    }
    event.target.value = '';
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
      // Log before refresh
      const beforeRefreshCached = JSON.parse(JSON.stringify(this._formValues));
      const beforeRefreshEntity = this.getUserData();
      this._addDebugLog('Before Refresh', null, {
        cached_slots: Object.keys(beforeRefreshCached).length,
        entity_slots: beforeRefreshEntity.filter(u => u.name || u.code).length
      });
      
      // Store snapshot of current user data BEFORE refresh
      this._storeRefreshSnapshot();
      
      if (this._debugMode) {
        console.log('[Yale Lock Manager] [REFRESH DEBUG] refresh() called');
        this._logUserData(this._refreshSnapshot, 'Snapshot');
      }
      
      // Clear previous progress
      this._refreshProgress = null;
      this._updateRefreshProgress();
      
      // IMMEDIATE FEEDBACK - show status right away so user knows something is happening
      this.showStatus(0, '⏳ Starting refresh... This may take a moment.', 'info');
      this.renderStatusMessage(0);
      
      if (this._debugMode) {
        console.log('[Yale Lock Manager] [REFRESH DEBUG] Calling pull_codes_from_lock service...');
      }
      
      // Events will handle progress updates and UI refresh
      await this._hass.callService('yale_lock_manager', 'pull_codes_from_lock', {
        entity_id: this._config.entity
      });
      
      if (this._debugMode) {
        console.log('[Yale Lock Manager] [REFRESH DEBUG] pull_codes_from_lock service call completed');
      }
      
      // Success message and UI refresh are handled by the complete event
      // Don't call render() here - let the complete event handler do it
    } catch (error) {
      if (this._debugMode) {
        console.error('[Yale Lock Manager] [REFRESH DEBUG] refresh() error:', error);
      }
      this._refreshProgress = null;
      this._refreshSnapshot = null; // Clear snapshot on error
      this._updateRefreshProgress();
      this.showStatus(0, `❌ Refresh failed: ${error.message}`, 'error');
      this.renderStatusMessage(0);
    }
  }

  async changeStatus(slot, statusValue) {
    const status = parseInt(statusValue, 10);
    
    // CRITICAL: Check if user actually exists in entity state
    // getUserData() returns all 20 slots with default objects, so we need to check the actual entity state
    const stateObj = this._hass?.states[this._config?.entity];
    const users = stateObj?.attributes?.users || {};
    const slotStr = slot.toString();
    const userExistsInEntity = slotStr in users && users[slotStr] && users[slotStr].name;
    
    // If user doesn't exist in entity state, don't call service
    // This happens when:
    // 1. Typing in username for an available slot and status changes programmatically
    // 2. Manually changing status for a slot that hasn't been saved yet
    if (!userExistsInEntity) {
      // User doesn't exist in entity state - just update form value, don't call service
      this._setFormValue(slot, 'cachedStatus', status);
      return; // Exit silently - no error message needed
    }
    
    // User exists in entity state - safe to call service
    try {
      await this._hass.callService('yale_lock_manager', 'set_user_status', {
        entity_id: this._config.entity,
        slot: parseInt(slot, 10),
        status: status
      });
      
      // Just update message, don't refresh fields
      this.showStatus(slot, 'Status updated', 'success');
      setTimeout(() => {
        if (this._statusMessages[slot]?.message === 'Status updated') {
          this.clearStatus(slot);
        }
      }, 2000);
    } catch (error) {
      // Show error - user exists so this is a real error
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
    
    // Log before push
    const beforeCached = { ...(this._formValues[slot] || {}) };
    const beforeEntity = this.getUserData().find(u => u.slot === slot);
    this._addDebugLog('Push Clicked', slot, {
      cached_code: beforeCached.code || '',
      entity_code: beforeEntity?.code || '',
      entity_lock_code: beforeEntity?.lock_code || '',
      synced: beforeEntity?.synced_to_lock || false
    });
    
    this.showStatus(slot, `Push "${user.name}" to the lock now?`, 'confirm', async () => {
      try {
        // Step 1: Pushing code to lock
        this.showStatus(slot, '⏳ Pushing code to lock...', 'info');
        this.renderStatusMessage(slot);
        
        // Start the push (this is async, but backend does all steps)
        const pushPromise = this._hass.callService('yale_lock_manager', 'push_code_to_lock', {
          entity_id: this._config.entity,
          slot: parseInt(slot, 10)
        });
        
        // Step 2: Wait a bit, then show "waiting for lock to process"
        setTimeout(() => {
          if (this._statusMessages[slot]?.message?.includes('Pushing code to lock')) {
            this.showStatus(slot, '⏳ Waiting for lock to process...', 'info');
            this.renderStatusMessage(slot);
          }
        }, 1000);
        
        // Step 3: Show "rereading code from lock" (backend does this ~2 seconds after push)
        setTimeout(() => {
          if (this._statusMessages[slot]?.message?.includes('Waiting for lock to process') || 
              this._statusMessages[slot]?.message?.includes('Pushing code to lock')) {
            this.showStatus(slot, '⏳ Rereading code from lock...', 'info');
            this.renderStatusMessage(slot);
          }
        }, 2500);
        
        // Step 4: Show "storing current lock code" (backend does this after verification)
        setTimeout(() => {
          if (this._statusMessages[slot]?.message?.includes('Rereading code from lock') ||
              this._statusMessages[slot]?.message?.includes('Waiting for lock to process')) {
            this.showStatus(slot, '⏳ Storing current lock code...', 'info');
            this.renderStatusMessage(slot);
          }
        }, 4000);
        
        // Store cached values before push for error logging
        const afterPushCached = { ...(this._formValues[slot] || {}) };
        
        // Wait for push to complete
        try {
          await pushPromise;
        } catch (error) {
          const errorEntity = this.getUserData().find(u => u.slot === slot);
          this._addDebugLog('Push Failed', slot, {
            error: error.message || 'Unknown error',
            cached_code: afterPushCached.code || '',
            entity_lock_code: errorEntity?.lock_code || '',
            synced: errorEntity?.synced_to_lock || false,
            note: 'Push failed'
          });
          throw error; // Re-throw to show error to user
        }
        
        // Log after push successful (immediate check)
        const afterPushEntity = this.getUserData().find(u => u.slot === slot);
        this._addDebugLog('Push Successful (Immediate)', slot, {
          cached_code: afterPushCached.code || '',
          entity_code: afterPushEntity?.code || '',
          entity_lock_code: afterPushEntity?.lock_code || '',
          synced: afterPushEntity?.synced_to_lock || false,
          note: 'Entity state checked immediately after push promise resolves'
        });
        
        // Step 5: All complete!
        this.showStatus(slot, '✅ All complete! Code pushed and verified successfully!', 'success');
        this.renderStatusMessage(slot);
        
        // Clear lock-affecting changes flag after successful push
        delete this._lockAffectingChanges[slot];
        // Clear saved slots flag so Push button disables until new changes are saved
        delete this._savedSlots[slot];
        // Update button states
        this._updateButtonStates(slot);
        
        // Poll entity state multiple times to track when it updates
        let pollAttempt = 0;
        const maxPollAttempts = 10;
        const pollInterval = 1000; // Check every 1 second (increased from 500ms)
        const startTime = Date.now();
        
        const pollEntityState = () => {
          pollAttempt++;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const currentEntity = this.getUserData().find(u => u.slot === slot);
          const currentCached = this._formValues[slot] || {};
          
          this._addDebugLog(`Entity State Poll #${pollAttempt}`, slot, {
            cached_code: currentCached.code || '',
            entity_code: currentEntity?.code || '',
            entity_lock_code: currentEntity?.lock_code || '',
            code_match: (currentCached.code === currentEntity?.lock_code),
            synced: currentEntity?.synced_to_lock || false,
            elapsed_seconds: elapsed,
            note: `Polling entity state ${pollAttempt}/${maxPollAttempts} (${elapsed}s elapsed)`
          });
          
          // Check if lock_code has been updated
          const expectedCode = currentCached.code || '';
          const actualLockCode = currentEntity?.lock_code || '';
          
          if (actualLockCode === expectedCode && expectedCode !== '') {
            // Lock code matches - update UI and stop polling
            this._addDebugLog('Lock Code Updated!', slot, {
              cached_code: currentCached.code || '',
              entity_lock_code: currentEntity?.lock_code || '',
              code_match: true,
              synced: currentEntity?.synced_to_lock || false,
              elapsed_seconds: elapsed,
              note: `Entity state now shows correct lock_code after ${elapsed}s`
            });
            
            // Update slot from entity state (with focus protection)
            this._updateSlotFromEntityState(slot, true);
            
            // Update localStorage
            if (currentCached.code && currentCached.code === currentEntity.lock_code) {
              this._saveFormValuesToStorage();
            }
            
            return; // Stop polling
          }
          
          // Continue polling if not updated yet
          if (pollAttempt < maxPollAttempts) {
            // Schedule next poll with proper delay
            setTimeout(() => {
              pollEntityState();
            }, pollInterval);
          } else {
            // Max attempts reached - log final state
            this._addDebugLog('Entity State Poll Complete (Max Attempts)', slot, {
              cached_code: currentCached.code || '',
              entity_code: currentEntity?.code || '',
              entity_lock_code: currentEntity?.lock_code || '',
              lock_status: currentEntity?.lock_status,
              lock_status_from_lock: currentEntity?.lock_status_from_lock,
              synced: currentEntity?.synced_to_lock || false,
              elapsed_seconds: elapsed,
              note: `Reached max poll attempts after ${elapsed}s - entity state may not have updated`
            });
            
            // Update UI anyway
            this._updateSlotFromEntityState(slot, true);
          }
        };
        
        // Start polling after a short delay (1 second to give backend time to update)
        setTimeout(pollEntityState, 1000);
        
      } catch (error) {
        this.showStatus(slot, `❌ Push failed: ${error.message}`, 'error');
        this.renderStatusMessage(slot);
      }
    });
  }

  async saveUser(slot) {
    // Get values from form fields (which are stored in _formValues)
    const name = this.shadowRoot.getElementById(`name-${slot}`).value.trim();
    const codeType = this.shadowRoot.getElementById(`type-${slot}`).value;
    const isFob = codeType === 'fob';
    const code = !isFob ? (this.shadowRoot.getElementById(`code-${slot}`)?.value.trim() || '') : '';
    const cachedStatus = !isFob ? parseInt(this.shadowRoot.getElementById(`cached-status-${slot}`)?.value || '0', 10) : 0;
    
    // Declare schedule and limit variables at function scope so they're accessible in both if blocks
    const scheduleToggle = !isFob ? this.shadowRoot.getElementById(`schedule-toggle-${slot}`) : null;
    const startInput = !isFob ? this.shadowRoot.getElementById(`start-${slot}`) : null;
    const endInput = !isFob ? this.shadowRoot.getElementById(`end-${slot}`) : null;
    const limitToggle = !isFob ? this.shadowRoot.getElementById(`limit-toggle-${slot}`) : null;
    const limitInput = !isFob ? this.shadowRoot.getElementById(`limit-${slot}`) : null;
    
    // Log before update
    const beforeCached = { ...(this._formValues[slot] || {}) };
    const beforeEntity = this.getUserData().find(u => u.slot === slot);
    this._addDebugLog('Update User Clicked', slot, {
      before_cached_code: beforeCached.code || '',
      before_cached_status: beforeCached.cachedStatus,
      before_entity_lock_code: beforeEntity?.lock_code || '',
      new_code: code || '',
      new_status: cachedStatus
    });
    
    // Update _formValues with what we're about to save
    this._setFormValue(slot, 'name', name);
    this._setFormValue(slot, 'code', code);
    this._setFormValue(slot, 'type', codeType);
    if (!isFob) {
      this._setFormValue(slot, 'cachedStatus', cachedStatus);
    }

    // Validation
    if (!name) {
      this.showStatus(slot, 'Please enter a user name', 'error');
      return;
    }

    // PIN validation (only for PIN slots)
    if (!isFob) {
      if (cachedStatus === 1 && !code) {
        this.showStatus(slot, '⚠️ PIN is required when status is Enabled', 'error');
        return;
      }
      
      if (code) {
        if (code.length < 4) {
          this.showStatus(slot, '⚠️ PIN must be at least 4 digits', 'error');
          return;
        }
        if (code.length > 8) {
          this.showStatus(slot, '⚠️ PIN cannot be longer than 8 digits', 'error');
          return;
        }
      }
      
      // Check usage limit: Cannot enable if usage_count >= usage_limit
      const user = this.getUserData().find(u => u.slot === slot);
      if (user) {
        const usageCount = user.usage_count || 0;
        const usageLimit = user.usage_limit || null;
        if (cachedStatus === 1 && usageLimit !== null && usageCount >= usageLimit) {
          this.showStatus(slot, '⚠️ Cannot enable user: usage limit reached. Reset counter or increase limit.', 'error');
          return;
        }
      }

      // Duplicate PIN: same code already used in another slot
      if (code) {
        const users = this.getUserData();
        const duplicateSlot = users.find(u => u.slot !== slot && (
          (u.code && u.code === code) || (u.lock_code && u.lock_code === code)
        ));
        if (duplicateSlot) {
          this.showStatus(slot, `Another slot (Slot ${duplicateSlot.slot}) already uses this PIN. Use a different PIN.`, 'error');
          return;
        }
      }
    }

    try {
      // Rule 2: Only update message area, not fields
      this.showStatus(slot, '⏳ Saving user data...', 'info');
      this.renderStatusMessage(slot);
      
      // Build service data - for FOB slots, only send name and code_type
      const serviceData = {
        entity_id: this._config.entity,
        slot: parseInt(slot, 10),
        name: name,
        code_type: codeType
      };
      
      // Only include these for PIN slots
      if (!isFob) {
        serviceData.code = code;
        serviceData.status = cachedStatus;
      }
      
      await this._hass.callService('yale_lock_manager', 'set_user_code', serviceData);

      // Save schedule (PINs only - FOBs don't have schedules)
      if (!isFob) {
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

        await this._hass.callService('yale_lock_manager', 'set_user_schedule', {
          entity_id: this._config.entity,
          slot: parseInt(slot, 10),
          start_datetime: start,
          end_datetime: end
        });

        // Save usage limit (PINs only)
        const limit = (limitToggle?.checked && limitInput?.value) ? parseInt(limitInput.value, 10) : null;
        
        await this._hass.callService('yale_lock_manager', 'set_usage_limit', {
          entity_id: this._config.entity,
          slot: parseInt(slot, 10),
          max_uses: limit
        });
      }

      // Note: Notification settings are now saved instantly when toggled/changed,
      // so we don't save them here in saveUser()

      // Rule 3: After confirmed save - immediate, no lock query
      // Compare new cached values with stored lock values (from entity state)
      const user = this.getUserData().find(u => u.slot === slot);
      if (user) {
        const codesMatch = codeType === 'pin' ? (code === (user.lock_code || '')) : true;
        const statusMatch = user.lock_status_from_lock !== null && user.lock_status_from_lock !== undefined
          ? (cachedStatus === user.lock_status_from_lock)
          : false;
        const isSynced = codesMatch && statusMatch;
        
        if (!isSynced && codeType === 'pin') {
          const outsideWindow = user.schedule && (user.schedule.start || user.schedule.end) && user.schedule_valid_now === false;
          this.showStatus(slot, outsideWindow ? '✅ User saved. Scheduler will push when schedule is active.' : '✅ User saved! ⚠️ Push required to sync with lock.', 'warning');
        } else {
          this.showStatus(slot, '✅ User saved successfully!', 'success');
        }
      } else {
        this.showStatus(slot, '✅ User saved successfully!', 'success');
      }
      
      // Clear unsaved changes flag and hide warning
      delete this._unsavedChanges[slot];
      
      // Only mark slot as saved and enable Push if lock-affecting changes (PIN/status) were made
      const hadLockAffectingChanges = this._lockAffectingChanges[slot] === true;
      if (hadLockAffectingChanges) {
        this._savedSlots[slot] = true; // Mark slot as saved (enables Push button)
      }
      // Clear lock-affecting flag after save
      delete this._lockAffectingChanges[slot];
      
      const warningDiv = this.shadowRoot.getElementById(`unsaved-warning-${slot}`);
      if (warningDiv) {
        warningDiv.style.display = 'none';
        warningDiv.innerHTML = '';
      }
      
      // Update button states: disable Save, conditionally enable Push
      const saveButton = this.shadowRoot.getElementById(`save-button-${slot}`);
      const pushButton = this.shadowRoot.getElementById(`push-button-${slot}`);
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.style.opacity = '0.5';
        saveButton.style.cursor = 'not-allowed';
      }
      // Only enable Push if lock-affecting changes were made
      if (pushButton) {
        if (hadLockAffectingChanges) {
          pushButton.disabled = false;
          pushButton.style.opacity = '1';
          pushButton.style.cursor = 'pointer';
        } else {
          pushButton.disabled = true;
          pushButton.style.opacity = '0.5';
          pushButton.style.cursor = 'not-allowed';
        }
      }
      
      // Log after update completed
      const afterCached = { ...(this._formValues[slot] || {}) };
      const afterEntity = this.getUserData().find(u => u.slot === slot);
      this._addDebugLog('Update User Completed', slot, {
        after_cached_code: afterCached.code || '',
        after_cached_status: afterCached.cachedStatus,
        after_entity_code: afterEntity?.code || '',
        after_entity_lock_code: afterEntity?.lock_code || '',
        synced: afterEntity?.synced_to_lock || false
      });
      
      // Save form values to localStorage after successful save
      // This ensures values persist even if entity state is slow to update
      // Only save schedule and usage limit for PIN slots (FOBs don't have these)
      if (!isFob) {
        if (scheduleToggle?.checked && startInput?.value && endInput?.value) {
          this._setFormValue(slot, 'schedule', { start: startInput.value, end: endInput.value });
        } else {
          this._setFormValue(slot, 'schedule', { start: null, end: null });
        }
        
        if (limitToggle?.checked && limitInput?.value) {
          this._setFormValue(slot, 'usageLimit', parseInt(limitInput.value, 10));
        } else {
          this._setFormValue(slot, 'usageLimit', null);
        }
      }
      
      // Save to localStorage after updating form values
      this._saveFormValuesToStorage();
      
      // Update only non-editable parts (lock_code, lock_status) from entity state
      // Don't overwrite editable fields - they're already saved in localStorage
      setTimeout(() => {
        const updatedUser = this.getUserData().find(u => u.slot === slot);
        if (updatedUser) {
          // Only update lock fields (read-only), not editable fields
          const lockCodeField = this.shadowRoot.querySelector(`#lock-code-${slot}`);
          const lockStatusField = this.shadowRoot.querySelector(`#lock-status-${slot}`);
          
          if (lockCodeField) {
            lockCodeField.value = updatedUser.lock_code || '';
          }
          if (lockStatusField) {
            const lockStatus = updatedUser.lock_status_from_lock ?? updatedUser.lock_status;
            lockStatusField.value = lockStatus !== null && lockStatus !== undefined ? lockStatus.toString() : '0';
          }
          
          // Update sync indicators
          this._updateNonEditableParts();
        }
      }, 1000); // Short delay to let entity state update
      
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
              override_protection: true,
              status: cachedStatus
            });
            
            // After override save, compare with lock values
            const user = this.getUserData().find(u => u.slot === slot);
            if (user) {
              const codesMatch = codeType === 'pin' ? (code === (user.lock_code || '')) : true;
              const statusMatch = user.lock_status_from_lock !== null && user.lock_status_from_lock !== undefined
                ? (cachedStatus === user.lock_status_from_lock)
                : false;
              const isSynced = codesMatch && statusMatch;
              
              if (!isSynced && codeType === 'pin') {
                const outsideWindow = user.schedule && (user.schedule.start || user.schedule.end) && user.schedule_valid_now === false;
                this.showStatus(slot, outsideWindow ? '✅ User saved. Scheduler will push when schedule is active.' : '✅ User saved! ⚠️ Push required to sync with lock.', 'warning');
              } else {
                this.showStatus(slot, '✅ User saved successfully!', 'success');
              }
            }
            
            // Clear unsaved changes flag and hide warning
            delete this._unsavedChanges[slot];
            const warningDiv2 = this.shadowRoot.getElementById(`unsaved-warning-${slot}`);
            if (warningDiv2) {
              warningDiv2.style.display = 'none';
              warningDiv2.innerHTML = '';
            }
            
            // Wait for entity state to actually reflect the saved values before updating UI
            let attempts = 0;
            const maxAttempts = 17; // Wait up to 5.1 seconds (17 * 300ms)
            const checkInterval = setInterval(() => {
              attempts++;
              const updatedUser = this.getUserData().find(u => u.slot === slot);
              
              // Check if entity state has our saved values (name and code match)
              if (updatedUser && updatedUser.name === name && updatedUser.code === code) {
                clearInterval(checkInterval);
                
                // Entity state updated with saved values - now safe to update UI
                this._updateSlotFromEntityState(slot);
                
                // Show success message based on sync status
                const codesMatch = codeType === 'pin' ? (code === (updatedUser.lock_code || '')) : true;
                const statusMatch = updatedUser.lock_status_from_lock !== null && updatedUser.lock_status_from_lock !== undefined
                  ? (cachedStatus === updatedUser.lock_status_from_lock)
                  : false;
                const isSynced = codesMatch && statusMatch;
                const outsideWindow = updatedUser.schedule && (updatedUser.schedule.start || updatedUser.schedule.end) && updatedUser.schedule_valid_now === false;
                
                if (!isSynced && codeType === 'pin') {
                  this.showStatus(slot, outsideWindow ? '✅ User saved. Scheduler will push when schedule is active.' : '✅ User saved! ⚠️ Push required to sync with lock.', 'warning');
                } else {
                  this.showStatus(slot, '✅ User saved successfully!', 'success');
                }
              } else if (attempts >= maxAttempts) {
                // Timeout - update anyway (entity state might be slow)
                clearInterval(checkInterval);
                this._updateSlotFromEntityState(slot);
                this.showStatus(slot, '✅ User saved successfully!', 'success');
              }
            }, 300); // Check every 300ms
          } catch (retryError) {
            this.showStatus(slot, `Failed: ${retryError.message}`, 'error');
          }
        });
      } else {
        this.showStatus(slot, `Failed: ${error.message}`, 'error');
        this.renderStatusMessage(slot);
      }
    }
  }

  async clearSlot(slot) {
    this.showStatus(slot, 'Clear this slot? This will remove all settings.', 'confirm', async () => {
      try {
        // Clear the slot on the lock (backend will update only this slot)
        this.showStatus(slot, '⏳ Clearing slot on lock...', 'info');
        await this._hass.callService('yale_lock_manager', 'clear_user_code', {
          entity_id: this._config.entity,
          slot: parseInt(slot, 10)
        });
        
        // Wait for entity state to update (backend already updated the single slot)
        this.showStatus(slot, '⏳ Updating cache...', 'info');
        setTimeout(() => {
          this._expandedSlot = null;
          delete this._formValues[slot]; // Clear form values - will be repopulated from entity state
          this.showStatus(slot, '✅ Slot cleared and cache updated', 'success');
          this.render();
        }, 1500);
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
        setTimeout(() => this.render(), 500);
      } catch (error) {
        this.showStatus(slot, `Reset failed: ${error.message}`, 'error');
      }
    });
  }

  showClearCacheConfirm() {
    this._showClearCacheConfirm = true;
    this.render();
  }
  
  cancelClearCache() {
    this._showClearCacheConfirm = false;
    this.render();
  }
  
  async confirmClearCache() {
    try {
      await this._hass.callService('yale_lock_manager', 'clear_local_cache', {
        entity_id: this._config.entity
      });
      this._showClearCacheConfirm = false;
      this._formValues = {}; // Clear all form values
      this._clearFormValuesFromStorage(); // Also clear localStorage
      this.showStatus(0, 'Local cache cleared', 'success');
      setTimeout(() => this.render(), 500);
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
