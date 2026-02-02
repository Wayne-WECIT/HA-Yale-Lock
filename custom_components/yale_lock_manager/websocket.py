"""WebSocket API for Yale Lock Manager."""
from __future__ import annotations

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN


@websocket_api.websocket_command(
    {
        "type": "yale_lock_manager/get_notification_services",
    }
)
@websocket_api.callback
def ws_get_notification_services(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Return list of notify services (id, name, type) for the frontend."""
    coordinators = hass.data.get(DOMAIN) or {}
    coordinator = next(iter(coordinators.values()), None)
    if not coordinator:
        connection.send_result(msg["id"], {"services": []})
        return
    services = coordinator.get_notification_services_list()
    connection.send_result(msg["id"], {"services": services})


@websocket_api.websocket_command(
    {
        "type": "yale_lock_manager/export_user_data",
    }
)
@websocket_api.callback
def ws_export_user_data(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Return full user data (storage payload) for backup/export."""
    coordinators = hass.data.get(DOMAIN) or {}
    coordinator = next(iter(coordinators.values()), None)
    if not coordinator:
        connection.send_result(msg["id"], {"data": None})
        return
    data = coordinator.user_data
    connection.send_result(msg["id"], {"data": data})
