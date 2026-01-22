"""Select platform for Yale Lock Manager."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.select import SelectEntity
from homeassistant.components.zwave_js import DOMAIN as ZWAVE_JS_DOMAIN
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
    """Set up Yale Lock Manager select entities from config entry."""
    coordinator: YaleLockCoordinator = hass.data[DOMAIN][entry.entry_id]

    async_add_entities([
        YaleLockVolumeSelect(coordinator, entry),
    ])


class YaleLockVolumeSelect(CoordinatorEntity, SelectEntity):
    """Volume select entity for Yale lock."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:volume-high"
    _attr_options = ["Silent", "Low", "High"]

    def __init__(
        self,
        coordinator: YaleLockCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the select entity."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_volume"
        self._attr_name = "Volume"
        lock_name = entry.data.get(CONF_LOCK_NAME, "Yale Lock")
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": f"{lock_name} Manager",
            "manufacturer": "Yale Lock Manager",
            "model": "Lock Code Manager",
        }
        self._config_parameter = 1
        self._value_map = {
            "Silent": 1,
            "Low": 2,
            "High": 3,
        }
        self._reverse_map = {v: k for k, v in self._value_map.items()}

    @property
    def current_option(self) -> str | None:
        """Return the current volume setting."""
        if self.coordinator.data:
            volume_value = self.coordinator.data.get("volume", 2)
            return self._reverse_map.get(volume_value, "Low")
        return "Low"  # Default

    async def async_select_option(self, option: str) -> None:
        """Change the volume setting."""
        if option not in self._value_map:
            _LOGGER.error("Invalid volume option: %s", option)
            return

        value = self._value_map[option]
        
        try:
            await self.hass.services.async_call(
                ZWAVE_JS_DOMAIN,
                "set_config_parameter",
                {
                    "entity_id": self.coordinator.lock_entity_id,
                    "parameter": self._config_parameter,
                    "value": value,
                },
                blocking=True,
            )
            _LOGGER.info("Set volume to %s (value: %s)", option, value)
            # Update coordinator data
            if self.coordinator.data:
                self.coordinator.data["volume"] = value
            await self.coordinator.async_request_refresh()
        except Exception as err:
            _LOGGER.error("Error setting volume: %s", err)
