"""The Yale Lock Manager integration."""
from __future__ import annotations

import logging
import os
import shutil
from datetime import timedelta
from pathlib import Path

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.event import async_track_time_interval

from .const import (
    CONF_LOCK_NODE_ID,
    DEFAULT_SCHEDULE_CHECK_INTERVAL_MINUTES,
    DOMAIN,
    OPTION_SCHEDULE_CHECK_INTERVAL_MINUTES,
)
from .coordinator import YaleLockCoordinator
from .services import async_setup_services
from .websocket import ws_export_user_data, ws_get_notification_services

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.LOCK,
    Platform.SENSOR,
    Platform.BINARY_SENSOR,
    Platform.NUMBER,
    Platform.SELECT,
    Platform.SWITCH,
]


async def _async_setup_frontend(hass: HomeAssistant) -> None:
    """Set up the frontend resources (card and panel)."""
    # Get the path to this integration's directory
    integration_dir = Path(__file__).parent
    card_source = integration_dir / "www" / "yale-lock-manager-card.js"
    panel_html_source = integration_dir / "www" / "yale-lock-manager-panel.html"
    panel_js_source = integration_dir / "www" / "yale-lock-manager-panel.js"
    
    # Create the target directory in www
    www_dir = Path(hass.config.path("www"))
    target_dir = www_dir / "yale_lock_manager"
    target_card = target_dir / "yale-lock-manager-card.js"
    target_panel_html = target_dir / "yale-lock-manager-panel.html"
    target_panel_js = target_dir / "yale-lock-manager-panel.js"
    
    # Run file operations in executor to avoid blocking the event loop
    def copy_frontend_files():
        """Copy frontend files (runs in executor)."""
        try:
            # Create target directory if it doesn't exist
            target_dir.mkdir(parents=True, exist_ok=True)
            
            # Copy card file
            if card_source.exists():
                shutil.copy2(card_source, target_card)
            
            # Copy panel files
            if panel_html_source.exists():
                shutil.copy2(panel_html_source, target_panel_html)
            if panel_js_source.exists():
                shutil.copy2(panel_js_source, target_panel_js)
            
            return True
        except Exception as err:
            _LOGGER.error("Failed to copy frontend files: %s", err)
            return False
    
    # Run the blocking operation in an executor
    success = await hass.async_add_executor_job(copy_frontend_files)
    
    if success:
        _LOGGER.info(
            "Copied frontend files to %s\n"
            "  Card resource: /local/yale_lock_manager/yale-lock-manager-card.js\n"
            "  Panel: /local/yale_lock_manager/yale-lock-manager-panel.html",
            target_dir
        )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Yale Lock Manager from a config entry."""
    _LOGGER.debug("Setting up Yale Lock Manager integration")

    # Set up frontend resources (copy card to www)
    await _async_setup_frontend(hass)

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

    # Register WebSocket commands once (for get_notification_services list and export_user_data)
    if len(hass.data[DOMAIN]) == 1:
        websocket_api.async_register_command(hass, ws_get_notification_services)
        websocket_api.async_register_command(hass, ws_export_user_data)

    # Auto-schedule checker: run periodically to push/clear codes when schedules start/end
    interval_minutes = entry.options.get(
        OPTION_SCHEDULE_CHECK_INTERVAL_MINUTES,
        DEFAULT_SCHEDULE_CHECK_INTERVAL_MINUTES,
    )
    interval_minutes = max(1, min(60, int(interval_minutes)))

    async def _schedule_check(_now):
        coord = hass.data.get(DOMAIN, {}).get(entry.entry_id)
        if coord:
            await coord.async_check_schedules()

    remove = async_track_time_interval(
        hass, _schedule_check, timedelta(minutes=interval_minutes)
    )
    entry.async_on_unload(remove)

    # Run first check so lock is synced with schedules after load
    hass.async_create_task(coordinator.async_check_schedules())

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
