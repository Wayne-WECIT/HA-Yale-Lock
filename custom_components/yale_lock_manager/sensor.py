"""Sensor platform for Yale Lock Manager."""
from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE
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
    """Set up Yale Lock Manager sensors from config entry."""
    coordinator: YaleLockCoordinator = hass.data[DOMAIN][entry.entry_id]

    sensors = [
        YaleLockBatterySensor(coordinator, entry),
        YaleLockLastAccessSensor(coordinator, entry),
        YaleLockLastUserSensor(coordinator, entry),
        YaleLockLastAccessMethodSensor(coordinator, entry),
    ]

    async_add_entities(sensors)


class YaleLockBatterySensor(CoordinatorEntity, SensorEntity):
    """Battery sensor for Yale lock."""

    _attr_device_class = SensorDeviceClass.BATTERY
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: YaleLockCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_battery"
        self._attr_name = "Battery"
        lock_name = entry.data.get(CONF_LOCK_NAME, "Yale Lock")
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": f"{lock_name} Manager",
            "manufacturer": "Yale Lock Manager",
            "model": "Lock Code Manager",
        }

    @property
    def native_value(self) -> int | None:
        """Return the battery level."""
        if not self.coordinator.data:
            return None
        return self.coordinator.data.get("battery_level")


class YaleLockLastAccessSensor(CoordinatorEntity, SensorEntity):
    """Last access timestamp sensor for Yale lock."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: YaleLockCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_last_access"
        self._attr_name = "Last Access"
        lock_name = entry.data.get(CONF_LOCK_NAME, "Yale Lock")
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": f"{lock_name} Manager",
            "manufacturer": "Yale Lock Manager",
            "model": "Lock Code Manager",
        }
        self._last_access: datetime | None = None

    @property
    def native_value(self) -> datetime | None:
        """Return the last access time."""
        # Get the most recent access from all users
        users = self.coordinator.get_all_users()
        most_recent = None

        for user_data in users.values():
            last_used = user_data.get("last_used")
            if last_used:
                try:
                    dt = datetime.fromisoformat(last_used)
                    # Ensure timezone-aware (add UTC if naive)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    if most_recent is None or dt > most_recent:
                        most_recent = dt
                except (ValueError, TypeError):
                    continue

        return most_recent


class YaleLockLastUserSensor(CoordinatorEntity, SensorEntity):
    """Last user sensor for Yale lock."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:account"

    def __init__(
        self,
        coordinator: YaleLockCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_last_user"
        self._attr_name = "Last User"
        lock_name = entry.data.get(CONF_LOCK_NAME, "Yale Lock")
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": f"{lock_name} Manager",
            "manufacturer": "Yale Lock Manager",
            "model": "Lock Code Manager",
        }

    @property
    def native_value(self) -> str | None:
        """Return the last user name."""
        users = self.coordinator.get_all_users()
        most_recent = None
        most_recent_time = None
        most_recent_name = None

        for user_data in users.values():
            last_used = user_data.get("last_used")
            if last_used:
                try:
                    dt = datetime.fromisoformat(last_used)
                    if most_recent_time is None or dt > most_recent_time:
                        most_recent_time = dt
                        most_recent_name = user_data.get("name")
                except (ValueError, TypeError):
                    continue

        return most_recent_name


class YaleLockLastAccessMethodSensor(CoordinatorEntity, SensorEntity):
    """Last access method sensor for Yale lock."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:lock-check"

    def __init__(
        self,
        coordinator: YaleLockCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_last_access_method"
        self._attr_name = "Last Access Method"
        lock_name = entry.data.get(CONF_LOCK_NAME, "Yale Lock")
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": f"{lock_name} Manager",
            "manufacturer": "Yale Lock Manager",
            "model": "Lock Code Manager",
        }
        self._last_method: str | None = None

        # Listen to access events
        self._setup_listener()

    def _setup_listener(self) -> None:
        """Set up event listener."""
        from homeassistant.core import callback
        from .const import EVENT_ACCESS

        @callback
        def handle_access_event(event):
            """Handle access event."""
            self._last_method = event.data.get("method")
            self.async_write_ha_state()

        self.coordinator.hass.bus.async_listen(EVENT_ACCESS, handle_access_event)

    @property
    def native_value(self) -> str | None:
        """Return the last access method."""
        return self._last_method

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return extra attributes."""
        return {
            "icon_map": {
                "pin": "mdi:dialpad",
                "fob": "mdi:credit-card",
                "manual": "mdi:hand-back-right",
                "remote": "mdi:cellphone",
                "auto": "mdi:lock-clock",
            }
        }
