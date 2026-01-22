"""Switch platform for Yale Lock Manager."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.switch import SwitchEntity
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
    """Set up Yale Lock Manager switch entities from config entry."""
    coordinator: YaleLockCoordinator = hass.data[DOMAIN][entry.entry_id]

    async_add_entities([
        YaleLockAutoRelockSwitch(coordinator, entry),
    ])


class YaleLockAutoRelockSwitch(CoordinatorEntity, SwitchEntity):
    """Auto relock switch entity for Yale lock."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:lock-clock"

    def __init__(
        self,
        coordinator: YaleLockCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the switch entity."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_auto_relock"
        self._attr_name = "Auto Relock"
        lock_name = entry.data.get(CONF_LOCK_NAME, "Yale Lock")
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": f"{lock_name} Manager",
            "manufacturer": "Yale Lock Manager",
            "model": "Lock Code Manager",
        }
        self._config_parameter = 2

    @property
    def is_on(self) -> bool:
        """Return true if auto relock is enabled."""
        if self.coordinator.data:
            auto_relock = self.coordinator.data.get("auto_relock", 255)
            return auto_relock == 255
        return True  # Default is enabled

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Enable auto relock."""
        try:
            await self.hass.services.async_call(
                ZWAVE_JS_DOMAIN,
                "set_config_parameter",
                {
                    "entity_id": self.coordinator.lock_entity_id,
                    "parameter": self._config_parameter,
                    "value": 255,
                },
                blocking=True,
            )
            _LOGGER.info("Enabled auto relock")
            # Update coordinator data
            if self.coordinator.data:
                self.coordinator.data["auto_relock"] = 255
            await self.coordinator.async_request_refresh()
        except Exception as err:
            _LOGGER.error("Error enabling auto relock: %s", err)

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Disable auto relock."""
        try:
            await self.hass.services.async_call(
                ZWAVE_JS_DOMAIN,
                "set_config_parameter",
                {
                    "entity_id": self.coordinator.lock_entity_id,
                    "parameter": self._config_parameter,
                    "value": 0,
                },
                blocking=True,
            )
            _LOGGER.info("Disabled auto relock")
            # Update coordinator data
            if self.coordinator.data:
                self.coordinator.data["auto_relock"] = 0
            await self.coordinator.async_request_refresh()
        except Exception as err:
            _LOGGER.error("Error disabling auto relock: %s", err)
