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
        
        # Create our own separate device (not linked to Z-Wave device)
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": f"{lock_name} Manager",
            "manufacturer": "Yale Lock Manager",
            "model": "Lock Code Manager",
            "sw_version": coordinator.hass.data[DOMAIN].get("version", "1.0.0"),
            "via_device": (ZWAVE_JS_DOMAIN, coordinator.node_id),  # Show it's related to Z-Wave lock
        }
        
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
