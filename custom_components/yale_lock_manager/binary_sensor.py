"""Binary sensor platform for Yale Lock Manager."""
from __future__ import annotations

import logging

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_LOCK_NAME, DOMAIN
from .coordinator import YaleLockCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Yale Lock Manager binary sensors from config entry."""
    coordinator: YaleLockCoordinator = hass.data[DOMAIN][entry.entry_id]

    sensors = [
        YaleLockDoorSensor(coordinator, entry),
        YaleLockBoltSensor(coordinator, entry),
    ]

    async_add_entities(sensors)


class YaleLockDoorSensor(CoordinatorEntity, BinarySensorEntity):
    """Door sensor for Yale lock."""

    _attr_device_class = BinarySensorDeviceClass.DOOR
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: YaleLockCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_door"
        self._attr_name = "Door"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": entry.data[CONF_LOCK_NAME],
            "manufacturer": "Yale",
            "model": "Smart Door Lock",
        }

    @property
    def is_on(self) -> bool | None:
        """Return true if the door is open."""
        if not self.coordinator.data:
            return None

        door_status = self.coordinator.data.get("door_status")
        if door_status is None:
            return None

        # Door status: "open" = True (on), "closed" = False (off)
        return door_status == "open"


class YaleLockBoltSensor(CoordinatorEntity, BinarySensorEntity):
    """Bolt sensor for Yale lock."""

    _attr_device_class = BinarySensorDeviceClass.LOCK
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: YaleLockCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_bolt"
        self._attr_name = "Bolt"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": entry.data[CONF_LOCK_NAME],
            "manufacturer": "Yale",
            "model": "Smart Door Lock",
        }

    @property
    def is_on(self) -> bool | None:
        """Return true if the bolt is locked."""
        if not self.coordinator.data:
            return None

        bolt_status = self.coordinator.data.get("bolt_status")
        if bolt_status is None:
            return None

        # Bolt status: "locked" = True (on), "unlocked" = False (off)
        return bolt_status == "locked"
