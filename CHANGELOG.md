# Changelog

All notable changes to this project are documented in this file.

## [0.3.0] - 2026-02-23

### Added
- **Cron Edit Panel**: Edit button on each cron card opens a modal with schedule, payload message, timeout, session target, and delivery mode fields. Save calls `/api/cron/update` (cron.update gateway call). EN/RU i18n.
- **Session Transcript Viewer**: 👁 button on each session row opens a right drawer with chat-bubble history (user right/blue, assistant left/grey, tool calls collapsed). Uses `/api/session/history` → `sessions.history` gateway call.
- **Cost Tracker per Cron**: Async cost badge on each cron card showing `7d: Nx ~$X.XX` from cron run history token data. Falls back to `--` gracefully.
- **Activity Heatmap**: 7×24 grid (Mon–Sun × 0–23h) in Overview tab showing agent activity intensity last 7 days. Color-coded by count, cell tooltips, legend. Loaded via `/api/activity/heatmap`.
- **AI Chat Widget**: Floating 💬 button (bottom-right) opens a chat panel. POST `/api/chat` injects live summary context (sessions, crons, alerts) and queries OpenClaw gateway LLM endpoint. History in sessionStorage, typing indicator, EN/RU.
- `i18n` strings for all 5 new features in both EN and RU

## [0.2.0] - 2026-02-23

### Added
- Triage API + UI for alerts/intel (`new/ack/investigating/resolved/ignored`)
- Sub-agent controls from active tasks (`steer/kill/retry`)
- Incident timeline + weekly review backend endpoints
- RU/EN language switcher and broad UI localization coverage
- Update check/run controls in top bar
- Public GitHub release published (`v0.2.0`) + release workflow docs (`RELEASING.md`)

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
