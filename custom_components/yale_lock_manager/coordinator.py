"""Data coordinator for Yale Lock Manager."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .lock import YaleLockManagerLock

from homeassistant.components.zwave_js import DOMAIN as ZWAVE_JS_DOMAIN
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    ACCESS_METHOD_AUTO,
    ACCESS_METHOD_MANUAL,
    ACCESS_METHOD_PIN,
    ALARM_TYPE_AUTO_LOCK,
    ALARM_TYPE_KEYPAD_UNLOCK,
    ALARM_TYPE_RF_LOCK,
    ALARM_TYPE_RF_UNLOCK,
    CC_BATTERY,
    CC_DOOR_LOCK,
    CC_NOTIFICATION,
    CODE_TYPE_FOB,
    CODE_TYPE_PIN,
    CONF_LOCK_ENTITY_ID,
    CONF_LOCK_NODE_ID,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    EVENT_ACCESS,
    EVENT_CODE_EXPIRED,
    EVENT_LOCKED,
    EVENT_REFRESH_PROGRESS,
    EVENT_UNLOCKED,
    EVENT_USAGE_LIMIT_REACHED,
    MAX_USER_SLOTS,
    USER_STATUS_AVAILABLE,
    USER_STATUS_DISABLED,
    USER_STATUS_ENABLED,
)
from .logger import YaleLockLogger
from .storage import UserDataStorage
from .sync_manager import SyncManager
from .zwave_client import ZWaveClient

_LOGGER = YaleLockLogger()


class YaleLockCoordinator(DataUpdateCoordinator):
    """Coordinator to manage Yale lock data."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        self.entry = entry
        self.node_id = entry.data[CONF_LOCK_NODE_ID]
        self.lock_entity_id = entry.data[CONF_LOCK_ENTITY_ID]
        
        # Initialize specialized modules
        self._logger = YaleLockLogger("yale_lock_manager.coordinator")
        self._storage = UserDataStorage(hass, self.node_id)
        self._zwave_client = ZWaveClient(hass, self.node_id, self.lock_entity_id)
        self._sync_manager = SyncManager()
        
        # Backward compatibility: expose _user_data as property
        # This allows existing code to continue working during migration

        # Track last alarm info for notification handling
        self._last_alarm_type: int | None = None
        self._last_alarm_level: int | None = None

        # Reference to lock entity for state updates
        self._lock_entity: YaleLockManagerLock | None = None

        super().__init__(
            hass,
            _LOGGER._logger,  # Use underlying logger for coordinator base class
            name=DOMAIN,
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        )

        # Listen to Z-Wave JS events
        self._setup_listeners()

    def register_lock_entity(self, entity: YaleLockManagerLock) -> None:
        """Register the lock entity with the coordinator."""
        self._lock_entity = entity
        self._logger.debug("Lock entity registered with coordinator", force=True)
    
    @property
    def _user_data(self) -> dict[str, Any]:
        """Backward compatibility property for _user_data."""
        return self._storage.data

    def _setup_listeners(self) -> None:
        """Set up event listeners."""
        # Listen for Z-Wave JS value updates
        self.hass.bus.async_listen(
            "zwave_js_value_updated",
            self._handle_value_updated,
        )

        # Listen for Z-Wave JS notification events
        self.hass.bus.async_listen(
            "zwave_js_notification",
            self._handle_notification,
        )

    @callback
    async def _handle_value_updated(self, event) -> None:
        """Handle Z-Wave JS value update events."""
        if event.data.get("node_id") != int(self.node_id):
            return

        command_class = event.data.get("command_class")
        property_name = event.data.get("property")
        value = event.data.get("value")

        _LOGGER.debug(
            "Value updated - CC: %s, Property: %s, Value: %s",
            command_class,
            property_name,
            value,
        )

        # Trigger coordinator update
        await self.async_request_refresh()

    @callback
    async def _handle_notification(self, event) -> None:
        """Handle Z-Wave JS notification events."""
        if event.data.get("node_id") != int(self.node_id):
            return

        alarm_type = event.data.get("event_parameters", {}).get("alarmType")
        alarm_level = event.data.get("event_parameters", {}).get("alarmLevel")

        _LOGGER.debug("Notification - Type: %s, Level: %s", alarm_type, alarm_level)

        # Handle different alarm types
        if alarm_type in ALARM_TYPE_KEYPAD_UNLOCK:
            # Keypad unlock - alarm_level is the user slot
            user_slot = alarm_level
            await self._handle_access_event(user_slot, ACCESS_METHOD_PIN)
        elif alarm_type == ALARM_TYPE_AUTO_LOCK:
            self._fire_event(EVENT_LOCKED, {"method": ACCESS_METHOD_AUTO})
        elif alarm_type == ALARM_TYPE_RF_LOCK:
            # Alarm 24: RF lock operation (Z-Wave/Remote locked the lock)
            self._fire_event(EVENT_LOCKED, {"method": ACCESS_METHOD_REMOTE})
        elif alarm_type == ALARM_TYPE_RF_UNLOCK:
            # Alarm 25: RF unlock operation (Z-Wave/Remote unlocked the lock)
            self._fire_event(EVENT_UNLOCKED, {"method": ACCESS_METHOD_REMOTE})

    async def _handle_access_event(self, user_slot: int, method: str) -> None:
        """Handle a user access event."""
        user_data = self._user_data["users"].get(str(user_slot))

        if not user_data:
            _LOGGER.warning("Access by unknown user slot: %s", user_slot)
            return

        user_name = user_data.get("name", f"User {user_slot}")

        # Check if code is within schedule
        if not self._is_code_valid(user_slot):
            _LOGGER.warning(
                "Access by %s (slot %s) outside of valid schedule",
                user_name,
                user_slot,
            )
            self._fire_event(
                EVENT_CODE_EXPIRED,
                {
                    "user_name": user_name,
                    "user_slot": user_slot,
                },
            )
            return

        # Update usage count
        usage_count = user_data.get("usage_count", 0) + 1
        user_data["usage_count"] = usage_count
        user_data["last_used"] = datetime.now().isoformat()

        # Check usage limit
        max_uses = user_data.get("usage_limit")
        if max_uses and usage_count >= max_uses:
            _LOGGER.info(
                "User %s (slot %s) reached usage limit",
                user_name,
                user_slot,
            )
            self._fire_event(
                EVENT_USAGE_LIMIT_REACHED,
                {
                    "user_name": user_name,
                    "user_slot": user_slot,
                },
            )
            # Disable the user
            await self.async_disable_user(user_slot)

        # Save updated data
        await self.async_save_user_data()

        # Fire access event
        self._fire_event(
            EVENT_ACCESS,
            {
                "user_name": user_name,
                "user_slot": user_slot,
                "method": method,
                "timestamp": datetime.now().isoformat(),
                "usage_count": usage_count,
            },
        )

        # Also fire unlock event
        self._fire_event(
            EVENT_UNLOCKED,
            {
                "user_name": user_name,
                "user_slot": user_slot,
                "method": method,
            },
        )

    def _is_code_valid(self, user_slot: int) -> bool:
        """Check if a user code is currently valid based on schedule."""
        user_data = self._user_data["users"].get(str(user_slot))
        if not user_data:
            return False

        schedule = user_data.get("schedule", {})
        start = schedule.get("start")
        end = schedule.get("end")

        if not start and not end:
            # No schedule restrictions
            return True

        now = datetime.now()

        if start:
            start_dt = datetime.fromisoformat(start)
            if now < start_dt:
                return False

        if end:
            end_dt = datetime.fromisoformat(end)
            if now > end_dt:
                return False

        return True

    def _fire_event(self, event_type: str, data: dict[str, Any]) -> None:
        """Fire a Home Assistant event."""
        self.hass.bus.async_fire(event_type, data)
        _LOGGER.debug("Fired event %s with data: %s", event_type, data)

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch data from the lock."""
        self._logger.debug_refresh("_async_update_data() called")
        try:
            data = {}

            # Get lock state using Z-Wave client
            lock_state_data = await self._zwave_client.get_lock_state()
            data.update(lock_state_data)

            # Get config parameters using Z-Wave client
            config_data = await self._zwave_client.get_config_parameters()
            data.update(config_data)

            # Get user codes status (we'll query them periodically)
            data["user_codes"] = await self._get_all_user_codes()

            self._logger.info("Coordinator data updated successfully")
            self._logger.debug_refresh("_async_update_data() returning data (note: user data is in storage, not in returned data)")
            return data

        except Exception as err:
            self._logger.error("Error in coordinator update", error=str(err), exc_info=True)
            raise UpdateFailed(f"Error communicating with lock: {err}") from err

    async def _get_zwave_value(
        self, command_class: int, property_name: str, property_key: int | None = None
    ) -> Any:
        """Get a Z-Wave JS value from the node's cached values."""
        try:
            _LOGGER.debug(
                "Getting Z-Wave value - CC: %s, Property: %s, Key: %s",
                command_class,
                property_name,
                property_key,
            )
            
            # Use the node_id we already have from config entry
            node_id = int(self.node_id)
            
            # Access Z-Wave JS integration data directly
            if ZWAVE_JS_DOMAIN not in self.hass.data:
                _LOGGER.warning("Z-Wave JS domain not found in hass.data")
                return None
            
            # Find the Z-Wave JS client
            for entry_id, entry_data in self.hass.data[ZWAVE_JS_DOMAIN].items():
                if not isinstance(entry_data, dict):
                    continue
                    
                client = entry_data.get("client")
                if not client or not hasattr(client, "driver"):
                    continue
                
                driver = client.driver
                if not hasattr(driver, "controller"):
                    continue
                
                node = driver.controller.nodes.get(node_id)
                if not node:
                    continue
                
                # Try value ID lookup first (most reliable)
                # Format: {node_id}-{command_class}-{endpoint}-{property}-{property_key}
                if property_key is not None:
                    value_id = f"{node_id}-{command_class}-0-{property_name}-{property_key}"
                    if value_id in node.values:
                        value = node.values[value_id]
                        _LOGGER.debug("Found value via value_id %s: %s", value_id, value.value)
                        return value.value
                
                # Fallback: Search through node values
                for value in node.values.values():
                    if value.command_class != command_class:
                        continue
                    
                    # Check property name (try multiple attribute names)
                    prop_attr = None
                    if hasattr(value, 'property_'):
                        prop_attr = value.property_
                    elif hasattr(value, 'property_name'):
                        prop_attr = value.property_name
                    elif hasattr(value, 'property'):
                        prop_attr = value.property
                    
                    if prop_attr != property_name:
                        continue
                    
                    # Check property_key if specified
                    if property_key is not None:
                        prop_key = getattr(value, 'property_key', None)
                        if prop_key == property_key:
                            _LOGGER.debug("Found value: %s (CC:%s, Prop:%s, Key:%s)", 
                                         value.value, command_class, property_name, property_key)
                            return value.value
                    else:
                        _LOGGER.debug("Found value: %s (CC:%s, Prop:%s)", 
                                     value.value, command_class, property_name)
                        return value.value
                
                # Debug: log all matching CC values to see what's available
                _LOGGER.debug("Searching for CC:%s, Property:%s, Key:%s", command_class, property_name, property_key)
                matching_cc_values = []
                for val_id, val in node.values.items():
                    if val.command_class == command_class:
                        prop_attr = getattr(val, 'property_', None) or getattr(val, 'property_name', None) or getattr(val, 'property', None)
                        matching_cc_values.append({
                            'value_id': val_id,
                            'property': prop_attr,
                            'property_key': getattr(val, 'property_key', None),
                            'value': val.value
                        })
                if matching_cc_values:
                    _LOGGER.debug("Available CC:%s values: %s", command_class, matching_cc_values)
            
            _LOGGER.warning("No value found for CC:%s, Property:%s, Key:%s", command_class, property_name, property_key)
            return None

        except Exception as err:
            _LOGGER.error("Error getting Z-Wave value: %s", err, exc_info=True)
            return None

    async def _get_all_user_codes(self) -> dict[int, dict[str, Any]]:
        """Get all user codes from the lock."""
        # For now, return empty dict
        # User codes will be managed through our storage, not queried from lock
        # This avoids complex Z-Wave queries that may not work reliably
        return {}

    async def _get_user_code_data(self, slot: int) -> dict[str, Any] | None:
        """Get user code data (status and code) from the lock."""
        return await self._zwave_client.get_user_code_data(slot)

    async def _get_user_code_status(self, slot: int) -> int | None:
        """Get user code status for a slot by querying the lock."""
        data = await self._zwave_client.get_user_code_data(slot)
        if data and "userIdStatus" in data:
            return int(data["userIdStatus"])
        return None

    async def _get_user_code(self, slot: int) -> str:
        """Get user code for a slot by querying the lock."""
        data = await self._zwave_client.get_user_code_data(slot)
        if data and "userCode" in data:
            code_str = str(data["userCode"])
            self._logger.debug("Slot code from lock", slot=slot, code="***" if code_str else "None", force=True)
            return code_str or ""
        return ""

    async def _update_slot_from_lock(self, slot: int) -> None:
        """Update a single slot's data from the lock.
        
        This is an optimized version that only queries and updates one slot,
        used after operations like clear_user_code where we know which slot changed.
        """
        data = await self._get_user_code_data(slot)
        
        if not data:
            _LOGGER.debug("Slot %s - No data returned (empty or timeout)", slot)
            return
        
        status = data.get("userIdStatus")
        code = data.get("userCode", "")
        
        # Convert code to string if it's not already
        if code is not None:
            code = str(code)
        else:
            code = ""
        
        _LOGGER.debug("Slot %s - Status: %s, Code: %s", slot, status, "***" if code else "None")
        
        # Convert status to int for comparison
        status_int = int(status) if status is not None else USER_STATUS_AVAILABLE
        slot_str = str(slot)
        
        # Check if we already have this slot
        if slot_str in self._user_data["users"]:
            user_data = self._user_data["users"][slot_str]
            
            # Update lock state
            user_data["lock_code"] = code if code else ""
            user_data["lock_status_from_lock"] = status_int
            user_data["lock_enabled"] = (status_int == USER_STATUS_ENABLED)
            
            # PIN Overwrite Logic:
            # - If status = ENABLED (1) AND code exists: Overwrite cached PIN
            # - If status = AVAILABLE (0) with no code: Clear cached PIN and set status to DISABLED
            if status_int == USER_STATUS_ENABLED and code:
                # Lock is enabled with code - overwrite cached PIN (code was added directly to lock)
                old_code = user_data.get("code", "")
                if old_code != code:
                    _LOGGER.info(
                        "Slot %s: Lock enabled with code, overwriting cached PIN (old: '%s', new: '%s')",
                        slot, "***" if old_code else "None", "***" if code else "None"
                    )
                    user_data["code"] = code
                else:
                    _LOGGER.debug("Slot %s: Lock enabled, cached PIN matches lock code", slot)
                user_data["lock_status"] = USER_STATUS_ENABLED
            elif status_int == USER_STATUS_AVAILABLE:
                # Lock is available (cleared) - update cache to reflect cleared state
                if not code or code == "":
                    # Lock is cleared (no code) - clear cached PIN and set status to DISABLED
                    old_cached_code = user_data.get("code", "")
                    if old_cached_code:
                        _LOGGER.info(
                            "Slot %s: Lock cleared (AVAILABLE, no code), clearing cached PIN '%s' and setting status to DISABLED",
                            slot, "***" if old_cached_code else "None"
                        )
                        user_data["code"] = ""  # Clear cached PIN
                        user_data["lock_status"] = USER_STATUS_DISABLED  # Set cached status to DISABLED
                    else:
                        _LOGGER.debug("Slot %s: Lock is AVAILABLE, cached PIN already empty", slot)
                        # Ensure cached status is DISABLED if not already set
                        if user_data.get("lock_status") != USER_STATUS_DISABLED:
                            user_data["lock_status"] = USER_STATUS_DISABLED
                else:
                    # Lock is AVAILABLE but has a code (shouldn't happen, but handle it)
                    _LOGGER.warning("Slot %s: Lock status is AVAILABLE but has code '%s'", slot, "***" if code else "None")
            elif status_int == USER_STATUS_DISABLED:
                # Lock is disabled (but has code) - preserve cached PIN and status
                _LOGGER.debug(
                    "Slot %s: Lock status=DISABLED, preserving cached PIN '%s' and cached status",
                    slot, "***" if user_data.get("code") else "None"
                )
            else:
                # Unknown status
                _LOGGER.warning("Slot %s: Unknown status %s", slot, status_int)
            
            # Recalculate sync status
            cached_enabled = user_data.get("enabled", False)
            should_be_enabled = cached_enabled and self._is_code_valid(slot)
            lock_is_enabled = (status_int == USER_STATUS_ENABLED)
            
            # Synced if: code matches AND enabled state matches
            cached_code = user_data.get("code", "")
            if should_be_enabled:
                # Should be enabled: code must exist and match
                user_data["synced_to_lock"] = (
                    lock_is_enabled and
                    cached_code == code and
                    cached_code != ""
                )
            else:
                # Should be disabled: code must NOT exist
                user_data["synced_to_lock"] = (
                    status_int == USER_STATUS_AVAILABLE or
                    code == ""
                )
            
            _LOGGER.info("Slot %s updated - Cached: %s, Lock: %s, Synced: %s", 
                       slot, "***" if cached_code else "None", 
                       "***" if code else "None", user_data["synced_to_lock"])
            
            await self.async_save_user_data()
            
            # Update entity state
            self.data["last_user_update"] = datetime.now().isoformat()
            self.async_update_listeners()
            if self._lock_entity:
                self.hass.loop.call_later(0.2, self._lock_entity.async_write_ha_state)
        else:
            # Slot doesn't exist in cache - this shouldn't happen after a clear, but handle it
            _LOGGER.debug("Slot %s not found in cache - skipping update", slot)

    async def async_set_user_code(
        self,
        slot: int,
        code: str,
        name: str,
        code_type: str = CODE_TYPE_PIN,
        override_protection: bool = False,
        status: int | None = None,
    ) -> None:
        """Set a user code."""
        _LOGGER.info(
            "Setting user code for slot %s: name=%s, code_type=%s, override=%s, code=%s", 
            slot, name, code_type, override_protection, "***" if code else "None"
        )
        
        # Validate slot
        if slot < 1 or slot > MAX_USER_SLOTS:
            raise ValueError(f"Slot must be between 1 and {MAX_USER_SLOTS}")

        # Get existing user data if slot exists
        existing_user = self._user_data["users"].get(str(slot))

        # For FOBs, only save name and code_type - no code, status, schedule, or usage_limit
        if code_type == CODE_TYPE_FOB:
            # FOBs don't need PIN code, status, schedule, or usage_limit
            code = ""  # Empty code for FOBs
            schedule = {"start": None, "end": None}
            usage_limit = None
            usage_count = 0
            lock_status = USER_STATUS_AVAILABLE  # Default status for FOBs
            # Preserve existing lock_code and lock_status_from_lock if updating
            if existing_user:
                lock_code = existing_user.get("lock_code", "")
                lock_status_from_lock = existing_user.get("lock_status_from_lock")
                lock_enabled = existing_user.get("lock_enabled", False)
            else:
                lock_code = ""
                lock_status_from_lock = None
                lock_enabled = False
            # FOBs are always synced (they're managed directly on the lock)
            synced_to_lock = True
        else:
            # For PINs, validate code length
            if not code or len(code) < 4:
                raise ValueError("PIN code must be at least 4 digits")

            # Check slot protection (unless override is True)
            if not override_protection and not await self._is_slot_safe_to_write(slot):
                raise ValueError(f"Slot {slot} is occupied by an unknown code. Use override_protection=True to overwrite.")

            # IMMEDIATE SAVE: Don't query lock - use existing lock_code/lock_status_from_lock from storage
            # Preserve existing schedule/usage data if updating
            if existing_user:
                schedule = existing_user.get("schedule", {"start": None, "end": None})
                usage_limit = existing_user.get("usage_limit")
                usage_count = existing_user.get("usage_count", 0)
                # Preserve existing lock_code and lock_status_from_lock (don't query lock)
                lock_code = existing_user.get("lock_code", "")
                lock_status_from_lock = existing_user.get("lock_status_from_lock")
                lock_enabled = existing_user.get("lock_enabled", False)
                # Use provided status if available, otherwise preserve existing cached status
                lock_status = status if status is not None else existing_user.get("lock_status", USER_STATUS_AVAILABLE)
            else:
                schedule = {"start": None, "end": None}
                usage_limit = None
                usage_count = 0
                # New user - no lock data yet
                lock_code = ""
                lock_status_from_lock = None
                lock_enabled = False
                # Use provided status if available, otherwise default to Available
                lock_status = status if status is not None else USER_STATUS_AVAILABLE

            # Calculate sync status: based on code existence, not status
            # Note: We can't check schedule here, so we use enabled flag
            # Sync will be recalculated when we check the lock
            cached_enabled = (lock_status == USER_STATUS_ENABLED) if existing_user else False
            should_be_enabled = cached_enabled  # Can't check schedule here
            
            if should_be_enabled:
                # Should be enabled: code must exist and match
                synced_to_lock = (
                    lock_status_from_lock == USER_STATUS_ENABLED and
                    code == lock_code and
                    code != ""
                )
            else:
                # Should be disabled: code must NOT exist
                synced_to_lock = (
                    lock_status_from_lock == USER_STATUS_AVAILABLE or
                    lock_code == ""
                )
            _LOGGER.info("Slot %s sync calculation - Cached code: %s, Lock code: %s, Should be enabled: %s, Synced: %s",
                        slot, "***" if code else "None", "***" if lock_code else "None", should_be_enabled, synced_to_lock)
        
        self._user_data["users"][str(slot)] = {
            "name": name,
            "code_type": code_type,
            "code": code,  # Cached code (editable) - empty for FOBs
            "lock_code": lock_code,  # PIN from lock (read-only, updated from query above)
            "enabled": lock_status == USER_STATUS_ENABLED if code_type == CODE_TYPE_PIN else False,  # Derived from cached status (always False for FOBs)
            "lock_status": lock_status,  # Store cached status (editable for PINs, default for FOBs)
            "lock_status_from_lock": lock_status_from_lock,  # Store actual status from lock (read-only, updated from query above)
            "lock_enabled": lock_enabled,  # Enabled status from lock (for compatibility)
            "schedule": schedule,  # Empty for FOBs
            "usage_limit": usage_limit,  # None for FOBs
            "usage_count": usage_count,  # 0 for FOBs
            "synced_to_lock": synced_to_lock,  # Calculated based on code and status comparison (always True for FOBs)
            "last_used": None,
        }

        await self.async_save_user_data()
        await self.async_request_refresh()

    async def _is_slot_safe_to_write(self, slot: int) -> bool:
        """Check if a slot is safe to write to."""
        # Get current status from lock
        status = await self._get_user_code_status(slot)
        _LOGGER.debug("Slot %s status from lock: %s", slot, status)

        if status == USER_STATUS_AVAILABLE:
            # Slot is empty, safe to write
            _LOGGER.debug("Slot %s is available (empty), safe to write", slot)
            return True

        # Check if we have this slot in our data
        user_data = self._user_data["users"].get(str(slot))
        if user_data:
            # We own this slot (regardless of enabled/disabled state)
            _LOGGER.debug("Slot %s found in local storage (owned by us): %s", slot, user_data.get("name"))
            return True

        # Slot is occupied by unknown code
        _LOGGER.warning(
            "Slot %s is occupied by unknown code (status=%s, not in local storage). "
            "Use override_protection=True to overwrite.",
            slot,
            status
        )
        return False

    async def async_clear_user_code(self, slot: int) -> None:
        """Clear a user code from storage and lock.
        
        This uses the lock_code_manager approach - clears the code from the lock,
        then updates only that slot from the lock to refresh the cache.
        """
        try:
            _LOGGER.info("Clearing slot %s from lock...", slot)
            
            # Use Z-Wave client service (lock_code_manager approach)
            await self._zwave_client.clear_user_code(slot)
            
            # Wait for lock to process the clear operation
            await asyncio.sleep(3.0)
            
            # Update only this slot from lock (optimized - no need to scan all slots)
            _LOGGER.info("Updating slot %s from lock...", slot)
            await self._update_slot_from_lock(slot)
            
            _LOGGER.info("✓ Slot %s cleared and cache updated from lock", slot)
            
        except Exception as err:
            _LOGGER.error("Error clearing slot %s from lock: %s", slot, err)
            raise

    async def async_enable_user(self, slot: int) -> None:
        """Enable a user code."""
        if str(slot) in self._user_data["users"]:
            self._user_data["users"][str(slot)]["enabled"] = True
            self._user_data["users"][str(slot)]["synced_to_lock"] = False  # Needs push
            await self.async_save_user_data()
            await self.async_request_refresh()

    async def async_disable_user(self, slot: int) -> None:
        """Disable a user code."""
        if str(slot) in self._user_data["users"]:
            self._user_data["users"][str(slot)]["enabled"] = False
            self._user_data["users"][str(slot)]["synced_to_lock"] = False  # Needs push
            await self.async_save_user_data()
            await self.async_request_refresh()

    async def async_set_user_status(self, slot: int, status: int) -> None:
        """Set user status (0=Available, 1=Enabled, 2=Disabled).
        
        With the new approach:
        - ENABLED (1): Sets enabled=True (user must push to set code on lock)
        - DISABLED (2): Sets enabled=False (user must push to clear code from lock)
        - AVAILABLE (0): Not valid for cached status (this is what lock returns when cleared)
        """
        slot_str = str(slot)
        if slot_str not in self._user_data["users"]:
            raise ValueError(f"User slot {slot} not found")
        
        user_data = self._user_data["users"][slot_str]
        
        # Map status to enabled flag
        # Note: AVAILABLE (0) is not a settable cached status - it's what the lock returns when cleared
        # When disabled, cached status = DISABLED (2), lock status = AVAILABLE (0)
        if status == USER_STATUS_ENABLED:
            user_data["enabled"] = True
            user_data["lock_status"] = USER_STATUS_ENABLED
        elif status == USER_STATUS_DISABLED:
            user_data["enabled"] = False
            user_data["lock_status"] = USER_STATUS_DISABLED
        elif status == USER_STATUS_AVAILABLE:
            # AVAILABLE is not a valid cached status - treat as DISABLED
            # (Lock returns AVAILABLE when code is cleared, but we track it as DISABLED in cache)
            user_data["enabled"] = False
            user_data["lock_status"] = USER_STATUS_DISABLED
        else:
            raise ValueError(f"Invalid status: {status}. Must be 0, 1, or 2")
        
        # Recalculate sync status based on new approach
        cached_enabled = user_data["enabled"]
        should_be_enabled = cached_enabled and self._is_code_valid(slot)
        lock_status = user_data.get("lock_status_from_lock")
        lock_code = user_data.get("lock_code", "")
        
        if should_be_enabled:
            # Should be enabled: code must exist and match
            user_data["synced_to_lock"] = (
                lock_status == USER_STATUS_ENABLED and
                user_data.get("code", "") == lock_code and
                user_data.get("code", "") != ""
            )
        else:
            # Should be disabled: code must NOT exist
            user_data["synced_to_lock"] = (
                lock_status == USER_STATUS_AVAILABLE or
                lock_code == ""
            )
        
        await self.async_save_user_data()
        await self.async_request_refresh()
        
        _LOGGER.info("Set cached status for slot %s: %s (enabled=%s, synced=%s)", 
                     slot, status, user_data["enabled"], user_data["synced_to_lock"])

    async def async_set_user_schedule(
        self,
        slot: int,
        start_datetime: str | None,
        end_datetime: str | None,
    ) -> None:
        """Set schedule for a user code."""
        if str(slot) not in self._user_data["users"]:
            raise ValueError(f"User slot {slot} not found")

        self._user_data["users"][str(slot)]["schedule"] = {
            "start": start_datetime,
            "end": end_datetime,
        }
        await self.async_save_user_data()
        await self.async_request_refresh()  # Refresh entity state so card updates

    async def async_set_usage_limit(self, slot: int, max_uses: int | None) -> None:
        """Set usage limit for a user code."""
        if str(slot) not in self._user_data["users"]:
            raise ValueError(f"User slot {slot} not found")

        self._user_data["users"][str(slot)]["usage_limit"] = max_uses
        await self.async_save_user_data()
        await self.async_request_refresh()  # Refresh entity state so card updates

    async def async_reset_usage_count(self, slot: int) -> None:
        """Reset usage count for a user code back to 0."""
        if str(slot) not in self._user_data["users"]:
            raise ValueError(f"User slot {slot} not found")

        self._user_data["users"][str(slot)]["usage_count"] = 0
        await self.async_save_user_data()
        
        # Re-enable the user if they were disabled due to usage limit
        user_data = self._user_data["users"][str(slot)]
        if not user_data.get("enabled", False):
            await self.async_enable_user(slot)

    async def async_push_code_to_lock(self, slot: int) -> None:
        """Push a code to the lock - set if enabled, clear if disabled."""
        user_data = self._user_data["users"].get(str(slot))
        if not user_data:
            raise ValueError(f"User slot {slot} not found")

        code_type = user_data.get("code_type", CODE_TYPE_PIN)
        
        # FOBs are added directly to the lock, so we don't push them
        if code_type == CODE_TYPE_FOB:
            _LOGGER.info("FOB/RFID cards are added directly to the lock - no push needed for slot %s", slot)
            user_data["synced_to_lock"] = True
            await self.async_save_user_data()
            await self.async_request_refresh()
            return

        code = user_data["code"]
        enabled = user_data["enabled"]
        
        # Determine if code should be on lock based on enabled flag and schedule
        should_be_on_lock = enabled and self._is_code_valid(slot)
        
        try:
            if should_be_on_lock:
                # Code should be on lock - set it
                if not code:
                    raise ValueError(f"Cannot set empty code for slot {slot}")
                
                self._logger.info_operation("Setting code on lock", slot, code="***")
                await self._zwave_client.set_user_code(slot, code)
                
                # Wait for lock to process
                await asyncio.sleep(5.0)
                
                # Verify code was set
                verification_data = await self._zwave_client.get_user_code_data(slot)
                if verification_data:
                    verification_code = str(verification_data.get("userCode", ""))
                    verification_status = int(verification_data.get("userIdStatus", 0))
                    
                    if verification_code == code:
                        _LOGGER.info("✓ Code successfully set on lock for slot %s", slot)
                        user_data["lock_code"] = verification_code
                        user_data["lock_status_from_lock"] = verification_status
                        user_data["lock_enabled"] = (verification_status == USER_STATUS_ENABLED)
                        user_data["synced_to_lock"] = True
                    else:
                        _LOGGER.warning(
                            "Code mismatch after set for slot %s: expected '%s', got '%s'",
                            slot, code, verification_code
                        )
                        user_data["lock_code"] = verification_code
                        user_data["lock_status_from_lock"] = verification_status
                        user_data["lock_enabled"] = (verification_status == USER_STATUS_ENABLED)
                        user_data["synced_to_lock"] = False
                else:
                    _LOGGER.warning("Could not verify code set for slot %s", slot)
                    user_data["synced_to_lock"] = False
            else:
                # Code should NOT be on lock - clear it
                # When disabled: cached status = DISABLED (2), lock status = AVAILABLE (0)
                self._logger.info_operation("Clearing code from lock", slot)
                await self._zwave_client.clear_user_code(slot)
                
                # Wait for lock to process
                await asyncio.sleep(3.0)
                
                # Verify code was cleared
                verification_data = await self._zwave_client.get_user_code_data(slot)
                if verification_data:
                    verification_code = str(verification_data.get("userCode", ""))
                    verification_status = int(verification_data.get("userIdStatus", 0))
                    
                    if verification_status == USER_STATUS_AVAILABLE or not verification_code:
                        _LOGGER.info("✓ Code successfully cleared from lock for slot %s", slot)
                        user_data["lock_code"] = ""
                        user_data["lock_status_from_lock"] = USER_STATUS_AVAILABLE  # Lock shows Available
                        user_data["lock_status"] = USER_STATUS_DISABLED  # Cached status is Disabled
                        user_data["lock_enabled"] = False
                        user_data["synced_to_lock"] = True
                    else:
                        _LOGGER.warning(
                            "Code not cleared for slot %s: status=%s, code='%s'",
                            slot, verification_status, verification_code
                        )
                        user_data["lock_code"] = verification_code
                        user_data["lock_status_from_lock"] = verification_status
                        user_data["lock_enabled"] = (verification_status == USER_STATUS_ENABLED)
                        user_data["synced_to_lock"] = False
                else:
                    _LOGGER.warning("Could not verify code cleared for slot %s", slot)
                    user_data["lock_status_from_lock"] = USER_STATUS_AVAILABLE
                    user_data["lock_status"] = USER_STATUS_DISABLED
                    user_data["synced_to_lock"] = False
            
            await self.async_save_user_data()
            _LOGGER.info("User data saved after push for slot %s", slot)
            
            # Update entity state
            self.data["last_user_update"] = datetime.now().isoformat()
            self.async_update_listeners()
            if self._lock_entity:
                self.hass.loop.call_later(0.2, self._lock_entity.async_write_ha_state)
                _LOGGER.debug("Entity state write scheduled after push")
            else:
                _LOGGER.warning("Lock entity not registered - cannot update entity state")
            
        except Exception as err:
            _LOGGER.error("Failed to push code to lock for slot %s: %s", slot, err, exc_info=True)
            user_data["synced_to_lock"] = False
            await self.async_save_user_data()
            raise

    async def async_pull_codes_from_lock(self) -> None:
        """Pull all codes from the lock and update our data."""
        _LOGGER.info("=== REFRESH: Pulling codes from lock - scanning all %s slots ===", MAX_USER_SLOTS)
        
        # Fire start event
        self._fire_event(EVENT_REFRESH_PROGRESS, {
            "action": "start",
            "total_slots": MAX_USER_SLOTS,
            "current_slot": 0,
            "codes_found": 0,
            "codes_new": 0,
            "codes_updated": 0,
        })
        
        codes_found = 0
        codes_updated = 0
        codes_new = 0

        for slot in range(1, MAX_USER_SLOTS + 1):
            _LOGGER.debug("Checking slot %s...", slot)
            
            # Fire progress event before processing slot
            self._fire_event(EVENT_REFRESH_PROGRESS, {
                "action": "progress",
                "total_slots": MAX_USER_SLOTS,
                "current_slot": slot,
                "codes_found": codes_found,
                "codes_new": codes_new,
                "codes_updated": codes_updated,
            })
            
            # Use _get_user_code_data to get both status and code in one call
            data = await self._get_user_code_data(slot)
            
            if not data:
                _LOGGER.debug("Slot %s - No data returned (empty or timeout)", slot)
                continue
            
            status = data.get("userIdStatus")
            code = data.get("userCode", "")
            
            # Convert code to string if it's not already
            if code is not None:
                code = str(code)
            else:
                code = ""
            
            _LOGGER.debug("Slot %s - Status: %s, Code: %s", slot, status, "***" if code else "None")

            # Convert status to int for comparison
            status_int = int(status) if status is not None else USER_STATUS_AVAILABLE
            
            slot_str = str(slot)
            
            # Check if we already have this slot
            if slot_str in self._user_data["users"]:
                user_data = self._user_data["users"][slot_str]
                cached_code_type = user_data.get("code_type", CODE_TYPE_PIN)
                
                # If slot is marked as FOB in cache, check if lock has PIN
                if cached_code_type == CODE_TYPE_FOB:
                    # If lock has no PIN (AVAILABLE or no code), skip overwriting
                    if status_int == USER_STATUS_AVAILABLE or not code:
                        _LOGGER.debug("Slot %s: Marked as FOB, lock has no PIN - skipping overwrite", slot)
                        # Still update lock_code and lock_status_from_lock for reference
                        user_data["lock_code"] = ""
                        user_data["lock_status_from_lock"] = status_int
                        user_data["lock_enabled"] = False
                        # Recalculate sync status (FOBs are always synced)
                        user_data["synced_to_lock"] = True
                        continue  # Skip the overwrite logic
                    
                    # If lock has a PIN (ENABLED with code), it was changed from FOB to PIN on lock
                    if status_int == USER_STATUS_ENABLED and code:
                        _LOGGER.info("Slot %s: Marked as FOB but lock has PIN - updating to PIN type", slot)
                        # Update code_type to PIN and proceed with normal overwrite logic
                        user_data["code_type"] = CODE_TYPE_PIN
                        # Continue with normal PIN overwrite logic below
                
                # Update lock state
                user_data["lock_code"] = code if code else ""
                user_data["lock_status_from_lock"] = status_int
                user_data["lock_enabled"] = (status_int == USER_STATUS_ENABLED)
                
                # PIN Overwrite Logic (only for PIN slots, or FOB slots that were changed to PIN):
                # - If status = ENABLED (1) AND code exists: Overwrite cached PIN
                # - If status = AVAILABLE (0) OR DISABLED (2): Preserve cached PIN
                if status_int == USER_STATUS_ENABLED and code:
                    # Lock is enabled with code - overwrite cached PIN (code was added directly to lock)
                    old_code = user_data.get("code", "")
                    if old_code != code:
                        _LOGGER.info(
                            "Slot %s: Lock enabled with code, overwriting cached PIN (old: '%s', new: '%s')",
                            slot, "***" if old_code else "None", "***" if code else "None"
                        )
                        user_data["code"] = code
                    else:
                        _LOGGER.debug("Slot %s: Lock enabled, cached PIN matches lock code", slot)
                    codes_found += 1
                    codes_updated += 1
                elif status_int == USER_STATUS_AVAILABLE:
                    # Lock is available (cleared) - update cache to reflect cleared state
                    if not code or code == "":
                        # Lock is cleared (no code) - clear cached PIN and set status to DISABLED
                        old_cached_code = user_data.get("code", "")
                        if old_cached_code:
                            _LOGGER.info(
                                "Slot %s: Lock cleared (AVAILABLE, no code), clearing cached PIN '%s' and setting status to DISABLED",
                                slot, "***" if old_cached_code else "None"
                            )
                            user_data["code"] = ""  # Clear cached PIN
                            user_data["lock_status"] = USER_STATUS_DISABLED  # Set cached status to DISABLED
                        else:
                            _LOGGER.debug("Slot %s: Lock is AVAILABLE, cached PIN already empty", slot)
                            # Ensure cached status is DISABLED if not already set
                            if user_data.get("lock_status") != USER_STATUS_DISABLED:
                                user_data["lock_status"] = USER_STATUS_DISABLED
                    else:
                        # Lock is AVAILABLE but has a code (shouldn't happen, but handle it)
                        _LOGGER.warning("Slot %s: Lock status is AVAILABLE but has code '%s'", slot, "***" if code else "None")
                    codes_updated += 1
                elif status_int == USER_STATUS_DISABLED:
                    # Lock is disabled (but has code) - preserve cached PIN and status
                    _LOGGER.debug(
                        "Slot %s: Lock status=DISABLED, preserving cached PIN '%s' and cached status",
                        slot, "***" if user_data.get("code") else "None"
                    )
                    # Update lock_status_from_lock but preserve cached lock_status
                    if code:
                        codes_found += 1
                        codes_updated += 1
                else:
                    # Unknown status
                    _LOGGER.warning("Slot %s: Unknown status %s", slot, status_int)
                
                # Recalculate sync status
                cached_enabled = user_data.get("enabled", False)
                should_be_enabled = cached_enabled and self._is_code_valid(slot)
                lock_is_enabled = (status_int == USER_STATUS_ENABLED)
                
                # Synced if: code matches AND enabled state matches
                cached_code = user_data.get("code", "")
                if should_be_enabled:
                    # Should be enabled: code must exist and match
                    user_data["synced_to_lock"] = (
                        lock_is_enabled and
                        cached_code == code and
                        cached_code != ""
                    )
                else:
                    # Should be disabled: code must NOT exist
                    user_data["synced_to_lock"] = (
                        status_int == USER_STATUS_AVAILABLE or
                        code == ""
                    )
                
                _LOGGER.info("Slot %s updated - Cached: %s, Lock: %s, Synced: %s", 
                           slot, "***" if cached_code else "None", 
                           "***" if code else "None", user_data["synced_to_lock"])
            else:
                # New slot found on lock
                if status_int == USER_STATUS_AVAILABLE:
                    # Slot is empty - skip
                    _LOGGER.debug("Slot %s is empty (AVAILABLE)", slot)
                    continue
                
                codes_found += 1
                _LOGGER.info("Slot %s is NEW (unknown code detected, status: %s)", slot, status_int)
                
                # Try to determine if it's a FOB
                code_type = CODE_TYPE_PIN
                if code and (not code.isdigit() or len(code) < 4):
                    code_type = CODE_TYPE_FOB
                    _LOGGER.debug("Detected as FOB based on code format")

                # For new slots, use code from lock as cached code
                self._user_data["users"][slot_str] = {
                    "name": f"User {slot}",
                    "code_type": code_type,
                    "code": code if code else "",  # Use code from lock for new slots
                    "lock_code": code if code else "",
                    "enabled": (status_int == USER_STATUS_ENABLED),
                    "lock_status": status_int,
                    "lock_status_from_lock": status_int,
                    "lock_enabled": (status_int == USER_STATUS_ENABLED),
                    "schedule": {"start": None, "end": None},
                    "usage_limit": None,
                    "usage_count": 0,
                    "synced_to_lock": True,  # New codes are synced by definition
                    "last_used": None,
                }
                codes_new += 1
                _LOGGER.info("Added slot %s as '%s' (%s)", slot, f"User {slot}", code_type)

        _LOGGER.info(
            "Pull complete: Found %s codes (%s new, %s updated)", 
            codes_found, 
            codes_new, 
            codes_updated
        )
        
        # Log user data state before save
        total_users_in_memory = len(self._user_data["users"])
        _LOGGER.info("[REFRESH DEBUG] User data in memory: %s users", total_users_in_memory)
        for slot_str, user_data in self._user_data["users"].items():
            _LOGGER.debug("[REFRESH DEBUG] Slot %s: name=%s, lock_status=%s, lock_code=%s", 
                         slot_str, user_data.get("name"), 
                         user_data.get("lock_status"), 
                         "***" if user_data.get("lock_code") else "None")

        # Fire complete event
        self._fire_event(EVENT_REFRESH_PROGRESS, {
            "action": "complete",
            "total_slots": MAX_USER_SLOTS,
            "current_slot": MAX_USER_SLOTS,
            "codes_found": codes_found,
            "codes_new": codes_new,
            "codes_updated": codes_updated,
        })

        _LOGGER.info("[REFRESH DEBUG] Saving user data to storage...")
        await self.async_save_user_data()
        _LOGGER.info("[REFRESH DEBUG] User data saved to storage")
        
        # Update coordinator.data to trigger coordinator update cycle
        if self.data:
            self.data["last_user_update"] = datetime.now().isoformat()
            _LOGGER.debug("[REFRESH DEBUG] Updated coordinator.data with timestamp: %s", self.data["last_user_update"])
        
        # Trigger listeners to notify CoordinatorEntity
        self.async_update_listeners()
        _LOGGER.debug("[REFRESH DEBUG] Coordinator listeners updated")
        
        # Schedule async_write_ha_state() to ensure state is written
        # The new dict copy in extra_state_attributes will be detected as changed
        if self._lock_entity:
            _LOGGER.debug("[REFRESH DEBUG] Scheduling entity state write in 0.2 seconds...")
            
            @callback
            def _write_state_callback():
                """Callback to write entity state after delay."""
                _LOGGER.debug("[REFRESH DEBUG] Writing entity state to notify frontend...")
                self._lock_entity.async_write_ha_state()
                _LOGGER.debug("[REFRESH DEBUG] Entity state written")
            
            # Use hass.loop.call_later() to schedule the callback
            self.hass.loop.call_later(0.2, _write_state_callback)
            _LOGGER.debug("[REFRESH DEBUG] Entity state write scheduled")

    async def async_check_sync_status(self, slot: int) -> None:
        """Check sync status for a specific slot by querying the lock and comparing.
        
        This queries the lock to get the current lock PIN/status, then compares
        with the cached values to update the sync status.
        """
        _LOGGER.info("Checking sync status for slot %s...", slot)
        
        slot_str = str(slot)
        if slot_str not in self._user_data["users"]:
            _LOGGER.warning("Slot %s not found in user data", slot)
            return
        
        user_data = self._user_data["users"][slot_str]
        
        # Query the lock to get current lock PIN and status
        lock_data = await self._get_user_code_data(slot)
        
        if not lock_data:
            _LOGGER.warning("Could not retrieve lock data for slot %s", slot)
            # If we can't get lock data, assume not synced
            user_data["synced_to_lock"] = False
            await self.async_save_user_data()
            await self.async_request_refresh()
            return
        
        lock_status = lock_data.get("userIdStatus")
        lock_code = lock_data.get("userCode", "")
        if lock_code is not None:
            lock_code = str(lock_code)
        else:
            lock_code = ""
        
        # Use sync manager to update sync status
        lock_data_for_sync = {"userIdStatus": lock_status, "userCode": lock_code}
        self._sync_manager.update_sync_status(user_data, lock_data_for_sync)
        
        self._logger.info_operation(
            "Sync check completed",
            slot,
            synced=user_data["synced_to_lock"],
            cached_code="***" if user_data.get("code") else "None",
            lock_code="***" if lock_code else "None",
        )
        
        await self.async_save_user_data()
        await self.async_request_refresh()
        
        _LOGGER.info("Sync status updated for slot %s: %s", slot, user_data["synced_to_lock"])

    async def async_load_user_data(self) -> None:
        """Load user data from storage."""
        await self._storage.load()

    async def async_save_user_data(self) -> None:
        """Save user data to storage."""
        await self._storage.save()

    async def async_clear_local_cache(self) -> None:
        """Clear all local user data cache."""
        await self._storage.clear()
        await self.async_request_refresh()

    @property
    def user_data(self) -> dict[str, Any]:
        """Get user data."""
        return self._storage.data

    def get_user(self, slot: int) -> dict[str, Any] | None:
        """Get user data for a specific slot."""
        return self._storage.get_user(slot)

    def get_all_users(self) -> dict[str, Any]:
        """Get all users."""
        users = self._storage.get_all_users()
        self._logger.debug_refresh("get_all_users() called", users_count=len(users))
        return users
