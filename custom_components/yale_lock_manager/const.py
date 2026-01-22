"""Constants for the Yale Lock Manager integration."""
from typing import Final

DOMAIN: Final = "yale_lock_manager"
VERSION: Final = "1.2.0.1"

# Z-Wave JS Domain
ZWAVE_JS_DOMAIN: Final = "zwave_js"

# Configuration
CONF_LOCK_NODE_ID: Final = "lock_node_id"
CONF_LOCK_ENTITY_ID: Final = "lock_entity_id"
CONF_LOCK_NAME: Final = "lock_name"

# Storage
STORAGE_KEY: Final = f"{DOMAIN}.users"
STORAGE_VERSION: Final = 1

# Z-Wave Command Classes
CC_DOOR_LOCK: Final = 98
CC_USER_CODE: Final = 99
CC_NOTIFICATION: Final = 113
CC_BATTERY: Final = 128
CC_TIME_PARAMETERS: Final = 139

# Z-Wave Properties
PROP_CURRENT_MODE: Final = "currentMode"
PROP_TARGET_MODE: Final = "targetMode"
PROP_DOOR_STATUS: Final = "doorStatus"
PROP_BOLT_STATUS: Final = "boltStatus"
PROP_USER_ID_STATUS: Final = "userIdStatus"
PROP_USER_CODE: Final = "userCode"
PROP_BATTERY_LEVEL: Final = "level"

# Lock States
LOCK_STATE_SECURED: Final = 255
LOCK_STATE_UNSECURED: Final = 0

# User Code Status
USER_STATUS_AVAILABLE: Final = 0
USER_STATUS_ENABLED: Final = 1
USER_STATUS_DISABLED: Final = 2

# Code Types
CODE_TYPE_PIN: Final = "pin"
CODE_TYPE_FOB: Final = "fob"

# Alarm Types (for notifications)
ALARM_TYPE_KEYPAD_UNLOCK: Final = [144, 19]
ALARM_TYPE_AUTO_LOCK: Final = 27
ALARM_TYPE_MANUAL_UNLOCK: Final = 24
ALARM_TYPE_MANUAL_LOCK: Final = 25
ALARM_TYPE_JAMMED: Final = 9

# Access Methods
ACCESS_METHOD_PIN: Final = "pin"
ACCESS_METHOD_FOB: Final = "fob"
ACCESS_METHOD_MANUAL: Final = "manual"
ACCESS_METHOD_REMOTE: Final = "remote"
ACCESS_METHOD_AUTO: Final = "auto"

# Events
EVENT_ACCESS: Final = f"{DOMAIN}_access"
EVENT_LOCKED: Final = f"{DOMAIN}_locked"
EVENT_UNLOCKED: Final = f"{DOMAIN}_unlocked"
EVENT_CODE_EXPIRED: Final = f"{DOMAIN}_code_expired"
EVENT_USAGE_LIMIT_REACHED: Final = f"{DOMAIN}_usage_limit_reached"
EVENT_JAMMED: Final = f"{DOMAIN}_jammed"

# Services
SERVICE_SET_USER_CODE: Final = "set_user_code"
SERVICE_CLEAR_USER_CODE: Final = "clear_user_code"
SERVICE_SET_USER_SCHEDULE: Final = "set_user_schedule"
SERVICE_SET_USAGE_LIMIT: Final = "set_usage_limit"
SERVICE_PUSH_CODE_TO_LOCK: Final = "push_code_to_lock"
SERVICE_PULL_CODES_FROM_LOCK: Final = "pull_codes_from_lock"
SERVICE_ENABLE_USER: Final = "enable_user"
SERVICE_DISABLE_USER: Final = "disable_user"

# Defaults
DEFAULT_SCAN_INTERVAL: Final = 300  # 5 minutes
MIN_CODE_LENGTH: Final = 4
MAX_CODE_LENGTH: Final = 10
MAX_USER_SLOTS: Final = 20

# Attributes
ATTR_SLOT: Final = "slot"
ATTR_CODE: Final = "code"
ATTR_NAME: Final = "name"
ATTR_CODE_TYPE: Final = "code_type"
ATTR_START_DATETIME: Final = "start_datetime"
ATTR_END_DATETIME: Final = "end_datetime"
ATTR_MAX_USES: Final = "max_uses"
ATTR_USER_NAME: Final = "user_name"
ATTR_USER_SLOT: Final = "user_slot"
ATTR_METHOD: Final = "method"
ATTR_TIMESTAMP: Final = "timestamp"
ATTR_USAGE_COUNT: Final = "usage_count"
ATTR_ENABLED: Final = "enabled"
ATTR_SYNCED: Final = "synced_to_lock"
ATTR_LAST_USED: Final = "last_used"
