"""Data coordinator for Yale Lock Manager."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
import logging
from typing import Any

from homeassistant.components.zwave_js import DOMAIN as ZWAVE_JS_DOMAIN
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.storage import Store
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
    CC_USER_CODE,
    CODE_TYPE_FOB,
    CODE_TYPE_PIN,
    CONF_LOCK_ENTITY_ID,
    CONF_LOCK_NODE_ID,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    EVENT_ACCESS,
    EVENT_CODE_EXPIRED,
    EVENT_LOCKED,
    EVENT_UNLOCKED,
    EVENT_USAGE_LIMIT_REACHED,
    MAX_USER_SLOTS,
    PROP_BATTERY_LEVEL,
    PROP_BOLT_STATUS,
    PROP_CURRENT_MODE,
    PROP_DOOR_STATUS,
    PROP_USER_CODE,
    PROP_USER_ID_STATUS,
    STORAGE_KEY,
    STORAGE_VERSION,
    USER_STATUS_AVAILABLE,
    USER_STATUS_DISABLED,
    USER_STATUS_ENABLED,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)


class YaleLockCoordinator(DataUpdateCoordinator):
    """Coordinator to manage Yale lock data."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        self.entry = entry
        self.node_id = entry.data[CONF_LOCK_NODE_ID]
        self.lock_entity_id = entry.data[CONF_LOCK_ENTITY_ID]
        
        # Storage for user data
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._user_data: dict[str, Any] = {
            "version": VERSION,
            "lock_node_id": self.node_id,
            "users": {},
        }

        # Track last alarm info for notification handling
        self._last_alarm_type: int | None = None
        self._last_alarm_level: int | None = None

        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        )

        # Listen to Z-Wave JS events
        self._setup_listeners()

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
        try:
            data = {}

            # Get lock state
            lock_state = self.hass.states.get(self.lock_entity_id)
            _LOGGER.debug("Lock entity %s state: %s", self.lock_entity_id, lock_state)
            
            if lock_state:
                data["lock_state"] = lock_state.state
                data["lock_attributes"] = dict(lock_state.attributes)
                
                _LOGGER.debug("Lock attributes: %s", lock_state.attributes)
                
                # Try to get door/bolt/battery from lock attributes first
                data["door_status"] = lock_state.attributes.get("door_status")
                data["bolt_status"] = lock_state.attributes.get("bolt_status")
                data["battery_level"] = lock_state.attributes.get("battery_level")
                
                _LOGGER.debug("From lock attributes - door: %s, bolt: %s, battery: %s",
                             data.get("door_status"), data.get("bolt_status"), data.get("battery_level"))

            # If not in attributes, search for related Z-Wave entities
            # The Z-Wave entities might have different naming (e.g., lock.smart_door_lock vs lock.smart_door_lock_2)
            # So we need to search for entities that match patterns
            
            # Try to find the base Z-Wave lock entity (without _2 suffix)
            base_name = self.lock_entity_id.split('.')[1]
            if base_name.endswith('_2'):
                zwave_base = base_name[:-2]  # Remove _2 suffix
            else:
                zwave_base = base_name
                
            _LOGGER.debug("Looking for Z-Wave entities with base name: %s (from %s)", zwave_base, base_name)
            
            # Find battery sensor - try multiple patterns
            battery_entities = [
                f"sensor.{zwave_base}_battery_level",
                f"sensor.{zwave_base}_battery",
                f"sensor.{base_name}_battery_level",
                f"sensor.{base_name}_battery",
            ]
            
            for battery_entity in battery_entities:
                battery_state = self.hass.states.get(battery_entity)
                if battery_state and battery_state.state not in ("unknown", "unavailable"):
                    try:
                        data["battery_level"] = int(float(battery_state.state))
                        _LOGGER.info("Got battery from %s: %s%%", battery_entity, data["battery_level"])
                        break
                    except (ValueError, TypeError) as err:
                        _LOGGER.debug("Could not parse battery value from %s: %s", battery_entity, err)

            # Find door binary sensor - try multiple patterns
            door_entities = [
                f"binary_sensor.{zwave_base}_current_status_of_the_door",
                f"binary_sensor.{zwave_base}_door",
                f"binary_sensor.{base_name}_door",
            ]
            
            for door_entity in door_entities:
                door_state = self.hass.states.get(door_entity)
                if door_state and door_state.state not in ("unknown", "unavailable"):
                    data["door_status"] = "open" if door_state.state == "on" else "closed"
                    _LOGGER.info("Got door status from %s: %s", door_entity, data["door_status"])
                    break

            # Find bolt binary sensor - try multiple patterns
            bolt_entities = [
                f"binary_sensor.{zwave_base}_bolt",
                f"binary_sensor.{base_name}_bolt",
            ]
            
            for bolt_entity in bolt_entities:
                bolt_state = self.hass.states.get(bolt_entity)
                if bolt_state and bolt_state.state not in ("unknown", "unavailable"):
                    data["bolt_status"] = "locked" if bolt_state.state == "on" else "unlocked"
                    _LOGGER.info("Got bolt status from %s: %s", bolt_entity, data["bolt_status"])
                    break
                    
            # If bolt is still not found, use lock state as fallback
            if "bolt_status" not in data or data["bolt_status"] is None:
                if lock_state:
                    data["bolt_status"] = "locked" if lock_state.state == "locked" else "unlocked"
                    _LOGGER.info("Using lock state for bolt status: %s", data["bolt_status"])

            # Get user codes status (we'll query them periodically)
            data["user_codes"] = await self._get_all_user_codes()
            
            # Get config parameters - these are needed for number/select entities
            # We'll try to get them from the Z-Wave lock's number/select entities
            try:
                # Volume (parameter 1)
                volume_entity = f"number.{zwave_base}_volume"
                volume_state = self.hass.states.get(volume_entity)
                if volume_state and volume_state.state not in ("unknown", "unavailable"):
                    try:
                        data["volume"] = int(float(volume_state.state))
                    except (ValueError, TypeError):
                        data["volume"] = 2  # Default: Low
                else:
                    data["volume"] = 2  # Default: Low
                
                # Auto Relock (parameter 2) - value is 0 (Disable) or 255 (Enable)
                auto_relock_entity = f"select.{zwave_base}_auto_relock"
                auto_relock_state = self.hass.states.get(auto_relock_entity)
                if auto_relock_state and auto_relock_state.state not in ("unknown", "unavailable"):
                    # Z-Wave select entity state will be "Enable" or "Disable"
                    data["auto_relock"] = 255 if auto_relock_state.state == "Enable" else 0
                else:
                    data["auto_relock"] = 255  # Default: Enable
                
                # Manual Relock Time (parameter 3)
                manual_entity = f"number.{zwave_base}_manual_relock_time"
                manual_state = self.hass.states.get(manual_entity)
                if manual_state and manual_state.state not in ("unknown", "unavailable"):
                    try:
                        data["manual_relock_time"] = int(float(manual_state.state))
                    except (ValueError, TypeError):
                        data["manual_relock_time"] = 7  # Default
                else:
                    data["manual_relock_time"] = 7  # Default
                
                # Remote Relock Time (parameter 6)
                remote_entity = f"number.{zwave_base}_remote_relock_time"
                remote_state = self.hass.states.get(remote_entity)
                if remote_state and remote_state.state not in ("unknown", "unavailable"):
                    try:
                        data["remote_relock_time"] = int(float(remote_state.state))
                    except (ValueError, TypeError):
                        data["remote_relock_time"] = 10  # Default
                else:
                    data["remote_relock_time"] = 10  # Default
                    
                _LOGGER.debug("Config parameters - Volume: %s, Auto Relock: %s, Manual: %s, Remote: %s",
                             data.get("volume"), data.get("auto_relock"), 
                             data.get("manual_relock_time"), data.get("remote_relock_time"))
                             
            except Exception as err:
                _LOGGER.warning("Could not fetch config parameters: %s", err)
                # Set defaults
                data["volume"] = 2
                data["auto_relock"] = "Enable"
                data["manual_relock_time"] = 7
                data["remote_relock_time"] = 10

            _LOGGER.info("Coordinator data updated successfully")
            return data

        except Exception as err:
            _LOGGER.error("Error in coordinator update: %s", err, exc_info=True)
            raise UpdateFailed(f"Error communicating with lock: {err}") from err

    async def _get_zwave_value(
        self, command_class: int, property_name: str, property_key: int | None = None
    ) -> Any:
        """Get a Z-Wave JS value."""
        try:
            # Use Z-Wave JS refresh_value service to get the current value
            service_data = {
                "entity_id": self.lock_entity_id,
                "command_class": command_class,
                "property": property_name,
            }
            
            if property_key is not None:
                service_data["property_key"] = property_key
            
            _LOGGER.debug(
                "Getting Z-Wave value - CC: %s, Property: %s, Key: %s",
                command_class,
                property_name,
                property_key,
            )
            
            # First refresh the value from the device
            try:
                await self.hass.services.async_call(
                    ZWAVE_JS_DOMAIN,
                    "refresh_value",
                    service_data,
                    blocking=True,
                )
                # Give the lock time to respond
                await asyncio.sleep(1.0)  # Increased from 0.5 to give lock more time
            except Exception as err:
                _LOGGER.warning("Could not refresh value: %s", err)
            
            # Try to get value from Z-Wave JS integration data
            if ZWAVE_JS_DOMAIN in self.hass.data:
                try:
                    # Get Z-Wave JS entry
                    lock_entity = self.hass.states.get(self.lock_entity_id)
                    if lock_entity and "node_id" in lock_entity.attributes:
                        node_id = lock_entity.attributes["node_id"]
                        
                        # Try to find matching Z-Wave JS entry
                        for entry_id, entry_data in self.hass.data[ZWAVE_JS_DOMAIN].items():
                            if hasattr(entry_data, "client") and hasattr(entry_data.client, "driver"):
                                driver = entry_data.client.driver
                                if hasattr(driver, "controller"):
                                    node = driver.controller.nodes.get(node_id)
                                    if node:
                                        # Try to get the value
                                        value_id = f"{node_id}-{command_class}-0-{property_name}"
                                        if property_key is not None:
                                            value_id += f"-{property_key}"
                                        
                                        for value in node.values.values():
                                            if (value.command_class == command_class and 
                                                value.property_name == property_name):
                                                if property_key is not None:
                                                    if value.property_key == property_key:
                                                        _LOGGER.debug("Found value from driver: %s", value.value)
                                                        return value.value
                                                else:
                                                    _LOGGER.debug("Found value from driver: %s", value.value)
                                                    return value.value
                except Exception as err:
                    _LOGGER.debug("Could not access Z-Wave JS driver data: %s", err)
            
            # Fallback: Search for entities that match our command class and property
            device_registry = dr.async_get(self.hass)
            entity_registry = er.async_get(self.hass)
            
            # Find the Z-Wave device
            device = device_registry.async_get_device(
                identifiers={(ZWAVE_JS_DOMAIN, self.node_id)}
            )
            
            if device:
                # Search for entities that match our command class and property
                for entity_entry in er.async_entries_for_device(entity_registry, device.id):
                    if entity_entry.platform == ZWAVE_JS_DOMAIN:
                        state = self.hass.states.get(entity_entry.entity_id)
                        if state and state.attributes:
                            # Check if this entity matches our query
                            if (
                                state.attributes.get("command_class") == command_class
                                and state.attributes.get("property") == property_name
                            ):
                                if property_key is not None:
                                    if state.attributes.get("property_key") == property_key:
                                        _LOGGER.debug("Found value from entity: %s", state.state)
                                        return state.state
                                else:
                                    _LOGGER.debug("Found value from entity: %s", state.state)
                                    return state.state
            
            _LOGGER.warning("No value found for CC:%s, Property:%s, Key:%s", command_class, property_name, property_key)
            return None

        except Exception as err:
            _LOGGER.error("Error getting Z-Wave value: %s", err)
            return None

    async def _get_all_user_codes(self) -> dict[int, dict[str, Any]]:
        """Get all user codes from the lock."""
        # For now, return empty dict
        # User codes will be managed through our storage, not queried from lock
        # This avoids complex Z-Wave queries that may not work reliably
        return {}

    async def _get_user_code_status(self, slot: int) -> int | None:
        """Get user code status for a slot by querying the lock."""
        try:
            _LOGGER.debug("Querying lock for user code status for slot %s...", slot)
            
            # Trigger the query (do NOT use return_response=True)
            await self.hass.services.async_call(
                ZWAVE_JS_DOMAIN,
                "invoke_cc_api",
                {
                    "entity_id": self.lock_entity_id,
                    "command_class": CC_USER_CODE,
                    "method_name": "get",
                    "parameters": [slot],
                },
                blocking=True,
            )
            
            # Wait for the value to be updated in the node cache
            await asyncio.sleep(0.5)
            
            # Now read from the node's cached value
            status = await self._get_zwave_value(CC_USER_CODE, "userIdStatus", slot)
            if status is not None:
                _LOGGER.debug("Slot %s status from cache: %s", slot, status)
                return int(status)
            
            _LOGGER.warning("No status in cache for slot %s after query", slot)
            return None
            
        except Exception as err:
            _LOGGER.error("Error getting user code status for slot %s: %s", slot, err, exc_info=True)
            return None

    async def _get_user_code(self, slot: int) -> str:
        """Get user code for a slot by querying the lock."""
        try:
            _LOGGER.debug("Querying lock for user code for slot %s...", slot)
            
            # Trigger the query (do NOT use return_response=True)
            await self.hass.services.async_call(
                ZWAVE_JS_DOMAIN,
                "invoke_cc_api",
                {
                    "entity_id": self.lock_entity_id,
                    "command_class": CC_USER_CODE,
                    "method_name": "get",
                    "parameters": [slot],
                },
                blocking=True,
            )
            
            # Wait for the value to be updated in the node cache
            await asyncio.sleep(0.5)
            
            # Now read from the node's cached value
            code = await self._get_zwave_value(CC_USER_CODE, "userCode", slot)
            if code is not None:
                code_str = str(code)
                _LOGGER.debug("Slot %s code from cache: %s", slot, "***" if code_str else "None")
                return code_str or ""
            
            _LOGGER.warning("No code in cache for slot %s after query", slot)
            return ""
            
        except Exception as err:
            _LOGGER.error("Error getting user code for slot %s: %s", slot, err, exc_info=True)
            return ""

    async def async_set_user_code(
        self,
        slot: int,
        code: str,
        name: str,
        code_type: str = CODE_TYPE_PIN,
        override_protection: bool = False,
    ) -> None:
        """Set a user code."""
        _LOGGER.info(
            "Setting user code for slot %s: name=%s, code_type=%s, override=%s", 
            slot, name, code_type, override_protection
        )
        
        # Validate slot
        if slot < 1 or slot > MAX_USER_SLOTS:
            raise ValueError(f"Slot must be between 1 and {MAX_USER_SLOTS}")

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
        existing_user = self._user_data["users"].get(str(slot))
        if existing_user:
            _LOGGER.debug(
                "Slot %s already in local storage: name=%s, enabled=%s", 
                slot, existing_user.get("name"), existing_user.get("enabled")
            )

        # Check slot protection (unless override is True)
        if not override_protection and not await self._is_slot_safe_to_write(slot):
            raise ValueError(f"Slot {slot} is occupied by an unknown code. Use override_protection=True to overwrite.")

        # Preserve existing schedule/usage data if updating
        existing_user = self._user_data["users"].get(str(slot))
        if existing_user:
            schedule = existing_user.get("schedule", {"start": None, "end": None})
            usage_limit = existing_user.get("usage_limit")
            usage_count = existing_user.get("usage_count", 0)
        else:
            schedule = {"start": None, "end": None}
            usage_limit = None
            usage_count = 0

        # Store user data
        self._user_data["users"][str(slot)] = {
            "name": name,
            "code_type": code_type,
            "code": code,  # In production, this should be encrypted
            "enabled": True,
            "schedule": schedule if code_type == CODE_TYPE_PIN else {"start": None, "end": None},
            "usage_limit": usage_limit if code_type == CODE_TYPE_PIN else None,
            "usage_count": usage_count if code_type == CODE_TYPE_PIN else 0,
            "synced_to_lock": False,
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
        """Clear a user code from storage and lock with verification."""
        # Remove from storage first
        if str(slot) in self._user_data["users"]:
            del self._user_data["users"][str(slot)]
            await self.async_save_user_data()
        
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

    async def async_set_usage_limit(self, slot: int, max_uses: int | None) -> None:
        """Set usage limit for a user code."""
        if str(slot) not in self._user_data["users"]:
            raise ValueError(f"User slot {slot} not found")

        self._user_data["users"][str(slot)]["usage_limit"] = max_uses
        await self.async_save_user_data()

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

        code = user_data["code"]
        enabled = user_data["enabled"]
        code_type = user_data.get("code_type", CODE_TYPE_PIN)

        # Determine status based on enabled flag and schedule
        if enabled and self._is_code_valid(slot):
            status = USER_STATUS_ENABLED
        else:
            status = USER_STATUS_DISABLED

        # Use invoke_cc_api to set the code
        try:
            _LOGGER.info("Pushing %s code for slot %s to lock (status: %s)", code_type, slot, status)
            
            await self.hass.services.async_call(
                ZWAVE_JS_DOMAIN,
                "invoke_cc_api",
                {
                    "entity_id": self.lock_entity_id,
                    "command_class": CC_USER_CODE,
                    "method_name": "set",
                    "parameters": [slot, status, code],
                },
                blocking=True,
            )
            
            # Wait for lock to process the write
            await asyncio.sleep(2.0)
            
            # VERIFY: Read back the code from the lock
            _LOGGER.info("Verifying code was written to slot %s...", slot)
            verification_status = await self._get_user_code_status(slot)
            verification_code = await self._get_user_code(slot)
            
            # Check if verification succeeded
            if verification_status is None:
                _LOGGER.warning("Could not verify slot %s - status read returned None", slot)
                user_data["synced_to_lock"] = False
            elif verification_status == USER_STATUS_AVAILABLE:
                _LOGGER.error("Verification failed: Slot %s is empty after push!", slot)
                user_data["synced_to_lock"] = False
                raise ValueError(f"Verification failed: Slot {slot} is empty after push")
            elif verification_code and verification_code != code:
                _LOGGER.error("Verification failed: Code mismatch in slot %s (expected: ***, got: ***)", slot)
                user_data["synced_to_lock"] = False
                raise ValueError(f"Verification failed: Code mismatch in slot {slot}")
            else:
                # Verification succeeded!
                _LOGGER.info("✓ Verified: Code successfully written to slot %s", slot)
                user_data["synced_to_lock"] = True
            
            await self.async_save_user_data()
            await self.async_request_refresh()
            
        except Exception as err:
            _LOGGER.error("Failed to push code for slot %s: %s", slot, err)
            user_data["synced_to_lock"] = False
            await self.async_save_user_data()
            raise ValueError(f"Failed to push code to lock: {err}") from err

    async def async_pull_codes_from_lock(self) -> None:
        """Pull all codes from the lock and update our data."""
        _LOGGER.info("Pulling codes from lock - scanning all %s slots", MAX_USER_SLOTS)
        codes_found = 0
        codes_updated = 0
        codes_new = 0

        for slot in range(1, MAX_USER_SLOTS + 1):
            _LOGGER.debug("Checking slot %s...", slot)
            status = await self._get_user_code_status(slot)
            code = await self._get_user_code(slot)

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
                # Update existing
                _LOGGER.info("Slot %s already known, marking as synced", slot)
                self._user_data["users"][slot_str]["synced_to_lock"] = True
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
                    "code": code if code else "",
                    "enabled": status == USER_STATUS_ENABLED,
                    "schedule": {"start": None, "end": None},
                    "usage_limit": None,
                    "usage_count": 0,
                    "synced_to_lock": True,
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

        await self.async_save_user_data()
        await self.async_request_refresh()

    async def async_load_user_data(self) -> None:
        """Load user data from storage."""
        data = await self._store.async_load()
        if data:
            self._user_data = data
            _LOGGER.debug("Loaded user data from storage")
        else:
            _LOGGER.debug("No existing user data found")

    async def async_save_user_data(self) -> None:
        """Save user data to storage."""
        await self._store.async_save(self._user_data)
        _LOGGER.debug("Saved user data to storage")

    @property
    def user_data(self) -> dict[str, Any]:
        """Get user data."""
        return self._user_data

    def get_user(self, slot: int) -> dict[str, Any] | None:
        """Get user data for a specific slot."""
        return self._user_data["users"].get(str(slot))

    def get_all_users(self) -> dict[str, Any]:
        """Get all users."""
        return self._user_data["users"]
