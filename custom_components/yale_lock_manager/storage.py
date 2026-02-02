"""User data storage management for Yale Lock Manager."""
from __future__ import annotations

import copy
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION, VERSION
from .logger import YaleLockLogger

_LOGGER = YaleLockLogger()


class UserDataStorage:
    """Manages user data persistence."""

    def __init__(self, hass: HomeAssistant, node_id: int) -> None:
        """Initialize storage."""
        self._hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._user_data: dict[str, Any] = {
            "version": VERSION,
            "lock_node_id": node_id,
            "users": {},
        }
        self._logger = YaleLockLogger("yale_lock_manager.storage")

    async def load(self) -> None:
        """Load user data from storage."""
        data = await self._store.async_load()
        if data:
            self._user_data = data
            self._logger.debug("Loaded user data from storage", force=True)
        else:
            self._logger.debug("No existing user data found", force=True)

    async def save(self) -> None:
        """Save user data to storage."""
        await self._store.async_save(self._user_data)
        self._logger.debug("Saved user data to storage", force=True)

    async def clear(self) -> None:
        """Clear all user data."""
        self._logger.info("Clearing all local user data cache")
        self._user_data["users"] = {}
        await self.save()
        self._logger.info("Local cache cleared - all user data removed")

    def get_user(self, slot: int) -> dict[str, Any] | None:
        """Get user data for a specific slot."""
        return self._user_data["users"].get(str(slot))

    def get_all_users(self) -> dict[str, Any]:
        """Get all users."""
        return self._user_data["users"]

    def update_user(self, slot: int, data: dict[str, Any]) -> None:
        """Update user data for a slot."""
        slot_str = str(slot)
        if slot_str in self._user_data["users"]:
            self._user_data["users"][slot_str].update(data)
        else:
            self._user_data["users"][slot_str] = data

    def add_user(self, slot: int, data: dict[str, Any]) -> None:
        """Add a new user."""
        self._user_data["users"][str(slot)] = data

    def remove_user(self, slot: int) -> None:
        """Remove a user."""
        slot_str = str(slot)
        if slot_str in self._user_data["users"]:
            del self._user_data["users"][slot_str]

    def replace_users(self, users: dict[str, Any]) -> None:
        """Replace all users with a deep copy of the given users dict (for import/restore)."""
        self._user_data["users"] = copy.deepcopy(users)

    @property
    def data(self) -> dict[str, Any]:
        """Get the full user data dictionary."""
        return self._user_data

    @data.setter
    def data(self, value: dict[str, Any]) -> None:
        """Set the full user data dictionary."""
        self._user_data = value
