"""The Yale Lock Manager integration."""
from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from .const import CONF_LOCK_NODE_ID, DOMAIN
from .coordinator import YaleLockCoordinator
from .services import async_setup_services

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.LOCK,
    Platform.SENSOR,
    Platform.BINARY_SENSOR,
]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Yale Lock Manager from a config entry."""
    _LOGGER.debug("Setting up Yale Lock Manager integration")

    # Create coordinator
    coordinator = YaleLockCoordinator(hass, entry)

    # Load user data from storage
    await coordinator.async_load_user_data()

    # Perform initial data fetch
    await coordinator.async_config_entry_first_refresh()

    # Store coordinator
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = coordinator

    # Set up platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Set up services
    await async_setup_services(hass)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    _LOGGER.debug("Unloading Yale Lock Manager integration")

    # Unload platforms
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        # Remove coordinator
        hass.data[DOMAIN].pop(entry.entry_id)

        # Remove services if no more instances
        if not hass.data[DOMAIN]:
            # Remove all services
            for service in [
                "set_user_code",
                "clear_user_code",
                "set_user_schedule",
                "set_usage_limit",
                "push_code_to_lock",
                "pull_codes_from_lock",
                "enable_user",
                "disable_user",
            ]:
                hass.services.async_remove(DOMAIN, service)

    return unload_ok


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Migrate old entry."""
    _LOGGER.debug("Migrating from version %s", entry.version)

    if entry.version == 1:
        # No migration needed yet
        return True

    # Migration failed
    return False
