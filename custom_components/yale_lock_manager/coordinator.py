"""Data coordinator for Yale Lock Manager."""
from __future__ import annotations

import asyncio
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

        # For FOBs, code can be empty or short
        if code_type == CODE_TYPE_FOB:
            # FOBs don't need a PIN code, use placeholder
            if not code or len(code) < 4:
                code = "00000000"  # 8-digit placeholder for FOBs
        else:
            # For PINs, validate code length
            if not code or len(code) < 4:
                raise ValueError("PIN code must be at least 4 digits")

        # Check if slot exists in local storage
        if existing_user:
            _LOGGER.debug(
                "Slot %s already in local storage: name=%s, enabled=%s", 
                slot, existing_user.get("name"), existing_user.get("enabled")
            )

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

        # Calculate sync status: compare NEW cached code/status with EXISTING lock code/status
        if code_type == CODE_TYPE_PIN:
            codes_match = (code == lock_code) if lock_code else False
            # Compare cached status with lock status
            if lock_status_from_lock is not None:
                status_match = (lock_status == lock_status_from_lock)
            else:
                # If we don't have lock status, assume not synced
                status_match = False
            synced_to_lock = codes_match and status_match
            _LOGGER.info("Slot %s sync calculation - Cached code: %s, Lock code: %s, Codes match: %s, Status match: %s, Synced: %s",
                        slot, "***" if code else "None", "***" if lock_code else "None", codes_match, status_match, synced_to_lock)
        else:
            # For FOBs, sync is based on status only
            if lock_status_from_lock is not None:
                synced_to_lock = (lock_status == lock_status_from_lock)
            else:
                synced_to_lock = False
        
        self._user_data["users"][str(slot)] = {
            "name": name,
            "code_type": code_type,
            "code": code,  # Cached code (editable) - this is the NEW code from the form
            "lock_code": lock_code,  # PIN from lock (read-only, updated from query above)
            "enabled": lock_status == USER_STATUS_ENABLED,  # Derived from cached status
            "lock_status": lock_status,  # Store cached status (editable)
            "lock_status_from_lock": lock_status_from_lock,  # Store actual status from lock (read-only, updated from query above)
            "lock_enabled": lock_enabled,  # Enabled status from lock (for compatibility)
            "schedule": schedule if code_type == CODE_TYPE_PIN else {"start": None, "end": None},
            "usage_limit": usage_limit if code_type == CODE_TYPE_PIN else None,
            "usage_count": usage_count if code_type == CODE_TYPE_PIN else 0,
            "synced_to_lock": synced_to_lock,  # Calculated based on code and status comparison
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
        """Clear a user code from storage and lock with verification.
        
        This clears the PIN on the lock and sets status to Available for both cached and lock.
        """
        # Clear from lock using invoke_cc_api
        try:
            _LOGGER.info("Clearing slot %s from lock...", slot)
            
            await self.hass.services.async_call(
                ZWAVE_JS_DOMAIN,
                "invoke_cc_api",
                {
                    "entity_id": self.lock_entity_id,
                    "command_class": CC_USER_CODE,
                    "method_name": "clear",
                    "parameters": [slot],
                },
                blocking=True,
            )
            
            # Wait for lock to process the clear operation
            await asyncio.sleep(2.0)
            
            # VERIFY: Read back the status to confirm it's cleared
            _LOGGER.info("Verifying slot %s was cleared...", slot)
            verification_status = await self._get_user_code_status(slot)
            
            if verification_status == USER_STATUS_AVAILABLE or verification_status is None:
                _LOGGER.info("✓ Verified: Slot %s successfully cleared", slot)
                
                # Update storage: set status to Available for both cached and lock
                slot_str = str(slot)
                if slot_str in self._user_data["users"]:
                    # Update existing entry
                    self._user_data["users"][slot_str].update({
                        "code": "",  # Clear cached PIN
                        "lock_code": "",  # Clear lock PIN
                        "lock_status": USER_STATUS_AVAILABLE,  # Set cached status to Available
                        "lock_status_from_lock": USER_STATUS_AVAILABLE,  # Set lock status to Available
                        "lock_enabled": False,
                        "enabled": False,
                        "synced_to_lock": True,  # Both are Available, so synced
                    })
                else:
                    # Create new entry with Available status
                    self._user_data["users"][slot_str] = {
                        "name": f"User {slot}",
                        "code_type": CODE_TYPE_PIN,
                        "code": "",  # No cached PIN
                        "lock_code": "",  # No lock PIN
                        "lock_status": USER_STATUS_AVAILABLE,  # Cached status: Available
                        "lock_status_from_lock": USER_STATUS_AVAILABLE,  # Lock status: Available
                        "lock_enabled": False,
                        "enabled": False,
                        "schedule": {"start": None, "end": None},
                        "usage_limit": None,
                        "usage_count": 0,
                        "synced_to_lock": True,  # Both are Available, so synced
                        "last_used": None,
                    }
                
                await self.async_save_user_data()
                await self.async_request_refresh()
            else:
                _LOGGER.warning("⚠️ Slot %s may not be fully cleared (status: %s)", slot, verification_status)
                # Don't raise error - just log warning and continue
                
        except Exception as err:
            _LOGGER.error("Error clearing slot %s from lock: %s", slot, err)
            # Don't raise - allow storage clear to complete
        
        await self.async_request_refresh()

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
        """Set user status (0=Available, 1=Enabled, 2=Disabled)."""
        slot_str = str(slot)
        if slot_str not in self._user_data["users"]:
            raise ValueError(f"User slot {slot} not found")
        
        user_data = self._user_data["users"][slot_str]
        user_data["lock_status"] = status  # Store cached status (editable)
        user_data["enabled"] = (status == USER_STATUS_ENABLED)  # For backward compatibility
        
        # Check if status matches lock status
        lock_status = user_data.get("lock_status_from_lock")
        if lock_status is not None:
            user_data["synced_to_lock"] = (status == lock_status)
        else:
            user_data["synced_to_lock"] = False  # Unknown lock status, assume not synced
        
        await self.async_save_user_data()
        await self.async_request_refresh()
        
        _LOGGER.info("Set cached status for slot %s: %s (lock_status=%s, synced=%s)", 
                     slot, status, lock_status, user_data["synced_to_lock"])

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
        """Push a code to the lock using invoke_cc_api with read-back verification."""
        user_data = self._user_data["users"].get(str(slot))
        if not user_data:
            raise ValueError(f"User slot {slot} not found")

        code_type = user_data.get("code_type", CODE_TYPE_PIN)
        
        # FOBs are added directly to the lock, so we don't push them
        if code_type == CODE_TYPE_FOB:
            _LOGGER.info("FOB/RFID cards are added directly to the lock - no push needed for slot %s", slot)
            # Just update sync status to True since FOBs don't need syncing
            user_data["synced_to_lock"] = True
            await self.async_save_user_data()
            await self.async_request_refresh()
            return

        code = user_data["code"]
        enabled = user_data["enabled"]

        # Determine status based on enabled flag and schedule
        if enabled and self._is_code_valid(slot):
            status = USER_STATUS_ENABLED
        else:
            status = USER_STATUS_DISABLED

        # Use Z-Wave client to set the code
        try:
            self._logger.info_operation("Pushing code to lock", slot, code_type=code_type, status=status)
            
            await self._zwave_client.set_user_code(slot, code, status)
            _LOGGER.info("Code write command sent to lock for slot %s, waiting for lock to process...", slot)
            
            # Wait for lock to process the write
            # Some locks can take 5-10 seconds to write a code to memory
            # We'll wait 3 seconds initially, then verify with retries
            await asyncio.sleep(3.0)
            
            # VERIFY: Read back the code from the lock using _get_user_code_data to get both status and code
            # Retry verification up to 3 times with delays, as locks can be slow to write
            verification_data = None
            max_retries = 3
            retry_delay = 2.0
            
            for attempt in range(1, max_retries + 1):
                self._logger.info_operation(f"Verifying code was written (attempt {attempt}/{max_retries})", slot)
                verification_data = await self._zwave_client.get_user_code_data(slot)
                
                if verification_data:
                    verification_code = verification_data.get("userCode", "")
                    if verification_code:
                        verification_code = str(verification_code)
                    else:
                        verification_code = ""
                    
                    # Check if we got the code we expect
                    if verification_code == code:
                        _LOGGER.info("✓ Verification successful on attempt %s - code matches!", attempt)
                        break  # Success - exit retry loop
                    else:
                        _LOGGER.info("Verification attempt %s: Lock returned code '%s', expected '%s'", 
                                    attempt, verification_code, code)
                        if attempt < max_retries:
                            _LOGGER.info("Lock may still be processing - waiting %s seconds before retry...", retry_delay)
                            await asyncio.sleep(retry_delay)
                else:
                    _LOGGER.warning("Verification attempt %s: No data returned from lock", attempt)
                    if attempt < max_retries:
                        _LOGGER.info("Waiting %s seconds before retry...", retry_delay)
                        await asyncio.sleep(retry_delay)
            
            if not verification_data:
                _LOGGER.warning("Could not verify slot %s after %s attempts - no data returned", slot, max_retries)
                user_data["synced_to_lock"] = False
            else:
                verification_status = verification_data.get("userIdStatus")
                verification_code = verification_data.get("userCode", "")
                
                if verification_code:
                    verification_code = str(verification_code)
                else:
                    verification_code = ""
                
                # Check if verification succeeded
                if verification_status is None:
                    _LOGGER.warning("Could not verify slot %s - status read returned None", slot)
                    user_data["synced_to_lock"] = False
                elif verification_status == USER_STATUS_AVAILABLE:
                    _LOGGER.error("Verification failed: Slot %s is empty after push!", slot)
                    user_data["synced_to_lock"] = False
                    raise ValueError(f"Verification failed: Slot {slot} is empty after push")
                elif verification_code and verification_code != code:
                    # After retries, code still doesn't match - this is a real error
                    _LOGGER.error("Verification failed after %s attempts: Code mismatch in slot %s (expected: %s, got: %s)", 
                                max_retries, slot, code, verification_code)
                    # Still update lock_code with what we got from the lock (might be old value)
                    user_data["lock_code"] = verification_code
                    user_data["lock_status_from_lock"] = verification_status
                    user_data["lock_enabled"] = verification_status == USER_STATUS_ENABLED
                    user_data["synced_to_lock"] = False
                    raise ValueError(f"Verification failed: Code mismatch in slot {slot} after {max_retries} attempts")
                else:
                    # Verification succeeded! Update lock fields with pulled data
                    _LOGGER.info("✓ Verified: Code successfully written to slot %s", slot)
                    user_data["lock_code"] = verification_code  # Update lock_code from lock
                    user_data["lock_status_from_lock"] = verification_status  # Update lock_status_from_lock
                    user_data["lock_enabled"] = verification_status == USER_STATUS_ENABLED  # Update lock_enabled
                    
                    # Use sync manager to recalculate sync status after pull
                    lock_data_for_sync = {"userIdStatus": verification_status, "userCode": verification_code}
                    self._sync_manager.update_sync_status(user_data, lock_data_for_sync)
                    
                    self._logger.info_operation(
                        "Sync after push",
                        slot,
                        synced=user_data["synced_to_lock"],
                        cached_code="***" if user_data.get("code") else "None",
                        lock_code="***" if verification_code else "None",
                    )
                    
                    # Log the actual lock_code value for debugging (unmasked in logs)
                    _LOGGER.info("Push verified - lock_code set to: %s (cached_code: %s)", 
                                verification_code, user_data.get("code", ""))
                    
                    # Verify lock_code is actually set in user_data
                    _LOGGER.info("After verification - user_data lock_code: %s", user_data.get("lock_code", "NOT SET"))
            
            await self.async_save_user_data()
            _LOGGER.info("User data saved after push for slot %s", slot)
            
            # Verify the data is in storage
            slot_str = str(slot)
            stored_user = self._storage.get_user(slot)
            if stored_user:
                _LOGGER.info("After save - stored lock_code: %s", stored_user.get("lock_code", "NOT SET"))
            else:
                _LOGGER.warning("After save - user not found in storage for slot %s", slot)
            
            # Add a small delay to ensure storage write is complete
            await asyncio.sleep(0.1)
            
            # CRITICAL: Update entity state directly without triggering a full pull
            # A full pull might overwrite lock_code with stale data or cause timing issues
            # Update coordinator.data to trigger state change notification
            if self.data:
                self.data["last_user_update"] = datetime.now().isoformat()
                _LOGGER.debug("Updated coordinator.data with timestamp: %s", self.data["last_user_update"])
            
            # Verify what get_all_users() will return
            all_users = self.get_all_users()
            slot_user = all_users.get(slot_str)
            if slot_user:
                _LOGGER.info("Before entity write - get_all_users() lock_code: %s", slot_user.get("lock_code", "NOT SET"))
            else:
                _LOGGER.warning("Before entity write - user not found in get_all_users() for slot %s", slot)
            
            # Schedule async_write_ha_state() to ensure it happens after the save is fully processed
            # This ensures Home Assistant has time to process the state change
            if self._lock_entity:
                _LOGGER.debug("Scheduling entity state write in 0.2 seconds after push...")
                
                @callback
                def _write_state_callback():
                    """Callback to write entity state after delay."""
                    _LOGGER.debug("Writing entity state to notify frontend after push...")
                    # Force entity state write - this should trigger frontend notification
                    self._lock_entity.async_write_ha_state()
                    _LOGGER.info("Entity state written after push for slot %s", slot)
                    
                    # Also trigger a coordinator update to ensure state change is broadcast
                    # This helps ensure Home Assistant notifies the frontend
                    self.async_update_listeners()
                    _LOGGER.debug("Coordinator listeners updated after push")
                
                # Use hass.loop.call_later() to schedule the callback
                self.hass.loop.call_later(0.2, _write_state_callback)
                _LOGGER.debug("Entity state write scheduled after push")
            else:
                _LOGGER.warning("Lock entity not registered - cannot update entity state")
            
        except Exception as err:
            _LOGGER.error("Failed to push code for slot %s: %s", slot, err)
            user_data["synced_to_lock"] = False
            await self.async_save_user_data()
            raise ValueError(f"Failed to push code to lock: {err}") from err

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

            if status == USER_STATUS_AVAILABLE or status is None:
                # Slot is empty
                _LOGGER.debug("Slot %s is empty", slot)
                continue

            codes_found += 1
            _LOGGER.info("Found code in slot %s (Status: %s)", slot, status)

            # Check if we already have this slot
            slot_str = str(slot)
            if slot_str in self._user_data["users"]:
                # Update existing - store lock_code and check sync status
                user_data = self._user_data["users"][slot_str]
                user_data["lock_code"] = code if code else ""  # Store PIN from lock
                user_data["lock_status_from_lock"] = status  # Store status from lock (read-only)
                # Preserve cached status if it exists, otherwise set it to match lock
                if "lock_status" not in user_data or user_data.get("lock_status") is None:
                    user_data["lock_status"] = status  # Initialize cached status from lock
                user_data["lock_enabled"] = status == USER_STATUS_ENABLED  # Store enabled status from lock (for compatibility)
                
                # Use sync manager to update sync status
                lock_data_for_sync = {"userIdStatus": status, "userCode": code}
                self._sync_manager.update_sync_status(user_data, lock_data_for_sync)
                
                _LOGGER.info("Slot %s updated - Cached: %s, Lock: %s, Synced: %s", 
                           slot, "***" if user_data.get("code") else "None", 
                           "***" if code else "None", user_data["synced_to_lock"])
                codes_updated += 1
            else:
                # New code we don't know about
                _LOGGER.info("Slot %s is NEW (unknown code detected)", slot)
                
                # Try to determine if it's a FOB
                code_type = CODE_TYPE_PIN
                if code and (not code.isdigit() or len(code) < 4):
                    code_type = CODE_TYPE_FOB
                    _LOGGER.debug("Detected as FOB based on code format")

                self._user_data["users"][slot_str] = {
                    "name": f"User {slot}",
                    "code_type": code_type,
                    "code": code if code else "",  # Cached code (same as lock for new codes)
                    "lock_code": code if code else "",  # PIN from lock
                    "enabled": status == USER_STATUS_ENABLED,
                    "lock_status": status,  # Store full status (0=Available, 1=Enabled, 2=Disabled)
                    "lock_enabled": status == USER_STATUS_ENABLED,  # Enabled status from lock (for compatibility)
                    "schedule": {"start": None, "end": None},
                    "usage_limit": None,
                    "usage_count": 0,
                    "synced_to_lock": True,  # New codes are synced by default
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
        
        _LOGGER.info("[REFRESH DEBUG] Requesting coordinator refresh (triggers _async_update_data)...")
        await self.async_request_refresh()
        _LOGGER.info("[REFRESH DEBUG] Coordinator refresh requested")
        
        # Add a small delay to ensure the refresh has been processed
        await asyncio.sleep(0.1)
        _LOGGER.debug("[REFRESH DEBUG] Delay completed, updating coordinator.data to trigger state change...")
        
        # Update coordinator.data to trigger state change notification
        # CoordinatorEntity only writes state when coordinator.data changes,
        # but extra_state_attributes reads from _user_data which is separate
        if self.data:
            self.data["last_user_update"] = datetime.now().isoformat()
            _LOGGER.debug("[REFRESH DEBUG] Updated coordinator.data with timestamp: %s", self.data["last_user_update"])
        
        # Schedule async_write_ha_state() to ensure it happens after the refresh is fully processed
        # This ensures Home Assistant has time to process the state change
        if self._lock_entity:
            _LOGGER.debug("[REFRESH DEBUG] Scheduling entity state write in 0.2 seconds...")
            
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
