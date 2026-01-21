"""Config flow for Yale Lock Manager integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.components.zwave_js import DOMAIN as ZWAVE_JS_DOMAIN
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import device_registry as dr

from .const import (
    CONF_LOCK_ENTITY_ID,
    CONF_LOCK_NAME,
    CONF_LOCK_NODE_ID,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

# Door Lock device class
DEVICE_CLASS_DOOR_LOCK = (64, 3)  # generic=64 (Entry Control), specific=3 (Door Lock)


async def _get_zwave_locks(hass: HomeAssistant) -> dict[str, str]:
    """Get all Z-Wave locks from device registry."""
    device_registry = dr.async_get(hass)
    locks = {}

    for device in device_registry.devices.values():
        # Check if device is from zwave_js
        if ZWAVE_JS_DOMAIN not in device.identifiers:
            continue

        # Get device class info from identifiers
        for identifier in device.identifiers:
            if identifier[0] == ZWAVE_JS_DOMAIN:
                # Get the node_id from the identifier
                node_id = identifier[1].split("-")[0]  # Format is "node_id-endpoint"
                
                # Check device class - look for Door Lock
                # We'll check the model/name for Yale locks
                if device.manufacturer and "yale" in device.manufacturer.lower():
                    if device.model and "lock" in device.model.lower():
                        locks[node_id] = f"{device.name} (Node {node_id})"
                        continue
                
                # Also check by name if manufacturer detection didn't work
                if "lock" in device.name.lower():
                    locks[node_id] = f"{device.name} (Node {node_id})"

    return locks


class YaleLockManagerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Yale Lock Manager."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors = {}

        # Check if Z-Wave JS integration is loaded
        if ZWAVE_JS_DOMAIN not in self.hass.data:
            return self.async_abort(reason="zwave_js_not_found")

        # Get available locks
        locks = await _get_zwave_locks(self.hass)

        if not locks:
            return self.async_abort(reason="no_locks_found")

        # Check if we already have a configured lock (only allow one for now)
        configured_entries = self._async_current_entries()
        if configured_entries:
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            node_id = user_input[CONF_LOCK_NODE_ID]
            lock_name = locks[node_id]

            # Get the lock entity ID from entity registry
            entity_registry = self.hass.helpers.entity_registry.async_get(self.hass)
            lock_entity_id = None

            for entity in entity_registry.entities.values():
                if entity.platform == ZWAVE_JS_DOMAIN and entity.domain == "lock":
                    if entity.unique_id and node_id in entity.unique_id:
                        lock_entity_id = entity.entity_id
                        break

            if not lock_entity_id:
                errors["base"] = "lock_entity_not_found"
            else:
                # Create the entry
                return self.async_create_entry(
                    title=lock_name,
                    data={
                        CONF_LOCK_NODE_ID: node_id,
                        CONF_LOCK_ENTITY_ID: lock_entity_id,
                        CONF_LOCK_NAME: lock_name,
                    },
                )

        # Show form with lock selection
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_LOCK_NODE_ID): vol.In(locks),
                }
            ),
            errors=errors,
        )
