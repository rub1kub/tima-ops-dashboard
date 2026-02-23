# Changelog

All notable changes to this project are documented in this file.

## [0.2.0] - 2026-02-23

### Added
- Triage API + UI for alerts/intel (`new/ack/investigating/resolved/ignored`)
- Sub-agent controls from active tasks (`steer/kill/retry`)
- Incident timeline + weekly review backend endpoints
- RU/EN language switcher and broad UI localization coverage
- Update check/run controls in top bar

### Changed
- Active tasks heuristics improved for Telegram recency handling
- Cron handling now supports degraded mode with clearer error normalization
- Session model switching resolves aliases to provider/model format
- Update flow now reports real status (started/skipped/reason) and uses higher timeouts

### Fixed
- `t is not a function` in active tasks renderer
- Cron false-positive degradation due short timeout
- Update button no-op behavior caused by short gateway call timeout
- Multiple localization gaps in EN mode

## [0.1.0] - 2026-02-22

### Added
- Initial operations dashboard backend/frontend
- Alerts, recommendations, sessions, crons, files, skills tabs
- Health score, usage guard, executive report, command palette
- Dark theme and overview cards
