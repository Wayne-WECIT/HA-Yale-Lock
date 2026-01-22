"""Lock platform for Yale Lock Manager."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.lock import LockEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
import homeassistant.helpers.device_registry as dr

from .const import CONF_LOCK_NAME, DOMAIN, ZWAVE_JS_DOMAIN
from .coordinator import YaleLockCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Yale Lock Manager lock from config entry."""
    coordinator: YaleLockCoordinator = hass.data[DOMAIN][entry.entry_id]

    async_add_entities([YaleLockManagerLock(coordinator, entry)])


class YaleLockManagerLock(CoordinatorEntity, LockEntity):
    """Representation of a Yale Lock Manager lock."""

    _attr_has_entity_name = False  # Use custom full name

    def __init__(
        self,
        coordinator: YaleLockCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the lock."""
        super().__init__(coordinator)
        
        # Get the lock name from config entry
        lock_name = entry.data.get(CONF_LOCK_NAME, "Yale Lock")
        
        # Use a unique ID that won't conflict with Z-Wave lock
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_lock"
        self._attr_name = f"{lock_name} Manager"
        
        # Try to find the Z-Wave device in the device registry for via_device
        via_device_id = None
        device_registry = dr.async_get(coordinator.hass)
        for device in device_registry.devices.values():
            # Check if this device is from zwave_js and matches our node_id
            zwave_identifiers = [
                identifier for identifier in device.identifiers 
                if identifier[0] == ZWAVE_JS_DOMAIN
            ]
            if zwave_identifiers:
                # Z-Wave device identifier format is (zwave_js, "node_id-endpoint")
                identifier = zwave_identifiers[0]
                node_id_str = identifier[1].split("-")[0]  # Get node_id part
                if node_id_str == str(coordinator.node_id):
                    via_device_id = device.id
                    break
        
        # Create our own separate device
        device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": f"{lock_name} Manager",
            "manufacturer": "Yale Lock Manager",
            "model": "Lock Code Manager",
            "sw_version": coordinator.hass.data[DOMAIN].get("version", "1.0.0"),
        }
        
        # Only add via_device if we found the Z-Wave device
        if via_device_id:
            device_info["via_device"] = via_device_id
        
        self._attr_device_info = device_info
        
        _LOGGER.info("Created Yale Lock Manager device '%s' for entry %s", lock_name, entry.entry_id)

    @property
    def is_locked(self) -> bool | None:
        """Return true if the lock is locked."""
        if not self.coordinator.data:
            return None

        lock_state = self.coordinator.data.get("lock_state")
        return lock_state == "locked"

    @property
    def is_jammed(self) -> bool:
        """Return true if the lock is jammed."""
        # Check for jammed status from Z-Wave notification
        return False

    @property
    def available(self) -> bool:
        """Return if entity is available."""
        return self.coordinator.last_update_success and self.coordinator.data is not None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return the state attributes."""
        if not self.coordinator.data:
            return {}

        attrs = {}

        # Add door and bolt status
        door_status = self.coordinator.data.get("door_status")
        bolt_status = self.coordinator.data.get("bolt_status")
        battery_level = self.coordinator.data.get("battery_level")

        if door_status:
            attrs["door_status"] = door_status
        if bolt_status:
            attrs["bolt_status"] = bolt_status
        if battery_level is not None:
            attrs["battery_level"] = battery_level

        # Add user data for the card
        users = self.coordinator.get_all_users()
        enabled_users = [u for u in users.values() if u.get("enabled")]
        attrs["total_users"] = len([u for u in users.values() if u.get("name")])
        attrs["enabled_users"] = len(enabled_users)
        
        # Expose full user data for the Lovelace card
        attrs["users"] = users

        return attrs

    async def async_lock(self, **kwargs: Any) -> None:
        """Lock the lock."""
        await self.hass.services.async_call(
            "lock",
            "lock",
            {"entity_id": self.coordinator.lock_entity_id},
            blocking=True,
        )
        await self.coordinator.async_request_refresh()

    async def async_unlock(self, **kwargs: Any) -> None:
        """Unlock the lock."""
        await self.hass.services.async_call(
            "lock",
            "unlock",
            {"entity_id": self.coordinator.lock_entity_id},
            blocking=True,
        )
        await self.coordinator.async_request_refresh()
