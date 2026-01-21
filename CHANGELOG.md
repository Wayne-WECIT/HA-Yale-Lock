# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0.1] - 2026-01-21

### Fixed
- Lock detection in config flow - now properly detects Yale locks regardless of model name
- Previously required model to contain "lock", now only checks manufacturer="Yale"

## [1.0.0.0] - 2026-01-21

### Added
- Initial release
- Full Yale lock control (lock/unlock)
- User code management for up to 20 slots
- Support for PIN codes and FOB/RFID cards
- Time-based access scheduling
- Usage limit tracking
- Real-time notification events
- Battery level monitoring
- Door and bolt status sensors
- Last access tracking (user, method, timestamp)
- Lovelace dashboard card with inline controls
- Slot protection to prevent accidental code overwrites
- Manual sync control (no automatic updates)
- Service calls for all lock operations
- HACS compatibility
- Z-Wave JS integration support

### Security
- Slot protection prevents overwriting unknown codes
- Codes stored locally with option for encryption (future)

## [Unreleased]

### Planned Features
- Multi-lock support (currently limited to one lock)
- Enhanced FOB/RFID detection
- Backup and restore functionality
- Advanced automation helpers
- Mobile app integration
- Code encryption in storage
- Duplicate code detection across slots
- Bulk code operations
- Import/export user codes
