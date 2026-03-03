# Tima Ops Dashboard 🎛️

> Operational control center for AI agents — built for humans who run AI infrastructure 24/7.

[![Live Demo](https://img.shields.io/badge/Live-v0.2.0-brightgreen)](https://github.com/rub1kub/tima-ops-dashboard/releases/tag/v0.2.0)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## What is it?

When you run multiple AI agents 24/7, you need visibility. Tima Ops Dashboard gives you a single interface to monitor, control, and triage everything happening across your agent fleet — without digging through logs.

Built for [OpenClaw](https://github.com/openclaw/openclaw) but works as a standalone ops tool.

## Features

### 🤖 Agent Fleet Management
- Live session overview across all agents
- Sub-agent spawning and lifecycle controls
- Model switcher per session (operator/admin)
- Real-time typing indicators and status

### 📋 Task & Cron Management
- Live task cards with Telegram/sub-agent/AI-fix actions
- Cron job controls: run, enable/disable, history, dry-run, delete
- Usage guard — alerts when model quota is near limit

### 🚨 Incident Center
- Triage workflow: `new → ack → investigating → resolved/ignored`
- Health score across services
- Intel feed with priority levels

### 📊 Observability
- Session model usage and cost tracking
- Agent response times
- Error rates per channel (Telegram, Discord, etc.)

## Stack

- **Backend:** Node.js + Express, OpenClaw REST API
- **Frontend:** Vanilla JS + CSS (zero framework overhead)
- **Real-time:** SSE (Server-Sent Events) for live updates
- **Auth:** Token-based, operator/admin roles

## Quick Start

```bash
git clone https://github.com/rub1kub/tima-ops-dashboard
cd tima-ops-dashboard
npm install
OPENCLAW_TOKEN=your_token npm start
# → http://localhost:3000
```

## Screenshots

> Dashboard overview, incident center, cron controls — all in one view.

## Why I Built This

Running AI agents in production without visibility is flying blind. Every incident was a manual log-diving session. This dashboard turns that chaos into structured ops workflow.

---

Built by [@rub1kub](https://github.com/rub1kub) · [Release notes](https://github.com/rub1kub/tima-ops-dashboard/releases)
