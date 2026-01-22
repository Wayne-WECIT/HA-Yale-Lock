"""Data coordinator for Yale Lock Manager."""
from __future__ import annotations

from datetime import datetime, timedelta
import logging
from typing import Any

from homeassistant.components.zwave_js import DOMAIN as ZWAVE_JS_DOMAIN
from homeassistant.config_entries import ConfigEntry
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
    ALARM_TYPE_MANUAL_LOCK,
    ALARM_TYPE_MANUAL_UNLOCK,
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
        elif alarm_type == ALARM_TYPE_MANUAL_UNLOCK:
            self._fire_event(EVENT_UNLOCKED, {"method": ACCESS_METHOD_MANUAL})
        elif alarm_type == ALARM_TYPE_MANUAL_LOCK:
            self._fire_event(EVENT_LOCKED, {"method": ACCESS_METHOD_MANUAL})

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

            # If not in attributes, try to find related Z-Wave entities
            base_name = self.lock_entity_id.split('.')[1]
            _LOGGER.debug("Looking for entities with base name: %s", base_name)
            
            # Find battery sensor
            battery_entity = f"sensor.{base_name}_battery"
            battery_state = self.hass.states.get(battery_entity)
            _LOGGER.debug("Battery entity %s: %s", battery_entity, battery_state)
            
            if battery_state and battery_state.state not in ("unknown", "unavailable"):
                try:
                    data["battery_level"] = int(float(battery_state.state))
                    _LOGGER.debug("Got battery from sensor: %s", data["battery_level"])
                except (ValueError, TypeError) as err:
                    _LOGGER.debug("Could not parse battery value: %s", err)

            # Find door binary sensor
            door_entity = f"binary_sensor.{base_name}_door"
            door_state = self.hass.states.get(door_entity)
            _LOGGER.debug("Door entity %s: %s", door_entity, door_state)
            
            if door_state and door_state.state not in ("unknown", "unavailable"):
                data["door_status"] = "open" if door_state.state == "on" else "closed"
                _LOGGER.debug("Got door status from binary_sensor: %s", data["door_status"])

            # Find bolt binary sensor  
            bolt_entity = f"binary_sensor.{base_name}_bolt"
            bolt_state = self.hass.states.get(bolt_entity)
            _LOGGER.debug("Bolt entity %s: %s", bolt_entity, bolt_state)
            
            if bolt_state and bolt_state.state not in ("unknown", "unavailable"):
                data["bolt_status"] = "locked" if bolt_state.state == "on" else "unlocked"
                _LOGGER.debug("Got bolt status from binary_sensor: %s", data["bolt_status"])

            # Get user codes status (we'll query them periodically)
            data["user_codes"] = await self._get_all_user_codes()

            _LOGGER.info("Coordinator data updated: %s", data)
            return data

        except Exception as err:
            _LOGGER.error("Error in coordinator update: %s", err, exc_info=True)
            raise UpdateFailed(f"Error communicating with lock: {err}") from err

    async def _get_zwave_value(
        self, command_class: int, property_name: str, property_key: int | None = None
    ) -> Any:
        """Get a Z-Wave JS value."""
        try:
            # Get the device from device registry
            device_registry = dr.async_get(self.hass)
            device = None
            
            for dev in device_registry.devices.values():
                for identifier in dev.identifiers:
                    if identifier[0] == ZWAVE_JS_DOMAIN and identifier[1].split("-")[0] == self.node_id:
                        device = dev
                        break
                if device:
                    break

            if not device:
                _LOGGER.error("Could not find device for node %s", self.node_id)
                return None

            # Get entity from entity registry that matches this device and has the value
            entity_registry = er.async_get(self.hass)
            
            for entity in entity_registry.entities.values():
                if entity.device_id == device.id:
                    state = self.hass.states.get(entity.entity_id)
                    if state and state.attributes.get("command_class") == command_class:
                        if property_key is not None:
                            if state.attributes.get("property_key") == property_key:
                                return state.state
                        elif state.attributes.get("property") == property_name:
                            return state.state

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

    async def _get_user_code_status(self, slot: int) -> int:
        """Get user code status for a slot."""
        return await self._get_zwave_value(CC_USER_CODE, PROP_USER_ID_STATUS, slot)

    async def _get_user_code(self, slot: int) -> str:
        """Get user code for a slot."""
        code = await self._get_zwave_value(CC_USER_CODE, PROP_USER_CODE, slot)
        return code or ""

    async def async_set_user_code(
        self,
        slot: int,
        code: str,
        name: str,
        code_type: str = CODE_TYPE_PIN,
    ) -> None:
        """Set a user code."""
        # Validate slot
        if slot < 1 or slot > MAX_USER_SLOTS:
            raise ValueError(f"Slot must be between 1 and {MAX_USER_SLOTS}")

        # Check slot protection
        if not await self._is_slot_safe_to_write(slot):
            raise ValueError(f"Slot {slot} is occupied by an unknown code")

        # Store user data
        self._user_data["users"][str(slot)] = {
            "name": name,
            "code_type": code_type,
            "code": code,  # In production, this should be encrypted
            "enabled": True,
            "schedule": {"start": None, "end": None},
            "usage_limit": None,
            "usage_count": 0,
            "synced_to_lock": False,
            "last_used": None,
        }

        await self.async_save_user_data()

    async def _is_slot_safe_to_write(self, slot: int) -> bool:
        """Check if a slot is safe to write to."""
        # Get current status from lock
        status = await self._get_user_code_status(slot)

        if status == USER_STATUS_AVAILABLE:
            # Slot is empty, safe to write
            return True

        # Check if we have this slot in our data
        user_data = self._user_data["users"].get(str(slot))
        if user_data:
            # We own this slot
            return True

        # Slot is occupied by unknown code
        return False

    async def async_clear_user_code(self, slot: int) -> None:
        """Clear a user code."""
        if str(slot) in self._user_data["users"]:
            del self._user_data["users"][str(slot)]
            await self.async_save_user_data()

    async def async_enable_user(self, slot: int) -> None:
        """Enable a user code."""
        if str(slot) in self._user_data["users"]:
            self._user_data["users"][str(slot)]["enabled"] = True
            await self.async_save_user_data()

    async def async_disable_user(self, slot: int) -> None:
        """Disable a user code."""
        if str(slot) in self._user_data["users"]:
            self._user_data["users"][str(slot)]["enabled"] = False
            self._user_data["users"][str(slot)]["synced_to_lock"] = False
            await self.async_save_user_data()

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

    async def async_push_code_to_lock(self, slot: int) -> None:
        """Push a code to the lock."""
        user_data = self._user_data["users"].get(str(slot))
        if not user_data:
            raise ValueError(f"User slot {slot} not found")

        code = user_data["code"]
        enabled = user_data["enabled"]

        # Determine status based on enabled flag and schedule
        if enabled and self._is_code_valid(slot):
            status = USER_STATUS_ENABLED
        else:
            status = USER_STATUS_DISABLED

        # Use Z-Wave JS service to set the code
        await self.hass.services.async_call(
            ZWAVE_JS_DOMAIN,
            "set_value",
            {
                "entity_id": self.lock_entity_id,
                "command_class": CC_USER_CODE,
                "property": PROP_USER_CODE,
                "property_key": slot,
                "value": code,
            },
            blocking=True,
        )

        # Set the status
        await self.hass.services.async_call(
            ZWAVE_JS_DOMAIN,
            "set_value",
            {
                "entity_id": self.lock_entity_id,
                "command_class": CC_USER_CODE,
                "property": PROP_USER_ID_STATUS,
                "property_key": slot,
                "value": status,
            },
            blocking=True,
        )

        # Mark as synced
        user_data["synced_to_lock"] = True
        await self.async_save_user_data()

        _LOGGER.info("Pushed code for slot %s to lock", slot)

    async def async_pull_codes_from_lock(self) -> None:
        """Pull all codes from the lock and update our data."""
        _LOGGER.info("Pulling codes from lock")

        for slot in range(1, MAX_USER_SLOTS + 1):
            status = await self._get_user_code_status(slot)
            code = await self._get_user_code(slot)

            if status == USER_STATUS_AVAILABLE:
                # Slot is empty
                continue

            # Check if we already have this slot
            slot_str = str(slot)
            if slot_str in self._user_data["users"]:
                # Update existing
                self._user_data["users"][slot_str]["synced_to_lock"] = True
            else:
                # New code we don't know about
                # Try to determine if it's a FOB
                code_type = CODE_TYPE_PIN
                if code and (not code.isdigit() or len(code) < 4):
                    code_type = CODE_TYPE_FOB

                self._user_data["users"][slot_str] = {
                    "name": f"User {slot}",
                    "code_type": code_type,
                    "code": code,
                    "enabled": status == USER_STATUS_ENABLED,
                    "schedule": {"start": None, "end": None},
                    "usage_limit": None,
                    "usage_count": 0,
                    "synced_to_lock": True,
                    "last_used": None,
                }

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
