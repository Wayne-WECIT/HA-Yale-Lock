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

    _attr_has_entity_name = False  # Use custom name to avoid conflicts
    _attr_name = "Yale Lock Manager"  # This will create lock.yale_lock_manager

    def __init__(
        self,
        coordinator: YaleLockCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the lock."""
        super().__init__(coordinator)
        
        # Use the Z-Wave device instead of creating a new one
        device_registry = dr.async_get(coordinator.hass)
        zwave_device = device_registry.async_get_device(
            identifiers={(ZWAVE_JS_DOMAIN, coordinator.node_id)}
        )
        
        if zwave_device:
            # Link to existing Z-Wave device
            self._attr_device_info = {
                "identifiers": {(ZWAVE_JS_DOMAIN, coordinator.node_id)},
            }
            # Use a unique ID that won't conflict with Z-Wave lock
            self._attr_unique_id = f"{DOMAIN}_{coordinator.node_id}_manager"
            _LOGGER.info("Linked Yale Lock Manager to existing Z-Wave device: %s", zwave_device.name)
        else:
            # Fallback: create our own device (shouldn't happen)
            _LOGGER.warning("Could not find Z-Wave device for node %s, creating standalone device", coordinator.node_id)
            self._attr_unique_id = f"{entry.entry_id}_lock"
            self._attr_device_info = {
                "identifiers": {(DOMAIN, entry.entry_id)},
                "name": entry.data[CONF_LOCK_NAME],
                "manufacturer": "Yale",
                "model": "Smart Door Lock",
            }

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

        # Add user count info
        users = self.coordinator.get_all_users()
        enabled_users = [u for u in users.values() if u.get("enabled")]
        attrs["total_users"] = len(users)
        attrs["enabled_users"] = len(enabled_users)

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
