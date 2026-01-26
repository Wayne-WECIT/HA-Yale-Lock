"""Centralized logging for Yale Lock Manager."""
from __future__ import annotations

import logging
from typing import Any

_LOGGER = logging.getLogger(__name__)


class YaleLockLogger:
    """Structured logger for Yale Lock Manager with context-aware logging."""

    def __init__(self, component: str = "yale_lock_manager") -> None:
        """Initialize the logger."""
        self._logger = logging.getLogger(f"custom_components.{component}")
        self._debug_mode = False
        self._component = component

    def set_debug_mode(self, enabled: bool) -> None:
        """Enable or disable debug mode."""
        self._debug_mode = enabled

    def debug_refresh(self, message: str, **kwargs: Any) -> None:
        """Log refresh-specific debug message."""
        if self._debug_mode:
            context = " ".join(f"{k}={v}" for k, v in kwargs.items())
            full_message = f"[REFRESH DEBUG] {message}"
            if context:
                full_message += f" - {context}"
            self._logger.debug(full_message)

    def debug(self, message: str, **kwargs: Any) -> None:
        """Log debug message."""
        if self._debug_mode or kwargs.pop("force", False):
            context = " ".join(f"{k}={v}" for k, v in kwargs.items())
            full_message = message
            if context:
                full_message += f" - {context}"
            self._logger.debug(full_message)

    def info_operation(self, operation: str, slot: int | None = None, **kwargs: Any) -> None:
        """Log operation info message."""
        message = f"{operation}"
        if slot is not None:
            message += f" for slot {slot}"
        context = " ".join(f"{k}={v}" for k, v in kwargs.items())
        if context:
            message += f" - {context}"
        self._logger.info(message)

    def info(self, message: str, **kwargs: Any) -> None:
        """Log info message."""
        context = " ".join(f"{k}={v}" for k, v in kwargs.items())
        full_message = message
        if context:
            full_message += f" - {context}"
        self._logger.info(full_message)

    def warning(self, message: str, **kwargs: Any) -> None:
        """Log warning message."""
        context = " ".join(f"{k}={v}" for k, v in kwargs.items())
        full_message = message
        if context:
            full_message += f" - {context}"
        self._logger.warning(full_message)

    def error_zwave(self, operation: str, error: Exception | str, **kwargs: Any) -> None:
        """Log Z-Wave specific error."""
        error_msg = str(error) if isinstance(error, Exception) else error
        message = f"Z-Wave {operation} failed: {error_msg}"
        context = " ".join(f"{k}={v}" for k, v in kwargs.items())
        if context:
            message += f" - {context}"
        self._logger.error(message, exc_info=isinstance(error, Exception))

    def error(self, message: str, **kwargs: Any) -> None:
        """Log error message."""
        context = " ".join(f"{k}={v}" for k, v in kwargs.items())
        full_message = message
        if context:
            full_message += f" - {context}"
        self._logger.error(full_message, exc_info=kwargs.pop("exc_info", False))
