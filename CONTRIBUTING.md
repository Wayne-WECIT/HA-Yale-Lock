# Contributing to Yale Lock Manager

Thank you for your interest in contributing to Yale Lock Manager! This document provides guidelines and instructions for contributing.

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/Wayne-WECIT/HA-Yale-Lock/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Home Assistant version
   - Lock model and firmware version
   - Relevant logs (with sensitive data removed)

### Suggesting Features

1. Check if the feature has already been requested
2. Create a new issue with:
   - Clear use case
   - Proposed implementation (if you have ideas)
   - Why this would benefit users

### Pull Requests

1. Fork the repository
2. Create a new branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Test thoroughly
5. Commit with clear messages
6. Push to your fork
7. Create a Pull Request

#### Code Standards

- Follow PEP 8 style guide
- Use type hints
- Add docstrings for functions/classes
- Keep functions focused and small
- Comment complex logic
- Update README/docs as needed
- When changing features or version: update version in **three places** (`manifest.json`, `const.py`, `CHANGELOG.md`) per project guidelines

#### Testing

- Test with a real Yale lock if possible
- Verify all user code operations
- Check edge cases
- Ensure no existing functionality breaks

### Development Setup

1. Clone the repository
2. Create a development Home Assistant instance
3. Symlink the `custom_components/yale_lock_manager` folder
4. Enable debug logging in HA configuration:

```yaml
logger:
  default: info
  logs:
    custom_components.yale_lock_manager: debug
```

## Questions?

Feel free to open an issue with your question or reach out via GitHub discussions.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
