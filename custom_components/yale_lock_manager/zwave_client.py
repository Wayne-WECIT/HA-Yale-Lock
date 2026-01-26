"""Z-Wave JS client for Yale Lock Manager."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from homeassistant.components.zwave_js import DOMAIN as ZWAVE_JS_DOMAIN
from homeassistant.core import HomeAssistant

from .const import (
    CC_USER_CODE,
    CODE_TYPE_FOB,
    CODE_TYPE_PIN,
    USER_STATUS_AVAILABLE,
    USER_STATUS_DISABLED,
    USER_STATUS_ENABLED,
)
from .logger import YaleLockLogger

_LOGGER = YaleLockLogger()


class ZWaveClient:
    """Handles all Z-Wave JS API interactions."""

    def __init__(self, hass: HomeAssistant, node_id: int, lock_entity_id: str) -> None:
        """Initialize Z-Wave client."""
        self._hass = hass
        self._node_id = node_id
        self._lock_entity_id = lock_entity_id
        self._logger = YaleLockLogger("yale_lock_manager.zwave_client")

    async def get_user_code_data(self, slot: int) -> dict[str, Any] | None:
        """Get user code data (status and code) from the lock using invoke_cc_api.
        
        The response from invoke_cc_api is logged by Z-Wave JS but not stored in the node's cache.
        We capture the response by temporarily intercepting log messages from Z-Wave JS.
        """
        captured_response: dict[str, Any] | None = None
        log_capture_complete = asyncio.Event()
        
        # Set up a temporary log handler to capture the Z-Wave JS log message
        class ResponseLogHandler(logging.Handler):
            """Temporary log handler to capture invoke_cc_api response from Z-Wave JS logs."""
            
            def __init__(self, target_slot: int, event: asyncio.Event):
                super().__init__()
                self.target_slot = target_slot
                self.event = event
                self.captured_data: dict[str, Any] | None = None
                
            def emit(self, record):
                """Capture log messages containing invoke_cc_api responses."""
                if record.name != "homeassistant.components.zwave_js.services":
                    return
                
                message = record.getMessage()
                # Look for the log pattern: "Invoked USER_CODE CC API method get... with the following result: {...}"
                if "Invoked USER_CODE CC API method get" in message and "with the following result:" in message:
                    # Extract the result dictionary from the log message
                    # Pattern: "... with the following result: {'userIdStatus': 1, 'userCode': '19992017'}"
                    match = re.search(r"with the following result:\s*(\{.*?\})", message)
                    if match:
                        try:
                            # Parse the dictionary string
                            result_str = match.group(1)
                            # Replace single quotes with double quotes for JSON parsing
                            result_str = result_str.replace("'", '"')
                            result_dict = json.loads(result_str)
                            
                            # Verify this is for our slot by checking if the data makes sense
                            # (We can't verify slot from the log, but we'll capture the first response)
                            if isinstance(result_dict, dict) and ("userIdStatus" in result_dict or "userCode" in result_dict):
                                self.captured_data = result_dict
                                self.event.set()
                                _LOGGER.debug("Captured response from log", slot=self.target_slot, force=True)
                        except (json.JSONDecodeError, AttributeError) as err:
                            _LOGGER.debug("Could not parse response from log message", error=str(err), force=True)
        
        try:
            self._logger.info_operation("Querying lock for user code data", slot)
            
            # Set up log handler BEFORE calling invoke_cc_api
            log_handler = ResponseLogHandler(slot, log_capture_complete)
            log_handler.setLevel(logging.INFO)
            
            # Get the Z-Wave JS services logger
            zwave_js_logger = logging.getLogger("homeassistant.components.zwave_js.services")
            zwave_js_logger.addHandler(log_handler)
            
            try:
                # Call invoke_cc_api to trigger the lock to report its user code data
                self._logger.debug("Calling invoke_cc_api", slot=slot, force=True)
                await self._hass.services.async_call(
                    ZWAVE_JS_DOMAIN,
                    "invoke_cc_api",
                    {
                        "entity_id": self._lock_entity_id,
                        "command_class": CC_USER_CODE,
                        "method_name": "get",
                        "parameters": [slot],
                    },
                    blocking=True,
                )
                
                self._logger.debug("invoke_cc_api call completed, waiting for log message", force=True)
                
                # Wait for the log handler to capture the response (with timeout)
                try:
                    await asyncio.wait_for(log_capture_complete.wait(), timeout=3.0)
                    captured_response = log_handler.captured_data
                except asyncio.TimeoutError:
                    self._logger.warning("Timeout waiting for invoke_cc_api response log", slot=slot)
                
            finally:
                # Always remove the log handler
                zwave_js_logger.removeHandler(log_handler)
            
            if captured_response:
                self._logger.info_operation(
                    "Captured response from log",
                    slot,
                    status=captured_response.get("userIdStatus"),
                    code="***" if captured_response.get("userCode") else None,
                )
                return captured_response
            else:
                self._logger.warning(
                    "Could not capture response from invoke_cc_api log. "
                    "The call succeeded (see Z-Wave JS logs), but the response was not captured.",
                    slot=slot,
                )
                return None
                
        except Exception as err:
            self._logger.error_zwave("get_user_code_data", err, slot=slot)
            return None

    async def set_user_code(self, slot: int, code: str, status: int) -> None:
        """Set user code on the lock using invoke_cc_api.
        
        According to Z-Wave User Code CC specification, the set method parameters are:
        [userId, userIdStatus, userCode]
        
        Parameters must be:
        - userId: INTEGER (slot number)
        - userIdStatus: INTEGER (0, 1, or 2)
        - userCode: STRING (PIN code)
        """
        try:
            # Validate and convert types explicitly
            userId = int(slot)
            userIdStatus = int(status)
            userCode = str(code)
            
            # Validate status is in valid range (0, 1, or 2)
            if userIdStatus not in (USER_STATUS_AVAILABLE, USER_STATUS_ENABLED, USER_STATUS_DISABLED):
                raise ValueError(f"Invalid status value: {userIdStatus}. Must be 0, 1, or 2")
            
            # Log parameter types and values for debugging
            _LOGGER.info(
                "set_user_code called: slot=%s (type=%s), code='%s' (type=%s), status=%s (type=%s)",
                userId, type(userId).__name__,
                userCode, type(userCode).__name__,
                userIdStatus, type(userIdStatus).__name__
            )
            
            # Build parameters array with explicit types
            # Z-Wave User Code CC set parameters: [userId, userIdStatus, userCode]
            parameters = [userId, userIdStatus, userCode]
            _LOGGER.info(
                "Parameters array: %s (types: [%s, %s, %s])",
                parameters,
                type(parameters[0]).__name__,
                type(parameters[1]).__name__,
                type(parameters[2]).__name__
            )
            
            self._logger.info_operation("Setting user code on lock", slot, status=status, code="***")
            
            # Z-Wave User Code CC set parameters: [userId, userIdStatus, userCode]
            await self._hass.services.async_call(
                ZWAVE_JS_DOMAIN,
                "invoke_cc_api",
                {
                    "entity_id": self._lock_entity_id,
                    "command_class": CC_USER_CODE,
                    "method_name": "set",
                    "parameters": parameters,  # [userId (int), userIdStatus (int), userCode (str)]
                },
                blocking=True,
            )
            
            self._logger.info_operation("User code set on lock", slot)
            _LOGGER.info("set_user_code completed: slot=%s, status=%s", slot, status)
            
        except Exception as err:
            self._logger.error_zwave("set_user_code", err, slot=slot)
            raise

    async def clear_user_code(self, slot: int) -> None:
        """Clear user code on the lock using invoke_cc_api."""
        try:
            self._logger.info_operation("Clearing user code on lock", slot)
            
            await self._hass.services.async_call(
                ZWAVE_JS_DOMAIN,
                "invoke_cc_api",
                {
                    "entity_id": self._lock_entity_id,
                    "command_class": CC_USER_CODE,
                    "method_name": "set",
                    "parameters": [slot, USER_STATUS_AVAILABLE, ""],
                },
                blocking=True,
            )
            
            self._logger.info_operation("User code cleared on lock", slot)
            
        except Exception as err:
            self._logger.error_zwave("clear_user_code", err, slot=slot)
            raise

    async def get_lock_state(self) -> dict[str, Any]:
        """Get lock state (door, bolt, battery) from Z-Wave entities."""
        data: dict[str, Any] = {}
        
        # Get lock state
        lock_state = self._hass.states.get(self._lock_entity_id)
        if lock_state:
            data["lock_state"] = lock_state.state
            data["lock_attributes"] = dict(lock_state.attributes)
            
            # Try to get door/bolt/battery from lock attributes first
            data["door_status"] = lock_state.attributes.get("door_status")
            data["bolt_status"] = lock_state.attributes.get("bolt_status")
            data["battery_level"] = lock_state.attributes.get("battery_level")

        # If not in attributes, search for related Z-Wave entities
        base_name = self._lock_entity_id.split('.')[1]
        if base_name.endswith('_2'):
            zwave_base = base_name[:-2]  # Remove _2 suffix
        else:
            zwave_base = base_name
        
        # Find battery sensor
        battery_entities = [
            f"sensor.{zwave_base}_battery_level",
            f"sensor.{zwave_base}_battery",
            f"sensor.{base_name}_battery_level",
            f"sensor.{base_name}_battery",
        ]
        
        for battery_entity in battery_entities:
            battery_state = self._hass.states.get(battery_entity)
            if battery_state and battery_state.state not in ("unknown", "unavailable"):
                try:
                    data["battery_level"] = int(float(battery_state.state))
                    break
                except (ValueError, TypeError):
                    pass

        # Find door binary sensor
        door_entities = [
            f"binary_sensor.{zwave_base}_current_status_of_the_door",
            f"binary_sensor.{zwave_base}_door",
            f"binary_sensor.{base_name}_door",
        ]
        
        for door_entity in door_entities:
            door_state = self._hass.states.get(door_entity)
            if door_state and door_state.state not in ("unknown", "unavailable"):
                data["door_status"] = "open" if door_state.state == "on" else "closed"
                break

        # Find bolt binary sensor
        bolt_entities = [
            f"binary_sensor.{zwave_base}_bolt",
            f"binary_sensor.{base_name}_bolt",
        ]
        
        for bolt_entity in bolt_entities:
            bolt_state = self._hass.states.get(bolt_entity)
            if bolt_state and bolt_state.state not in ("unknown", "unavailable"):
                data["bolt_status"] = "locked" if bolt_state.state == "on" else "unlocked"
                break
                
        # If bolt is still not found, use lock state as fallback
        if "bolt_status" not in data or data["bolt_status"] is None:
            if lock_state:
                data["bolt_status"] = "locked" if lock_state.state == "locked" else "unlocked"

        return data

    async def get_config_parameters(self) -> dict[str, Any]:
        """Get lock configuration parameters."""
        data: dict[str, Any] = {}
        
        base_name = self._lock_entity_id.split('.')[1]
        if base_name.endswith('_2'):
            zwave_base = base_name[:-2]
        else:
            zwave_base = base_name
        
        try:
            # Volume (parameter 1)
            volume_entity = f"number.{zwave_base}_volume"
            volume_state = self._hass.states.get(volume_entity)
            if volume_state and volume_state.state not in ("unknown", "unavailable"):
                try:
                    data["volume"] = int(float(volume_state.state))
                except (ValueError, TypeError):
                    data["volume"] = 2  # Default: Low
            else:
                data["volume"] = 2  # Default: Low
            
            # Auto Relock (parameter 2)
            auto_relock_entity = f"select.{zwave_base}_auto_relock"
            auto_relock_state = self._hass.states.get(auto_relock_entity)
            if auto_relock_state and auto_relock_state.state not in ("unknown", "unavailable"):
                data["auto_relock"] = 255 if auto_relock_state.state == "Enable" else 0
            else:
                data["auto_relock"] = 255  # Default: Enable
            
            # Manual Relock Time (parameter 3)
            manual_entity = f"number.{zwave_base}_manual_relock_time"
            manual_state = self._hass.states.get(manual_entity)
            if manual_state and manual_state.state not in ("unknown", "unavailable"):
                try:
                    data["manual_relock_time"] = int(float(manual_state.state))
                except (ValueError, TypeError):
                    data["manual_relock_time"] = 7  # Default
            else:
                data["manual_relock_time"] = 7  # Default
            
            # Remote Relock Time (parameter 6)
            remote_entity = f"number.{zwave_base}_remote_relock_time"
            remote_state = self._hass.states.get(remote_entity)
            if remote_state and remote_state.state not in ("unknown", "unavailable"):
                try:
                    data["remote_relock_time"] = int(float(remote_state.state))
                except (ValueError, TypeError):
                    data["remote_relock_time"] = 10  # Default
            else:
                data["remote_relock_time"] = 10  # Default
                
        except Exception as err:
            self._logger.warning("Could not fetch config parameters", error=str(err))
            # Set defaults
            data["volume"] = 2
            data["auto_relock"] = 255
            data["manual_relock_time"] = 7
            data["remote_relock_time"] = 10

        return data
