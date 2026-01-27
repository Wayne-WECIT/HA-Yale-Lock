"""Sync status management for Yale Lock Manager."""
from __future__ import annotations

from typing import Any

from .const import CODE_TYPE_FOB, CODE_TYPE_PIN, USER_STATUS_AVAILABLE
from .logger import YaleLockLogger

_LOGGER = YaleLockLogger()


class SyncManager:
    """Manages sync status calculation and updates."""

    def __init__(self) -> None:
        """Initialize sync manager."""
        self._logger = YaleLockLogger("yale_lock_manager.sync_manager")

    def calculate_sync_status(
        self,
        cached_data: dict[str, Any],
        lock_data: dict[str, Any],
    ) -> bool:
        """Calculate if cached data is synced with lock data.
        
        Sync is based on code existence, not status:
        - If enabled: code must exist on lock AND match cached code
        - If disabled: code must NOT exist on lock (status = AVAILABLE)
        
        Args:
            cached_data: User data from local storage
            lock_data: Data from the lock (status and code)
            
        Returns:
            True if synced, False otherwise
        """
        code_type = cached_data.get("code_type", CODE_TYPE_PIN)
        cached_code = cached_data.get("code", "")
        cached_enabled = cached_data.get("enabled", False)
        
        lock_code = lock_data.get("userCode", "")
        if lock_code is not None:
            lock_code = str(lock_code)
        else:
            lock_code = ""
        
        lock_status = lock_data.get("userIdStatus")
        if lock_status is not None:
            lock_status = int(lock_status)
        else:
            lock_status = USER_STATUS_AVAILABLE
        
        if code_type == CODE_TYPE_PIN:
            # For PINs, sync is based on whether code should be on lock
            # Note: We can't check schedule here, so we use cached_enabled
            # The caller should check schedule if needed
            should_be_enabled = cached_enabled
            
            if should_be_enabled:
                # Should be enabled: code must exist and match
                synced = (
                    lock_status == 1 and  # USER_STATUS_ENABLED
                    lock_code == cached_code and
                    cached_code != ""
                )
            else:
                # Should be disabled: code must NOT exist
                synced = (lock_status == USER_STATUS_AVAILABLE or lock_code == "")
        else:
            # For FOBs, check status only
            should_be_enabled = cached_enabled
            if should_be_enabled:
                synced = (lock_status == 1)  # USER_STATUS_ENABLED
            else:
                synced = (lock_status == USER_STATUS_AVAILABLE)
        
        return synced

    def update_sync_status(
        self,
        user_data: dict[str, Any],
        lock_data: dict[str, Any] | None,
    ) -> None:
        """Update sync status in user data based on lock data.
        
        Sync is based on code existence, not status:
        - If enabled: code must exist on lock AND match cached code
        - If disabled: code must NOT exist on lock (status = AVAILABLE)
        
        Args:
            user_data: User data dictionary to update (modified in place)
            lock_data: Data from the lock (status and code), or None if unavailable
        """
        if lock_data is None:
            user_data["synced_to_lock"] = False
            return
        
        code_type = user_data.get("code_type", CODE_TYPE_PIN)
        cached_code = user_data.get("code", "")
        cached_enabled = user_data.get("enabled", False)
        
        lock_code = lock_data.get("userCode", "")
        if lock_code is not None:
            lock_code = str(lock_code)
        else:
            lock_code = ""
        
        lock_status = lock_data.get("userIdStatus")
        if lock_status is not None:
            lock_status = int(lock_status)
        else:
            lock_status = USER_STATUS_AVAILABLE
        
        # Update lock fields
        user_data["lock_code"] = lock_code
        user_data["lock_status_from_lock"] = lock_status
        from .const import USER_STATUS_ENABLED
        user_data["lock_enabled"] = (lock_status == USER_STATUS_ENABLED)
        
        # Calculate sync status based on code existence
        # Note: We can't check schedule here, so we use cached_enabled
        # The caller should check schedule if needed
        should_be_enabled = cached_enabled
        
        if code_type == CODE_TYPE_PIN:
            if should_be_enabled:
                # Should be enabled: code must exist and match
                user_data["synced_to_lock"] = (
                    lock_status == USER_STATUS_ENABLED and
                    lock_code == cached_code and
                    cached_code != ""
                )
            else:
                # Should be disabled: code must NOT exist
                user_data["synced_to_lock"] = (
                    lock_status == USER_STATUS_AVAILABLE or
                    lock_code == ""
                )
        else:
            # For FOBs, check status only
            if should_be_enabled:
                user_data["synced_to_lock"] = (lock_status == USER_STATUS_ENABLED)
            else:
                user_data["synced_to_lock"] = (lock_status == USER_STATUS_AVAILABLE)
