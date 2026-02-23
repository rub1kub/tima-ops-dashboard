# Tima Ops Dashboard

Minimal operational dashboard for OpenClaw agents.

## What it does

- Overview of sessions, crons, alerts, recommendations, active tasks
- Live task card (Telegram, sub-agents, AI-fix)
- Incident center + health score + usage guard
- Session model switcher (operator/admin)
- Triage workflow for alerts/intel (`new/ack/investigating/resolved/ignored`)
- Cron controls (run, enable/disable, history, delete, dry-run)
- RU/EN UI language toggle + dark theme

## Stack

- Backend: Node.js ESM (`server.mjs`)
- Frontend: vanilla HTML/CSS/JS (`public/`)
- Data storage: local JSON/JSONL files in `data/`
- OpenClaw integration: shelling out to OpenClaw CLI

## Requirements

- Node.js 22+
- OpenClaw CLI installed and reachable

## Quick start

```bash
git clone <this-repo>
cd tima-ops-dashboard

# optional
cp roles.example.json roles.json

# start
node server.mjs
```

Open: `http://127.0.0.1:3210`

## Environment variables

- `PORT` (default: `3210`)
- `OPENCLAW_BIN` (default command: `openclaw`)
  - Example when PATH is restricted:
    - `OPENCLAW_BIN="/path/to/node /path/to/openclaw.mjs"`

## Project structure

```text
.
├── server.mjs
├── public/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── data/                  # runtime state (ignored)
├── roles.example.json
└── CHANGELOG.md
```

## Security notes

- `data/` is runtime state and is **not committed**.
- Keep `roles.json` local.
- Run your own secret scan before publishing forks.

## Release policy

This repo uses changelog + release updates.

- Every push must include a `CHANGELOG.md` update.
- Future updates must also update GitHub Release state (new version tag/release or release notes update).
- Entries are written in short, user-facing format.
- Detailed flow: `RELEASING.md`.

## License

MIT
