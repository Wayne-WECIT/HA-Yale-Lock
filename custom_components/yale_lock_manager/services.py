"""Services for Yale Lock Manager."""
from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
import homeassistant.helpers.config_validation as cv

from .const import (
    ATTR_CODE,
    ATTR_CODE_TYPE,
    ATTR_END_DATETIME,
    ATTR_MAX_USES,
    ATTR_NAME,
    ATTR_NOTIFICATION_SERVICE,
    ATTR_OVERRIDE_PROTECTION,
    ATTR_SLOT,
    ATTR_START_DATETIME,
    ATTR_STATUS,
    CODE_TYPE_FOB,
    CODE_TYPE_PIN,
    DOMAIN,
    MAX_CODE_LENGTH,
    MAX_USER_SLOTS,
    MIN_CODE_LENGTH,
    SERVICE_CLEAR_USER_CODE,
    SERVICE_DISABLE_USER,
    SERVICE_ENABLE_USER,
    SERVICE_PULL_CODES_FROM_LOCK,
    SERVICE_PUSH_CODE_TO_LOCK,
    SERVICE_RESET_USAGE_COUNT,
    SERVICE_SET_NOTIFICATION_ENABLED,
    SERVICE_SET_USAGE_LIMIT,
    SERVICE_SET_USER_CODE,
    SERVICE_SET_USER_SCHEDULE,
    SERVICE_CHECK_SYNC_STATUS,
    SERVICE_SET_USER_STATUS,
    SERVICE_CLEAR_LOCAL_CACHE,
    USER_STATUS_AVAILABLE,
    USER_STATUS_DISABLED,
    USER_STATUS_ENABLED,
)
from .coordinator import YaleLockCoordinator

_LOGGER = logging.getLogger(__name__)

# Service schemas
SET_USER_CODE_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_USER_SLOTS)),
        vol.Optional(ATTR_CODE, default=""): cv.string,  # Made optional for FOBs
        vol.Required(ATTR_NAME): cv.string,
        vol.Optional(ATTR_CODE_TYPE, default=CODE_TYPE_PIN): vol.In([CODE_TYPE_PIN, CODE_TYPE_FOB]),
        vol.Optional(ATTR_OVERRIDE_PROTECTION, default=False): cv.boolean,
        vol.Optional(ATTR_STATUS): vol.In([USER_STATUS_AVAILABLE, USER_STATUS_ENABLED, USER_STATUS_DISABLED]),
    }
)

CLEAR_USER_CODE_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_USER_SLOTS)),
    }
)

SET_USER_SCHEDULE_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_USER_SLOTS)),
        vol.Optional(ATTR_START_DATETIME): vol.Any(None, cv.datetime),  # Allow None
        vol.Optional(ATTR_END_DATETIME): vol.Any(None, cv.datetime),    # Allow None
    }
)

SET_USAGE_LIMIT_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_USER_SLOTS)),
        vol.Optional(ATTR_MAX_USES): vol.Any(None, vol.All(vol.Coerce(int), vol.Range(min=1))),
    }
)

SET_NOTIFICATION_ENABLED_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_USER_SLOTS)),
        vol.Required(ATTR_ENABLED): cv.boolean,
        vol.Optional(ATTR_NOTIFICATION_SERVICE): cv.string,
    }
)

PUSH_CODE_TO_LOCK_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_USER_SLOTS)),
    }
)

PULL_CODES_FROM_LOCK_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): cv.entity_id,
    }
)

CHECK_SYNC_STATUS_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_USER_SLOTS)),
    }
)

SET_USER_STATUS_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_USER_SLOTS)),
        vol.Required(ATTR_STATUS): vol.In([USER_STATUS_AVAILABLE, USER_STATUS_ENABLED, USER_STATUS_DISABLED]),
    }
)

ENABLE_USER_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_USER_SLOTS)),
    }
)

DISABLE_USER_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_USER_SLOTS)),
    }
)

RESET_USAGE_COUNT_SCHEMA = vol.Schema(
    {
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=MAX_USER_SLOTS)),
    }
)


