"""Number platform for Yale Lock Manager."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.components.zwave_js import DOMAIN as ZWAVE_JS_DOMAIN
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
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
    """Set up Yale Lock Manager number entities from config entry."""
    coordinator: YaleLockCoordinator = hass.data[DOMAIN][entry.entry_id]

    async_add_entities([
        YaleLockManualRelockTime(coordinator, entry),
        YaleLockRemoteRelockTime(coordinator, entry),
    ])


class YaleLockManualRelockTime(CoordinatorEntity, NumberEntity):
    """Manual relock time number entity for Yale lock."""

    _attr_has_entity_name = True
    _attr_native_min_value = 7
    _attr_native_max_value = 60
    _attr_native_step = 1
    _attr_native_unit_of_measurement = UnitOfTime.SECONDS
    _attr_mode = NumberMode.BOX
    _attr_icon = "mdi:timer-lock"

    def __init__(
        self,
        coordinator: YaleLockCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the number entity."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_manual_relock_time"
        self._attr_name = "Manual Relock Time"
        lock_name = entry.data.get(CONF_LOCK_NAME, "Yale Lock")
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": f"{lock_name} Manager",
            "manufacturer": "Yale Lock Manager",
            "model": "Lock Code Manager",
        }
        self._config_parameter = 3

    @property
    def native_value(self) -> float | None:
        """Return the current value."""
        # Try to get from lock entity attributes or coordinator data
        if self.coordinator.data:
            return self.coordinator.data.get("manual_relock_time", 7)
        return 7  # Default value

    async def async_set_native_value(self, value: float) -> None:
        """Set the relock time."""
        try:
            await self.hass.services.async_call(
                ZWAVE_JS_DOMAIN,
                "set_config_parameter",
                {
                    "entity_id": self.coordinator.lock_entity_id,
                    "parameter": self._config_parameter,
                    "value": int(value),
                },
                blocking=True,
            )
            _LOGGER.info("Set manual relock time to %s seconds", int(value))
            # Update coordinator data
            if self.coordinator.data:
                self.coordinator.data["manual_relock_time"] = int(value)
            await self.coordinator.async_request_refresh()
        except Exception as err:
            _LOGGER.error("Error setting manual relock time: %s", err)


class YaleLockRemoteRelockTime(CoordinatorEntity, NumberEntity):
    """Remote relock time number entity for Yale lock."""

    _attr_has_entity_name = True
    _attr_native_min_value = 10
    _attr_native_max_value = 90
    _attr_native_step = 1
    _attr_native_unit_of_measurement = UnitOfTime.SECONDS
    _attr_mode = NumberMode.BOX
    _attr_icon = "mdi:timer-lock-outline"

    def __init__(
        self,
        coordinator: YaleLockCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the number entity."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_remote_relock_time"
        self._attr_name = "Remote Relock Time"
        lock_name = entry.data.get(CONF_LOCK_NAME, "Yale Lock")
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": f"{lock_name} Manager",
            "manufacturer": "Yale Lock Manager",
            "model": "Lock Code Manager",
        }
        self._config_parameter = 6

    @property
    def native_value(self) -> float | None:
        """Return the current value."""
        # Try to get from lock entity attributes or coordinator data
        if self.coordinator.data:
            return self.coordinator.data.get("remote_relock_time", 10)
        return 10  # Default value

    async def async_set_native_value(self, value: float) -> None:
        """Set the relock time."""
        try:
            await self.hass.services.async_call(
                ZWAVE_JS_DOMAIN,
                "set_config_parameter",
                {
                    "entity_id": self.coordinator.lock_entity_id,
                    "parameter": self._config_parameter,
                    "value": int(value),
                },
                blocking=True,
            )
            _LOGGER.info("Set remote relock time to %s seconds", int(value))
            # Update coordinator data
            if self.coordinator.data:
                self.coordinator.data["remote_relock_time"] = int(value)
            await self.coordinator.async_request_refresh()
        except Exception as err:
            _LOGGER.error("Error setting remote relock time: %s", err)