async def async_setup_services(hass: HomeAssistant) -> None:
    """Set up services for Yale Lock Manager."""

    def get_coordinator() -> YaleLockCoordinator:
        """Get the coordinator (assuming single instance for now)."""
        if not hass.data.get(DOMAIN):
            raise HomeAssistantError("Yale Lock Manager integration not set up")

        # Get first coordinator
        coordinators = list(hass.data[DOMAIN].values())
        if not coordinators:
            raise HomeAssistantError("No Yale Lock Manager instances found")

        return coordinators[0]

    async def handle_set_user_code(call: ServiceCall) -> None:
        """Handle set user code service call."""
        coordinator = get_coordinator()
        slot = call.data[ATTR_SLOT]
        code = call.data[ATTR_CODE]
        name = call.data[ATTR_NAME]
        code_type = call.data.get(ATTR_CODE_TYPE, CODE_TYPE_PIN)
        override_protection = call.data.get(ATTR_OVERRIDE_PROTECTION, False)
        status = call.data.get(ATTR_STATUS)  # Optional status parameter

        try:
            await coordinator.async_set_user_code(slot, code, name, code_type, override_protection, status)
            _LOGGER.info("Set user code for slot %s: %s", slot, name)
        except Exception as err:
            _LOGGER.error("Error setting user code: %s", err)
            raise HomeAssistantError(f"Failed to set user code: {err}") from err

    async def handle_clear_user_code(call: ServiceCall) -> None:
        """Handle clear user code service call.
        
        Manual clears (from UI) should clear all local cached details.
        """
        coordinator = get_coordinator()
        slot = call.data[ATTR_SLOT]

        try:
            # Manual clears should clear all local cached details
            await coordinator.async_clear_user_code(slot, clear_local_cache=True)
            _LOGGER.info("Cleared user code for slot %s (local cache cleared)", slot)
        except Exception as err:
            _LOGGER.error("Error clearing user code: %s", err)
            raise HomeAssistantError(f"Failed to clear user code: {err}") from err

    async def handle_set_user_schedule(call: ServiceCall) -> None:
        """Handle set user schedule service call."""
        from datetime import datetime
        
        coordinator = get_coordinator()
        slot = call.data[ATTR_SLOT]
        start_datetime = call.data.get(ATTR_START_DATETIME)
        end_datetime = call.data.get(ATTR_END_DATETIME)

        # Validate dates
        now = datetime.now()
        if start_datetime and start_datetime < now:
            raise HomeAssistantError("Start date/time must be in the future")
        if end_datetime and end_datetime < now:
            raise HomeAssistantError("End date/time must be in the future")
        if start_datetime and end_datetime and end_datetime <= start_datetime:
            raise HomeAssistantError("End date/time must be after start date/time")

        # Convert datetime objects to ISO strings
        start_str = start_datetime.isoformat() if start_datetime else None
        end_str = end_datetime.isoformat() if end_datetime else None

        try:
            await coordinator.async_set_user_schedule(slot, start_str, end_str)
            _LOGGER.info("Set schedule for slot %s", slot)
        except Exception as err:
            _LOGGER.error("Error setting schedule: %s", err)
            raise HomeAssistantError(f"Failed to set schedule: {err}") from err

    async def handle_set_usage_limit(call: ServiceCall) -> None:
        """Handle set usage limit service call."""
        coordinator = get_coordinator()
        slot = call.data[ATTR_SLOT]
        max_uses = call.data.get(ATTR_MAX_USES)

        try:
            await coordinator.async_set_usage_limit(slot, max_uses)
            _LOGGER.info("Set usage limit for slot %s: %s", slot, max_uses)
        except Exception as err:
            _LOGGER.error("Error setting usage limit: %s", err)
            raise HomeAssistantError(f"Failed to set usage limit: {err}") from err

    async def handle_push_code_to_lock(call: ServiceCall) -> None:
        """Handle push code to lock service call."""
        coordinator = get_coordinator()
        slot = call.data[ATTR_SLOT]

        try:
            await coordinator.async_push_code_to_lock(slot)
            _LOGGER.info("Pushed code for slot %s to lock", slot)
        except Exception as err:
            _LOGGER.error("Error pushing code to lock: %s", err)
            raise HomeAssistantError(f"Failed to push code to lock: {err}") from err

    async def handle_pull_codes_from_lock(call: ServiceCall) -> None:
        """Handle pull codes from lock service call."""
        coordinator = get_coordinator()

        try:
            await coordinator.async_pull_codes_from_lock()
            _LOGGER.info("Pulled codes from lock")
        except Exception as err:
            _LOGGER.error("Error pulling codes from lock: %s", err)
            raise HomeAssistantError(f"Failed to pull codes from lock: {err}") from err

    async def handle_check_sync_status(call: ServiceCall) -> None:
        """Handle check sync status service call."""
        coordinator = get_coordinator()
        slot = call.data[ATTR_SLOT]

        try:
            await coordinator.async_check_sync_status(slot)
            _LOGGER.info("Checked sync status for slot %s", slot)
        except Exception as err:
            _LOGGER.error("Error checking sync status: %s", err)
            raise HomeAssistantError(f"Failed to check sync status: {err}") from err

    async def handle_set_user_status(call: ServiceCall) -> None:
        """Handle set user status service call."""
        coordinator = get_coordinator()
        slot = call.data[ATTR_SLOT]
        status = call.data[ATTR_STATUS]

        try:
            await coordinator.async_set_user_status(slot, status)
            _LOGGER.info("Set status for slot %s: %s", slot, status)
        except Exception as err:
            _LOGGER.error("Error setting user status: %s", err)
            raise HomeAssistantError(f"Failed to set user status: {err}") from err

    async def handle_enable_user(call: ServiceCall) -> None:
        """Handle enable user service call."""
        coordinator = get_coordinator()
        slot = call.data[ATTR_SLOT]

        try:
            await coordinator.async_enable_user(slot)
            _LOGGER.info("Enabled user for slot %s", slot)
        except Exception as err:
            _LOGGER.error("Error enabling user: %s", err)
            raise HomeAssistantError(f"Failed to enable user: {err}") from err

    async def handle_disable_user(call: ServiceCall) -> None:
        """Handle disable user service call."""
        coordinator = get_coordinator()
        slot = call.data[ATTR_SLOT]

        try:
            await coordinator.async_disable_user(slot)
            _LOGGER.info("Disabled user for slot %s", slot)
        except Exception as err:
            _LOGGER.error("Error disabling user: %s", err)
            raise HomeAssistantError(f"Failed to disable user: {err}") from err

    async def handle_reset_usage_count(call: ServiceCall) -> None:
        """Handle reset usage count service call."""
        coordinator = get_coordinator()
        slot = call.data[ATTR_SLOT]

        try:
            await coordinator.async_reset_usage_count(slot)
            _LOGGER.info("Reset usage count for slot %s", slot)
        except Exception as err:
            _LOGGER.error("Error resetting usage count: %s", err)
            raise HomeAssistantError(f"Failed to reset usage count: {err}") from err

    async def handle_clear_local_cache(call: ServiceCall) -> None:
        """Handle clear local cache service call."""
        coordinator = get_coordinator()

        try:
            await coordinator.async_clear_local_cache()
            _LOGGER.info("Cleared local cache")
        except Exception as err:
            _LOGGER.error("Error clearing local cache: %s", err)
            raise HomeAssistantError(f"Failed to clear local cache: {err}") from err

    async def handle_set_notification_enabled(call: ServiceCall) -> None:
        """Handle set notification enabled service call."""
        coordinator = get_coordinator()
        slot = call.data[ATTR_SLOT]
        enabled = call.data[ATTR_ENABLED]
        notification_service = call.data.get(ATTR_NOTIFICATION_SERVICE)

        try:
            await coordinator.async_set_notification_enabled(slot, enabled, notification_service)
            _LOGGER.info("Set notification enabled for slot %s: %s", slot, enabled)
        except Exception as err:
            _LOGGER.error("Error setting notification enabled: %s", err)
            raise HomeAssistantError(f"Failed to set notification enabled: {err}") from err

    # Register services
    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_USER_CODE,
        handle_set_user_code,
        schema=SET_USER_CODE_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_CLEAR_USER_CODE,
        handle_clear_user_code,
        schema=CLEAR_USER_CODE_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_USER_SCHEDULE,
        handle_set_user_schedule,
        schema=SET_USER_SCHEDULE_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_USAGE_LIMIT,
        handle_set_usage_limit,
        schema=SET_USAGE_LIMIT_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_PUSH_CODE_TO_LOCK,
        handle_push_code_to_lock,
        schema=PUSH_CODE_TO_LOCK_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_PULL_CODES_FROM_LOCK,
        handle_pull_codes_from_lock,
        schema=PULL_CODES_FROM_LOCK_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_CHECK_SYNC_STATUS,
        handle_check_sync_status,
        schema=CHECK_SYNC_STATUS_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_USER_STATUS,
        handle_set_user_status,
        schema=SET_USER_STATUS_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_ENABLE_USER,
        handle_enable_user,
        schema=ENABLE_USER_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_DISABLE_USER,
        handle_disable_user,
        schema=DISABLE_USER_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_RESET_USAGE_COUNT,
        handle_reset_usage_count,
        schema=RESET_USAGE_COUNT_SCHEMA,
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_CLEAR_LOCAL_CACHE,
        handle_clear_local_cache,
        schema=vol.Schema({vol.Optional("entity_id"): cv.entity_id}),
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_NOTIFICATION_ENABLED,
        handle_set_notification_enabled,
        schema=SET_NOTIFICATION_ENABLED_SCHEMA,
    )

    _LOGGER.debug("Registered Yale Lock Manager services")
