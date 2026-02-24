import http from 'node:http';
import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const historyDir = path.join(dataDir, 'file-history');
const chatUploadsDir = path.join(dataDir, 'chat-uploads');
const tagsFile = path.join(dataDir, 'file-tags.json');
const triageFile = path.join(dataDir, 'triage-state.json');
const operatorEventsFile = path.join(dataDir, 'operator-events.jsonl');
const rolesFile = path.join(__dirname, 'roles.json');
const auditFile = path.join(dataDir, 'audit.log.jsonl');

const host = '127.0.0.1';
const port = Number(process.env.PORT || 3210);
const startedAt = Date.now();

const CACHE_TTL_MS = 15_000;
const DEFAULT_OPENCLAW_NODE = '/home/openclawd/.nvm/versions/node/v22.22.0/bin/node';
const DEFAULT_OPENCLAW_CLI = '/home/openclawd/.nvm/versions/node/v22.22.0/lib/node_modules/openclaw/openclaw.mjs';
const OPENCLAW_BIN = process.env.OPENCLAW_BIN ||
  (existsSync(DEFAULT_OPENCLAW_NODE) && existsSync(DEFAULT_OPENCLAW_CLI)
    ? `${DEFAULT_OPENCLAW_NODE} ${DEFAULT_OPENCLAW_CLI}`
    : 'openclaw');
const HIDDEN_USAGE_PROVIDERS = new Set(['google-antigravity', 'antigravity']);
const AI_FIX_TIMEOUT_MS = 9 * 60 * 1000;
const AI_OP_RETENTION_MS = 12 * 60 * 60 * 1000;
const cache = new Map();
const inflight = new Map();
const aiFixOps = new Map();
const mutationBuckets = new Map();
const triageState = new Map();
const operatorEvents = [];

const ALLOWED_CORE = new Set(['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'TOOLS.md', 'IDENTITY.md', 'HEARTBEAT.md']);

async function ensureFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(historyDir, { recursive: true });
  await fs.mkdir(chatUploadsDir, { recursive: true });
  try { await fs.access(tagsFile); } catch { await fs.writeFile(tagsFile, '{}\n', 'utf8'); }
  try { await fs.access(triageFile); } catch { await fs.writeFile(triageFile, '{}\n', 'utf8'); }
  try { await fs.access(operatorEventsFile); } catch { await fs.writeFile(operatorEventsFile, '', 'utf8'); }
  try { await fs.access(rolesFile); } catch { await fs.writeFile(rolesFile, JSON.stringify({ admin: 'admin' }, null, 2), 'utf8'); }
  try { await fs.access(auditFile); } catch { await fs.writeFile(auditFile, '', 'utf8'); }

  // pre-load triage + operator events
  try {
    const triRaw = await fs.readFile(triageFile, 'utf8');
    const tri = JSON.parse(triRaw || '{}');
    for (const [k, v] of Object.entries(tri || {})) triageState.set(k, v || {});
  } catch {}

  try {
    const raw = await fs.readFile(operatorEventsFile, 'utf8');
    const lines = raw.split('\n').filter(Boolean).slice(-400);
    for (const ln of lines) {
      try { operatorEvents.push(JSON.parse(ln)); } catch {}
    }
  } catch {}
}


function mimeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

function json(res, code, payload) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function runCmd(command, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, maxBuffer: 24 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || stdout?.trim() || error.message));
        return;
      }
      resolve((stdout || '').toString());
    });
  });
}

function extractJson(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object in command output');
  return JSON.parse(text.slice(start));
}


function extractAgentReplyText(rawOutput) {
  const raw = String(rawOutput || '').trim();
  if (!raw) return '';

  try {
    const parsed = extractJson(raw);

    // openclaw agent --json shape: result.payloads[].text
    const payloadTexts = Array.isArray(parsed?.result?.payloads)
      ? parsed.result.payloads
          .map(p => (typeof p?.text === 'string' ? p.text.trim() : ''))
          .filter(Boolean)
      : [];
    if (payloadTexts.length) return payloadTexts.join('\n\n').trim();

    // Generic fallbacks for other response shapes
    const candidates = [
      parsed?.message?.content,
      parsed?.result?.message?.content,
      parsed?.result?.text,
      parsed?.content,
      parsed?.text,
      parsed?.reply,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
  } catch {
    // not JSON or partially logged output — keep raw fallback below
  }

  return raw;
}

function shQuote(text) {
  return `'${String(text).replace(/'/g, `'"'"'`)}'`;
}

function extFromMimeType(mime) {
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/heic': '.heic',
  };
  return map[String(mime || '').toLowerCase()] || '.bin';
}

function parseDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const m = raw.match(/^data:([^;]+);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!m) throw new Error('Invalid data URL');
  const mimeType = String(m[1] || '').toLowerCase();
  const b64 = String(m[2] || '').replace(/\s+/g, '');
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length) throw new Error('Empty attachment');
  return { mimeType, buffer };
}

async function storeChatAttachments(rawItems = []) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const limited = items.slice(0, 4);
  const maxBytesPerFile = 8 * 1024 * 1024;
  const out = [];

  for (const item of limited) {
    const dataUrl = String(item?.dataUrl || '').trim();
    if (!dataUrl) continue;

    const { mimeType, buffer } = parseDataUrl(dataUrl);
    if (!mimeType.startsWith('image/')) throw new Error('Only image attachments are supported');
    if (buffer.length > maxBytesPerFile) throw new Error('Attachment is too large (max 8MB each)');

    const safeBase = path.basename(String(item?.name || 'image')).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64) || 'image';
    const ext = extFromMimeType(mimeType);
    const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}${safeBase.endsWith(ext) ? '' : ext}`;
    const fullPath = path.join(chatUploadsDir, fileName);
    await fs.writeFile(fullPath, buffer);
    out.push({ name: safeBase, path: fullPath, mimeType, sizeBytes: buffer.length });
  }

  return out;
}

function extractRunTokens(run) {
  // Standard shape from cron runs: run.usage.{input_tokens, output_tokens, total_tokens}
  const usages = [
    run?.usage,
    run?.tokens,
    run?.result?.usage,
    run?.result?.tokens,
    run?.summary?.usage,
    run?.summary?.tokens,
  ].filter(u => u && typeof u === 'object');

  let inputTokens = 0;
  let outputTokens = 0;

  for (const u of usages) {
    inputTokens += Number(
      u?.input_tokens ?? u?.inputTokens ?? u?.prompt_tokens ?? u?.promptTokens ?? u?.input ?? u?.prompt ?? u?.in ?? 0
    );
    outputTokens += Number(
      u?.output_tokens ?? u?.outputTokens ?? u?.completion_tokens ?? u?.completionTokens ?? u?.output ?? u?.completion ?? u?.out ?? 0
    );
  }

  if (!inputTokens && !outputTokens) {
    inputTokens = Number(run?.inputTokens ?? run?.promptTokens ?? run?.prompt_tokens ?? 0);
    outputTokens = Number(run?.outputTokens ?? run?.completionTokens ?? run?.completion_tokens ?? 0);
  }

  return {
    inputTokens: Math.max(0, Math.round(inputTokens)),
    outputTokens: Math.max(0, Math.round(outputTokens)),
  };
}

// Resolve short model aliases to full provider/model strings that gateway accepts
const MODEL_ALIAS_MAP = {
  'default': null,
  'opus': 'anthropic/claude-opus-4-6',
  'sonnet': 'anthropic/claude-sonnet-4-6',
  'claude-opus-4-6': 'anthropic/claude-opus-4-6',
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
  'claude-opus-4': 'anthropic/claude-opus-4',
  'claude-sonnet-4': 'anthropic/claude-sonnet-4',
  'gpt-5.3-codex': 'openai-codex/gpt-5.3-codex',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
};

function resolveModel(rawModel) {
  if (!rawModel || rawModel === 'default') return null;
  if (MODEL_ALIAS_MAP[rawModel] !== undefined) return MODEL_ALIAS_MAP[rawModel];
  // Already has provider prefix (e.g. anthropic/claude-opus-4-6)
  if (rawModel.includes('/')) return rawModel;
  // Bare claude model names → try anthropic
  if (rawModel.startsWith('claude-')) return `anthropic/${rawModel}`;
  // Bare gpt names → try openai
  if (rawModel.startsWith('gpt-')) return `openai/${rawModel}`;
  return rawModel;
}

async function setSessionModelOverride(sessionKey, model) {
  const key = validateSessionKey(sessionKey);
  const rawModel = String(model ?? '').trim();
  if (!rawModel) throw new Error('model is required');
  const normalizedModel = resolveModel(rawModel);
  if (normalizedModel && !/^[a-zA-Z0-9._/-]+$/.test(normalizedModel)) throw new Error('invalid model');

  const params = JSON.stringify({ key, model: normalizedModel });
  const cmd = `${OPENCLAW_BIN} gateway call sessions.patch --params ${shQuote(params)} --json 2>/dev/null`;
  const out = await runCmd(cmd, 30_000);
  const parsed = extractJson(out);
  if (!parsed?.ok) throw new Error(parsed?.error?.message || 'failed to patch session model');

  invalidate(['status', 'summary-api']);
  return {
    key,
    model: normalizedModel || 'default',
    resolved: parsed?.resolved || null,
  };
}

function pushAiEvent(op, text, level = 'info') {
  if (!op.events) op.events = [];
  op.events.push({ ts: Date.now(), level, text: String(text || '') });
  if (op.events.length > 40) op.events = op.events.slice(-40);
}

function setAiProgress(op, { step, percent, etaMs, eventText = null, level = 'info' } = {}) {
  if (step) op.step = step;
  if (Number.isFinite(percent)) op.progressPercent = Math.max(0, Math.min(100, Math.round(percent)));
  if (etaMs == null) {
    op.etaMs = null;
    op.etaAtMs = null;
  } else {
    const eta = Math.max(0, Number(etaMs) || 0);
    op.etaMs = eta;
    op.etaAtMs = Date.now() + eta;
  }
  if (eventText) pushAiEvent(op, eventText, level);
  op.updatedAtMs = Date.now();
}

function updateRunningAiProgress(op) {
  if (!op || op.status !== 'running') return;
  const elapsed = Date.now() - op.createdAtMs;
  const raw = 18 + (elapsed / AI_FIX_TIMEOUT_MS) * 74;
  const nextPct = Math.max(op.progressPercent || 0, Math.min(92, Math.floor(raw)));

  let nextStep = 'diagnostics';
  if (nextPct >= 70) nextStep = 'verification';
  else if (nextPct >= 45) nextStep = 'applying';

  const prevStep = op.step;
  op.progressPercent = nextPct;
  op.step = nextStep;
  op.etaMs = Math.max(0, AI_FIX_TIMEOUT_MS - elapsed);
  op.etaAtMs = Date.now() + op.etaMs;
  op.updatedAtMs = Date.now();

  if (prevStep !== nextStep) {
    const map = {
      diagnostics: 'Собираю диагностику и контекст проблемы',
      applying: 'Применяю безопасный фикс',
      verification: 'Проверяю, что фикс сработал',
    };
    pushAiEvent(op, map[nextStep] || 'Прогресс задачи обновлён');
  }
}

function pruneAiFixOps() {
  const now = Date.now();
  for (const [id, op] of aiFixOps.entries()) {
    if (now - op.createdAtMs > AI_OP_RETENTION_MS) aiFixOps.delete(id);
  }
  const entries = [...aiFixOps.entries()].sort((a, b) => b[1].createdAtMs - a[1].createdAtMs);
  for (const [id] of entries.slice(120)) aiFixOps.delete(id);
}

function settleAiFixTimeouts() {
  const now = Date.now();
  for (const op of aiFixOps.values()) {
    if (op.status === 'running' && now - op.createdAtMs > AI_FIX_TIMEOUT_MS) {
      op.status = 'error';
      op.error = 'operation timeout';
      setAiProgress(op, { step: 'failed', percent: Math.max(op.progressPercent || 0, 95), etaMs: null, eventText: 'Таймаут операции (9 минут)', level: 'error' });
    }
  }
}

function aiOpPublic(op) {
  return {
    id: op.id,
    status: op.status,
    source: op.source,
    kind: op.kind,
    title: op.title,
    createdAtMs: op.createdAtMs,
    updatedAtMs: op.updatedAtMs,
    startedBy: op.startedBy,
    error: op.error || null,
    resultText: op.resultText || null,
    step: op.step || null,
    progressPercent: Number.isFinite(op.progressPercent) ? op.progressPercent : null,
    etaMs: Number.isFinite(op.etaMs) ? op.etaMs : null,
    etaAt: msToIso(op.etaAtMs),
    events: (op.events || []).slice(-12),
  };
}

function parseTelegramTargetFromSessionKey(key) {
  const parts = String(key || '').split(':');
  const idx = parts.indexOf('telegram');
  if (idx === -1) return null;
  return parts[idx + 2] || null;
}

function mapTelegramSessionToTask(s) {
  const ageMs = Number(s?.age ?? s?.ageMs ?? 0);
  if (ageMs > 6 * 60_000) return null;

  const key = String(s?.key || '');
  const chatTarget = parseTelegramTargetFromSessionKey(key);
  const agentId = s?.agentId || (key.split(':')[1] || 'unknown');
  const updatedAtMs = Number(s?.updatedAt || 0);
  const contextPct = Number.isFinite(s?.percentUsed) ? Number(s.percentUsed) : null;
  const model = s?.model || 'unknown';

  let step = 'tg-thinking';
  let progressPercent = 64;
  let etaMs = 60_000;
  let status = 'running';

  if (ageMs <= 25_000) {
    step = 'tg-responding';
    progressPercent = 86;
    etaMs = 20_000;
  } else if (ageMs <= 90_000) {
    step = 'tg-thinking';
    progressPercent = 64;
    etaMs = 60_000;
  } else if (ageMs <= 6 * 60_000) {
    step = 'tg-finished';
    progressPercent = 100;
    status = 'done';
    etaMs = 0;
  }

  const contextText = contextPct == null ? 'н/д' : `${Math.max(0, Math.min(100, contextPct))}%`;
  const baseTs = updatedAtMs || Date.now();
  const deliveryTrace = {
    inbound: baseTs - Math.min(ageMs, 60_000),
    thinking: baseTs - Math.min(ageMs, 35_000),
    sendAttempt: baseTs - Math.min(ageMs, 10_000),
    delivered: status === 'done' ? baseTs : null,
    messageId: null,
  };

  const events = [
    { ts: deliveryTrace.inbound, level: 'info', text: 'Trace: inbound получен' },
    { ts: deliveryTrace.thinking, level: 'info', text: 'Trace: агент формирует ответ' },
    { ts: deliveryTrace.sendAttempt, level: 'info', text: 'Trace: message.send вызван' },
    { ts: updatedAtMs || Date.now(), level: 'info', text: `Последняя активность ${humanDuration(ageMs)} назад` },
    { ts: updatedAtMs || Date.now(), level: 'info', text: `Модель: ${model}` },
    { ts: updatedAtMs || Date.now(), level: 'info', text: `Контекст: ${contextText}` },
  ];
  if (status === 'done') events.unshift({ ts: deliveryTrace.delivered || baseTs, level: 'ok', text: 'Trace: доставлено (messageId недоступен)' });
  if (chatTarget) events.unshift({ ts: updatedAtMs || Date.now(), level: 'info', text: `Чат: ${chatTarget}` });

  return {
    id: `telegram:${key}`,
    taskType: 'telegram-live',
    source: 'telegram',
    kind: 'session',
    title: `${agentId}: Telegram диалог`,
    status,
    createdAtMs: updatedAtMs || Date.now(),
    updatedAtMs: updatedAtMs || Date.now(),
    startedBy: 'system',
    error: null,
    resultText: null,
    step,
    progressPercent,
    etaMs,
    etaAt: etaMs != null ? msToIso(Date.now() + etaMs) : null,
    events,
    active: status === 'running',
    sessionKey: key,
    agentId,
    model,
    chatTarget,
    contextPercent: contextPct,
    sessionId: s?.sessionId || null,
    deliveryTrace,
  };
}

function isSubagentSessionKey(key) {
  const k = String(key || '');
  return k.includes(':thread:') || k.includes(':spawn:') || k.includes(':subagent:');
}

function mapSubagentSessionToTask(s) {
  const ageMs = Number(s?.age ?? s?.ageMs ?? 0);
  if (ageMs > 30 * 60_000) return null;

  const key = String(s?.key || '');
  const agentId = s?.agentId || (key.split(':')[1] || 'unknown');
  const updatedAtMs = Number(s?.updatedAt || 0);
  const model = s?.model || 'unknown';
  const threadId = key.includes(':thread:') ? key.split(':thread:')[1] : null;

  const running = ageMs <= 3 * 60_000;
  const progressPercent = running ? Math.max(35, 85 - Math.floor(ageMs / 7000)) : 100;
  const step = running ? 'subagent-running' : 'subagent-finished';
  const status = running ? 'running' : 'done';

  const events = [
    { ts: updatedAtMs || Date.now(), level: 'info', text: `Последняя активность ${humanDuration(ageMs)} назад` },
    { ts: updatedAtMs || Date.now(), level: 'info', text: `Модель: ${model}` },
  ];
  if (threadId) events.unshift({ ts: updatedAtMs || Date.now(), level: 'info', text: `Thread: ${threadId}` });
  if (!running) events.unshift({ ts: updatedAtMs || Date.now(), level: 'ok', text: 'Sub-agent завершил активную фазу' });

  return {
    id: `subagent:${key}`,
    taskType: 'subagent-live',
    source: 'subagent',
    kind: 'session',
    title: `${agentId}: Sub-agent`,
    status,
    createdAtMs: updatedAtMs || Date.now(),
    updatedAtMs: updatedAtMs || Date.now(),
    startedBy: 'system',
    error: null,
    resultText: null,
    step,
    progressPercent,
    etaMs: running ? Math.max(30_000, 180_000 - ageMs) : 0,
    etaAt: running ? msToIso(Date.now() + Math.max(30_000, 180_000 - ageMs)) : msToIso(Date.now()),
    events,
    active: running,
    sessionKey: key,
    sessionId: s?.sessionId || null,
    agentId,
    model,
    controls: { canSteer: true, canKill: true, canRetry: true },
  };
}

async function collectActiveTasks() {
  settleAiFixTimeouts();
  pruneAiFixOps();

  const now = Date.now();
  const aiItems = [...aiFixOps.values()]
    .filter(op => op.status === 'running' || now - op.updatedAtMs < 15 * 60 * 1000)
    .map(op => ({
      taskType: 'ai-fix',
      active: op.status === 'running',
      ...aiOpPublic(op),
    }));

  let telegramItems = [];
  let subagentItems = [];
  try {
    const status = await openclawStatus();
    const sessions = status?.sessions?.recent || [];
    telegramItems = sessions
      .filter(s => String(s?.key || '').includes(':telegram:'))
      .map(mapTelegramSessionToTask)
      .filter(Boolean)
      .slice(0, 12);

    subagentItems = sessions
      .filter(s => isSubagentSessionKey(s?.key))
      .map(mapSubagentSessionToTask)
      .filter(Boolean)
      .slice(0, 10);
  } catch {}

  const items = [...aiItems, ...telegramItems, ...subagentItems]
    .sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      return (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
    })
    .slice(0, 30);

  return { items, updatedAt: new Date().toISOString() };
}

function buildAiFixPrompt(payload) {
  const title = payload?.title || 'Unknown issue';
  const details = payload?.details || '';
  const kind = payload?.kind || 'generic';
  const cronId = payload?.cronId || payload?.jobId || null;
  const sessionKey = payload?.sessionKey || null;
  const checkId = payload?.checkId || null;

  let task = `Ты SRE-агент OpenClaw.\nЗадача: автоматически исправить проблему и отчитаться.\n\nIssue:\n- title: ${title}\n- details: ${details}\n- kind: ${kind}\n`;

  if (cronId) {
    task += `\nКонтекст cron: id=${cronId}.\n`;
    task += `Действия:\n1) Посмотри историю запусков этого cron (последние 5).\n2) Определи вероятную причину ошибки.\n3) Выполни безопасный фикс (если возможно) и запусти cron вручную 1 раз.\n4) Если ошибка сохраняется — временно отключи cron и объясни почему.\n`;
  }

  if (sessionKey) {
    task += `\nКонтекст сессии: key=${sessionKey}.\n`;
    task += `Если проблема в высоком контексте: выполни безопасную компактную очистку/сброс контекста по best practices без потери критичных данных.\n`;
  }

  if (checkId) {
    task += `\nКонтекст security checkId=${checkId}.\n`;
    if (String(checkId).includes('trusted_proxies')) {
      task += `Если это предупреждение про trusted proxies и reverse proxy локальный, примени безопасный фикс через config.patch (например, trustedProxies: [\"127.0.0.1\",\"::1\"]).\n`;
    }
  }

  task += `\nОграничения:\n- Делай только безопасные обратимые изменения.\n- Не удаляй данные.\n- Не отправляй сообщения пользователю.\n\nФормат финального ответа:\n- status: fixed | mitigated | failed\n- actions: список шагов\n- verification: что проверил\n- next: что делать дальше при необходимости\n`;
  return task;
}

function startAiFixOperation(payload, user = 'unknown') {
  pruneAiFixOps();
  settleAiFixTimeouts();

  const source = payload?.source || 'unknown';
  const kind = payload?.item?.kind || payload?.kind || 'generic';
  const title = payload?.item?.title || payload?.title || 'AI fix task';

  // de-duplicate running jobs for the same issue
  const existing = [...aiFixOps.values()].find(op =>
    op.status === 'running' && op.source === source && op.kind === kind && op.title === title
  );
  if (existing) return aiOpPublic(existing);

  const op = {
    id: randomUUID(),
    status: 'running',
    source,
    kind,
    title,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    startedBy: user,
    error: null,
    resultText: null,
    step: 'queued',
    progressPercent: 6,
    etaMs: AI_FIX_TIMEOUT_MS,
    etaAtMs: Date.now() + AI_FIX_TIMEOUT_MS,
    events: [],
  };

  pushAiEvent(op, 'Задача поставлена в очередь');
  aiFixOps.set(op.id, op);
  logOperatorEvent({ kind: 'ai-fix', title: `AI fix started: ${title}`, details: `source=${source}, kind=${kind}`, actor: user, level: 'info', meta: { opId: op.id, source, kind } });

  const prompt = buildAiFixPrompt(payload?.item || payload || {});
  const cmd = `${OPENCLAW_BIN} agent --agent tima --to 1084693264 --message ${shQuote(prompt)} --json --timeout 420 2>/dev/null`;

  setAiProgress(op, { step: 'prepare', percent: 12, etaMs: AI_FIX_TIMEOUT_MS, eventText: 'Подготовка runbook и плана фикса' });

  (async () => {
    let ticker = null;
    try {
      setAiProgress(op, { step: 'diagnostics', percent: 18, etaMs: AI_FIX_TIMEOUT_MS, eventText: 'Запускаю SRE-агента для диагностики' });
      ticker = setInterval(() => updateRunningAiProgress(op), 5000);

      const out = await runCmd(cmd, 480_000);
      const shortOut = String(out || '').slice(-4000);
      let resultText = shortOut;
      try {
        const parsed = extractJson(shortOut);
        resultText = JSON.stringify(parsed, null, 2).slice(-4000);
      } catch {}
      op.status = 'done';
      op.resultText = resultText;
      setAiProgress(op, { step: 'completed', percent: 100, etaMs: 0, eventText: 'Исправление завершено' , level: 'ok'});
      logOperatorEvent({ kind: 'ai-fix', title: `AI fix done: ${title}`, details: 'completed', actor: user, level: 'ok', meta: { opId: op.id } });
    } catch (e) {
      op.status = 'error';
      op.error = e?.message || 'ai fix failed';
      setAiProgress(op, { step: 'failed', percent: Math.max(op.progressPercent || 0, 95), etaMs: null, eventText: `Ошибка: ${op.error}`, level: 'error' });
      logOperatorEvent({ kind: 'ai-fix', title: `AI fix failed: ${title}`, details: op.error, actor: user, level: 'error', meta: { opId: op.id } });
    } finally {
      if (ticker) clearInterval(ticker);
      op.updatedAtMs = Date.now();
    }
  })();

  return aiOpPublic(op);
}

function humanDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function msToIso(ms) { return ms ? new Date(ms).toISOString() : null; }

function normalizeSession(s) {
  const ageMs = Number(s.age ?? s.ageMs ?? 0);
  return {
    key: s.key,
    agentId: s.agentId || (s.key?.split(':')[1] ?? 'unknown'),
    model: s.model || 'unknown',
    percentUsed: Number.isFinite(s.percentUsed) ? s.percentUsed : null,
    updatedAt: s.updatedAt ?? null,
    ageMs,
    ageLabel: humanDuration(ageMs),
    kind: s.kind || 'direct',
    abortedLastRun: !!s.abortedLastRun,
  };
}

function validateCronId(id) {
  if (!id || typeof id !== 'string') throw new Error('cron id is required');
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('invalid cron id format');
  return id;
}

function validateAgentId(id) {
  if (!id || typeof id !== 'string') throw new Error('agentId is required');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('invalid agentId');
  return id;
}

function validateSkillSlug(slug) {
  if (!slug || typeof slug !== 'string') throw new Error('slug is required');
  if (!/^[a-zA-Z0-9._-]+$/.test(slug)) throw new Error('invalid skill slug');
  return slug;
}

function validateSessionKey(key) {
  if (!key || typeof key !== 'string') throw new Error('session key is required');
  const trimmed = key.trim();
  if (!/^agent:[a-zA-Z0-9_-]+:[\w:-]+$/.test(trimmed)) throw new Error('invalid session key');
  return trimmed;
}

function invalidate(keys = []) {
  if (!keys.length) {
    cache.clear();
    inflight.clear();
    return;
  }
  for (const k of keys) {
    cache.delete(k);
    inflight.delete(k);
  }
}

async function cached(key, producer, ttlMs) {
  const now = Date.now();
  const c = cache.get(key);
  const ttl = ttlMs ?? CACHE_TTL_MS;
  if (c && now - c.ts < ttl) return c.value;

  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    const value = await producer();
    cache.set(key, { ts: Date.now(), value });
    return value;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, p);
  return p;
}

async function openclawStatus() {
  // status call can be heavy; keep warm cache for 60s to avoid frontend timeouts
  return cached('status', async () => {
    const out = await runCmd(`${OPENCLAW_BIN} status --json 2>/dev/null`);
    return extractJson(out);
  }, 60_000);
}

async function openclawStatusUsage() {
  return cached('status-usage', async () => {
    const out = await runCmd(`${OPENCLAW_BIN} status --usage --json 2>/dev/null`, 45_000);
    return extractJson(out);
  }, 60_000);
}

async function openclawCliVersion() {
  return cached('cli-version', async () => {
    const out = await runCmd(`${OPENCLAW_BIN} --version 2>/dev/null`, 15_000);
    const txt = String(out || '').trim();
    const m = txt.match(/(\d{4}\.\d+\.\d+-\d+)/);
    if (m?.[1]) return m[1];
    const first = txt.split(/\s+/).find(Boolean);
    return first || null;
  }, 120_000);
}

function normalizeCronError(err) {
  const raw = String(err?.message || err || 'cron list failed').trim();
  if (/gateway timeout/i.test(raw)) return 'gateway timeout while fetching cron list';
  if (/No JSON object/i.test(raw)) return 'invalid cron list response';
  if (/Command failed:/i.test(raw)) return 'failed to read cron list (CLI command error)';
  return raw;
}

async function openclawCrons() {
  const stale = cache.get('crons')?.value || null;
  try {
    return await cached('crons', async () => {
      // cron list can be slow on busy gateway; avoid false degraded alerts
      const out = await runCmd(`${OPENCLAW_BIN} cron list --json --timeout 60000 2>/dev/null`, 70_000);
      const parsed = extractJson(out);
      return { ...parsed, _meta: { degraded: false, error: null } };
    }, 30_000);
  } catch (e) {
    const normalized = normalizeCronError(e);
    if (stale) {
      return {
        ...stale,
        _meta: {
          degraded: true,
          stale: true,
          error: normalized,
        },
      };
    }
    return {
      jobs: [],
      _meta: {
        degraded: true,
        stale: false,
        error: normalized,
      },
    };
  }
}

async function openclawSkillsIndex() {
  // Cache for 5 minutes — this CLI call takes ~3s and skills rarely change
  return cached('skills-index', async () => {
    const out = await runCmd(`${OPENCLAW_BIN} skills list --json 2>/dev/null`);
    return extractJson(out);
  }, 300_000);
}

async function getAgentMap() {
  const status = await openclawStatus();
  const items = status?.agents?.agents || [];
  const map = {};
  for (const a of items) {
    if (a?.id && a?.workspaceDir) map[a.id] = a.workspaceDir;
  }
  return map;
}

async function loadRoles() {
  const raw = await fs.readFile(rolesFile, 'utf8');
  let roles = {};
  try { roles = JSON.parse(raw); } catch { roles = {}; }
  return roles;
}

async function getUserContext(req) {
  const roles = await loadRoles();
  const user = (req.headers['x-forwarded-user'] || req.headers['x-remote-user'] || 'unknown').toString().trim();
  const role = roles[user] || 'viewer';
  return { user, role };
}


function enforceMutationRate(ctx) {
  const key = `${ctx.user}:${ctx.role}`;
  const now = Date.now();
  const bucket = mutationBuckets.get(key) || { count: 0, resetAt: now + 60_000 };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + 60_000;
  }
  bucket.count += 1;
  mutationBuckets.set(key, bucket);
  if (bucket.count > 40) {
    const err = new Error('too many write actions, slow down');
    err.code = 429;
    throw err;
  }
}

async function auditLog(ctx, action, payload = {}, ok = true, note = '') {
  const rec = {
    ts: new Date().toISOString(),
    user: ctx.user,
    role: ctx.role,
    action,
    ok,
    note,
    payload,
  };
  await fs.appendFile(auditFile, JSON.stringify(rec) + '\n', 'utf8');
}

function triageStoreKey(kind, itemKey) {
  return `${String(kind || 'alert').toLowerCase()}:${String(itemKey || '').trim()}`;
}

async function persistTriageState() {
  const obj = Object.fromEntries(triageState.entries());
  await fs.writeFile(triageFile, JSON.stringify(obj, null, 2), 'utf8');
}

function getTriage(kind, itemKey) {
  return triageState.get(triageStoreKey(kind, itemKey)) || null;
}

async function setTriage(kind, itemKey, patch = {}, user = 'unknown') {
  const k = triageStoreKey(kind, itemKey);
  const prev = triageState.get(k) || {};
  const next = {
    status: patch.status || prev.status || 'new',
    owner: patch.owner != null ? String(patch.owner) : (prev.owner || ''),
    dueAt: patch.dueAt === null ? null : (patch.dueAt || prev.dueAt || null),
    notes: patch.notes != null ? String(patch.notes) : (prev.notes || ''),
    updatedAt: new Date().toISOString(),
    updatedBy: user,
  };
  triageState.set(k, next);
  await persistTriageState();
  await logOperatorEvent({ kind: 'triage', title: `Triage updated: ${k}`, details: `${next.status}${next.owner ? ` · owner=${next.owner}` : ''}`, level: 'info', actor: user, meta: { key: k, ...next } });
  return { key: k, ...next };
}

function listTriage(kind = null) {
  const out = {};
  for (const [k, v] of triageState.entries()) {
    if (!kind || k.startsWith(`${String(kind).toLowerCase()}:`)) out[k] = v;
  }
  return out;
}

async function logOperatorEvent({ kind = 'system', title = '', details = '', level = 'info', actor = 'system', meta = {} } = {}) {
  const rec = {
    id: randomUUID(),
    ts: Date.now(),
    kind,
    level,
    actor,
    title: String(title || kind),
    details: String(details || ''),
    meta: meta || {},
  };
  operatorEvents.push(rec);
  while (operatorEvents.length > 500) operatorEvents.shift();
  await fs.appendFile(operatorEventsFile, JSON.stringify(rec) + '\n', 'utf8').catch(() => {});
  return rec;
}

async function collectOperatorNow() {
  const active = await collectActiveTasks();
  const activeItems = (active.items || []).filter(x => x.status === 'running').slice(0, 10);
  const recent = operatorEvents.slice(-30).reverse();
  return {
    active: activeItems,
    recent,
    updatedAt: new Date().toISOString(),
  };
}

async function collectTimeline() {
  const active = await collectActiveTasks();
  const rows = [];

  for (const ev of operatorEvents.slice(-120)) {
    rows.push({
      ts: ev.ts,
      source: 'operator',
      level: ev.level || 'info',
      title: ev.title,
      details: ev.details,
      meta: ev.meta || {},
    });
  }

  for (const t of (active.items || []).slice(0, 20)) {
    for (const ev of (t.events || []).slice(-8)) {
      rows.push({
        ts: ev.ts || t.updatedAtMs || Date.now(),
        source: t.taskType || 'task',
        level: ev.level || (t.status === 'error' ? 'error' : 'info'),
        title: t.title || t.id,
        details: ev.text || '',
        taskId: t.id,
      });
    }
  }

  rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return { entries: rows.slice(0, 200), updatedAt: new Date().toISOString() };
}

function collectWeeklyReview() {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const events = operatorEvents.filter(e => e.ts >= since);
  const byKind = {};
  const byLevel = {};
  for (const ev of events) {
    byKind[ev.kind] = (byKind[ev.kind] || 0) + 1;
    byLevel[ev.level] = (byLevel[ev.level] || 0) + 1;
  }

  const triage = listTriage();
  const triageCounts = { new: 0, ack: 0, investigating: 0, resolved: 0, ignored: 0 };
  for (const t of Object.values(triage)) {
    const st = String(t?.status || 'new').toLowerCase();
    triageCounts[st] = (triageCounts[st] || 0) + 1;
  }

  return {
    window: '7d',
    eventsTotal: events.length,
    byKind,
    byLevel,
    triage: triageCounts,
    updatedAt: new Date().toISOString(),
  };
}

function assertRole(ctx, allowed = []) {
  if (!allowed.includes(ctx.role)) {
    const err = new Error('forbidden');
    err.code = 403;
    throw err;
  }
}

async function collectSummary() {
  const [status, crons, cliVersion] = await Promise.all([openclawStatus(), openclawCrons(), openclawCliVersion()]);
  const sessions = (status?.sessions?.recent || []).map(normalizeSession);
  const activeSessions = sessions.filter(s => s.ageMs < 60 * 60 * 1000);
  const jobs = crons?.jobs || [];
  const enabledJobs = jobs.filter(j => j.enabled);

  return {
    app: {
      name: 'Tima Ops Dashboard',
      version: cliVersion || status?.gateway?.self?.version || status?.update?.registry?.latestVersion || 'unknown',
      uptime: humanDuration(Date.now() - startedAt),
      updatedAt: new Date().toISOString(),
    },
    openclaw: {
      host: status?.gateway?.self?.host || 'unknown',
      ip: status?.gateway?.self?.ip || null,
      defaultModel: status?.sessions?.defaults?.model || 'unknown',
      totalSessions: status?.sessions?.count || 0,
      activeSessions: activeSessions.length,
      totalCrons: jobs.length,
      enabledCrons: enabledJobs.length,
      cronDegraded: !!crons?._meta?.degraded,
      cronError: crons?._meta?.error || null,
      securityWarn: Number(status?.securityAudit?.summary?.warn || 0),
      securityCritical: Number(status?.securityAudit?.summary?.critical || 0),
      agents: (status?.agents?.agents || []).map(a => ({ id: a.id, name: a.name || a.id, workspaceDir: a.workspaceDir, lastActiveAgeMs: a.lastActiveAgeMs || null })),
    },
  };
}

async function collectUpdateInfo() {
  const [status, cliVersion] = await Promise.all([openclawStatus(), openclawCliVersion()]);
  // Prefer local CLI/package version for update UX; gateway self version can lag after daemon restarts.
  const current = cliVersion || status?.gateway?.self?.version || null;
  const latest = status?.update?.registry?.latestVersion || null;
  const available = !!(current && latest && current !== latest);
  return {
    current,
    latest,
    available,
    checkedAt: new Date().toISOString(),
  };
}

async function runOpenclawUpdateNow() {
  // Run update synchronously so UI can show a truthful status (started/skipped/reason)
  const cmd = `${OPENCLAW_BIN} gateway call update.run --timeout 180000 --json 2>/dev/null`;
  const out = await runCmd(cmd, 190_000);
  return extractJson(out);
}

async function collectUsage() {
  const status = await openclawStatusUsage();
  const providers = (status?.usage?.providers || [])
    .filter(p => !HIDDEN_USAGE_PROVIDERS.has(String(p?.provider || '').toLowerCase()))
    .map(p => {
      const windows = (p.windows || []).map(w => {
        const used = Number(w.usedPercent || 0);
        const remaining = Math.max(0, Math.min(100, 100 - used));
        return {
          label: w.label || 'window',
          usedPercent: used,
          remainingPercent: remaining,
          resetAt: msToIso(w.resetAt),
        };
      });
      return {
        provider: p.provider,
        displayName: p.displayName || p.provider,
        plan: p.plan || null,
        error: p.error || null,
        windows,
      };
    });

  return {
    updatedAt: msToIso(status?.usage?.updatedAt) || new Date().toISOString(),
    providers,
  };
}

async function collectSessions({ agentId = 'all', q = '' } = {}) {
  const status = await openclawStatus();
  const qq = (q || '').toLowerCase();
  let sessions = (status?.sessions?.recent || []).map(normalizeSession);
  if (agentId !== 'all') sessions = sessions.filter(s => s.agentId === agentId);
  if (qq) sessions = sessions.filter(s => `${s.key} ${s.model} ${s.agentId}`.toLowerCase().includes(qq));
  return sessions.sort((a, b) => a.ageMs - b.ageMs).slice(0, 80);
}

async function collectCrons({ agentId = 'all' } = {}) {
  const crons = await openclawCrons();
  let jobs = (crons.jobs || []).map(j => {
    const payloadMessage = typeof j?.payload?.message === 'string' ? j.payload.message : '';
    const hint = `${j?.name || ''} ${payloadMessage} ${JSON.stringify(j?.delivery || {})}`.toLowerCase();
    const isTelegram = /(\btelegram\b|\btg\b|channel=telegram|message\s+tool|target=1084693264|userbot|чат|канал)/i.test(hint);
    return {
      id: j.id,
      name: j.name || '(unnamed)',
      agentId: j.agentId,
      enabled: !!j.enabled,
      schedule: j.schedule,
      nextRunAt: msToIso(j?.state?.nextRunAtMs),
      lastRunAt: msToIso(j?.state?.lastRunAtMs),
      lastStatus: j?.state?.lastStatus || 'n/a',
      consecutiveErrors: j?.state?.consecutiveErrors ?? 0,
      sessionTarget: j?.sessionTarget || null,
      payloadKind: j?.payload?.kind || null,
      isTelegram,
    };
  });
  if (agentId !== 'all') jobs = jobs.filter(j => j.agentId === agentId);
  return jobs;
}

async function collectAlerts() {
  const [summary, jobs, sessions, status, activeTasks] = await Promise.all([collectSummary(), collectCrons({}), collectSessions({}), openclawStatus(), collectActiveTasks()]);
  const alerts = [];

  const findings = Array.isArray(status?.securityAudit?.findings) ? status.securityAudit.findings : [];
  const secIssues = findings.filter(f => ['warn', 'critical'].includes(String(f?.severity || '').toLowerCase()));

  if (secIssues.length > 0) {
    const [first] = secIssues;
    const details = [first?.detail, first?.remediation].filter(Boolean).join(' · ');
    alerts.push({
      kind: 'security',
      severity: first?.severity === 'critical' ? 'critical' : 'warning',
      title: `Security: ${first?.title || 'Warning'}`,
      details: details || `${secIssues.length} issue(s) in security audit`,
      checkId: first?.checkId || null,
      remediation: first?.remediation || null,
    });
    if (secIssues.length > 1) {
      alerts.push({
        kind: 'security-summary',
        severity: 'warning',
        title: 'Security warnings detected',
        details: `${secIssues.length} warning(s) in security audit`,
      });
    }
  } else {
    if (summary.openclaw.securityCritical > 0) alerts.push({ kind: 'security-summary', severity: 'critical', title: 'Critical security findings', details: `${summary.openclaw.securityCritical} critical issue(s) in security audit` });
    if (summary.openclaw.securityWarn > 0) alerts.push({ kind: 'security-summary', severity: 'warning', title: 'Security warnings detected', details: `${summary.openclaw.securityWarn} warning(s) in security audit` });
  }

  if (summary?.openclaw?.cronDegraded) {
    alerts.push({
      kind: 'cron-api',
      severity: 'warning',
      title: 'Cron API temporarily unavailable',
      details: summary?.openclaw?.cronError || 'cron list failed',
    });
  }

  for (const j of jobs.filter(j => j.consecutiveErrors > 0 || j.lastStatus === 'error').slice(0, 8)) {
    alerts.push({
      kind: 'cron',
      severity: 'warning',
      title: `Cron issue: ${j.name}`,
      details: `agent=${j.agentId}, errors=${j.consecutiveErrors}, status=${j.lastStatus}`,
      cronId: j.id,
      agentId: j.agentId,
      cronName: j.name,
    });
  }

  for (const s of sessions.filter(s => Number.isFinite(s.percentUsed) && s.percentUsed >= 80).slice(0, 8)) {
    alerts.push({ kind: 'context', severity: 'info', title: 'High context usage', details: `${s.agentId} at ${s.percentUsed}% (${s.model})`, sessionKey: s.key });
  }

  for (const s of sessions.filter(s => s.abortedLastRun && s.ageMs < 12 * 60 * 60 * 1000).slice(0, 8)) {
    alerts.push({ kind: 'session', severity: 'warning', title: 'Recent aborted run', details: `${s.agentId}: ${s.key}`, sessionKey: s.key });
  }

  const now = Date.now();
  for (const t of (activeTasks?.items || []).filter(x => x.status === 'running')) {
    const elapsed = Math.max(0, now - Number(t.createdAtMs || t.updatedAtMs || now));
    const threshold = t.taskType === 'ai-fix' ? 4 * 60 * 1000 : t.taskType === 'subagent-live' ? 8 * 60 * 1000 : 2 * 60 * 1000;
    if (elapsed < threshold) continue;
    alerts.push({
      kind: 'task-sla',
      severity: 'warning',
      title: `Long running task: ${t.title || t.id}`,
      details: `type=${t.taskType || 'task'}, duration=${humanDuration(elapsed)}, step=${t.step || 'unknown'}`,
      taskId: t.id,
    });
  }

  const impactBySeverity = {
    critical: 'High user/business impact',
    warning: 'Medium operational impact',
    info: 'Low immediate impact',
    ok: 'No immediate impact',
  };

  const dedup = new Map();
  for (const a of alerts) {
    const stable = a.taskId || a.cronId || a.sessionKey || a.checkId || a.jobId || a.title || randomUUID();
    const key = `${a.kind || 'alert'}:${stable}`;
    if (!dedup.has(key)) {
      dedup.set(key, { ...a, key });
      continue;
    }
    const prev = dedup.get(key);
    prev._count = (prev._count || 1) + 1;
    dedup.set(key, prev);
  }

  let finalAlerts = [...dedup.values()].map(a => ({
    ...a,
    impact: a.impact || impactBySeverity[a.severity] || impactBySeverity.info,
    nextStep: a.nextStep || (a.kind === 'cron' ? 'Open run history and run once manually' : a.kind === 'security' ? 'Apply remediation and re-run security audit' : a.kind === 'task-sla' ? 'Check active task timeline and decide: wait, steer or stop' : 'Review details and take next action'),
    triage: getTriage('alert', a.key),
  }));

  const rank = { critical: 4, warning: 3, info: 2, ok: 1 };
  finalAlerts = finalAlerts.sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0));

  if (finalAlerts.length === 0) {
    finalAlerts.push({ kind: 'ok', severity: 'ok', title: 'System healthy', details: 'No critical signals right now', key: 'ok:system-health', impact: 'No immediate impact', nextStep: 'Continue monitoring', triage: getTriage('alert', 'ok:system-health') });
  }

  return { alerts: finalAlerts.slice(0, 24) };
}

async function collectIntelligence() {
  const [jobs, summary] = await Promise.all([collectCrons({}), collectSummary()]);
  const recommendations = [];
  const predictions = [];

  for (const j of jobs) {
    if (j.consecutiveErrors >= 2) {
      recommendations.push({
        kind: 'cron',
        jobId: j.id,
        agentId: j.agentId,
        priority: 'high',
        title: `Fix unstable cron: ${j.name}`,
        action: `Review logs and run manually; if still failing, disable temporarily (id=${j.id}).`,
      });
      predictions.push({
        kind: 'cron',
        jobId: j.id,
        level: 'risk',
        title: `Likely to fail again soon: ${j.name}`,
        confidence: 0.78,
      });
    } else if (j.lastStatus === 'error') {
      recommendations.push({
        kind: 'cron',
        jobId: j.id,
        agentId: j.agentId,
        priority: 'medium',
        title: `Investigate recent error: ${j.name}`,
        action: 'Open run history, inspect summary, then run once manually.',
      });
    }
  }

  const status = await openclawStatus();
  const findings = Array.isArray(status?.securityAudit?.findings) ? status.securityAudit.findings : [];
  const firstWarn = findings.find(f => String(f?.severity || '').toLowerCase() === 'warn');
  if (summary.openclaw.securityWarn > 0) {
    recommendations.push({
      kind: 'security',
      checkId: firstWarn?.checkId || null,
      priority: 'high',
      title: 'Close security warning debt',
      action: 'Address security audit warnings to reduce exploit surface.',
    });
  }

  if (summary?.openclaw?.cronDegraded) {
    recommendations.push({
      kind: 'cron-api',
      priority: 'high',
      title: 'Cron API temporarily unavailable',
      action: 'Check gateway responsiveness and retry cron list. Dashboard is in degraded mode for cron-dependent widgets.',
    });
    predictions.push({
      kind: 'cron-api',
      level: 'risk',
      title: 'Cron-based checks may be incomplete',
      confidence: 0.88,
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({ priority: 'low', title: 'No urgent maintenance tasks', action: 'Keep monitoring and review weekly trends.' });
  }
  if (predictions.length === 0) {
    predictions.push({ level: 'ok', title: 'No near-term failure hotspots detected', confidence: 0.66 });
  }

  const recs = recommendations.slice(0, 12).map(r => {
    const key = `${r.kind || 'recommendation'}:${r.jobId || r.checkId || r.title}`;
    return {
      ...r,
      key,
      impact: r.priority === 'high' ? 'High operational impact' : r.priority === 'medium' ? 'Medium operational impact' : 'Low immediate impact',
      nextStep: r.action || 'Review and decide action',
      triage: getTriage('intel', key),
    };
  });

  const preds = predictions.slice(0, 12).map(p => {
    const key = `${p.kind || 'prediction'}:${p.jobId || p.checkId || p.title}`;
    return {
      ...p,
      key,
      impact: p.level === 'risk' ? 'Potential reliability risk' : 'No immediate risk',
      nextStep: p.level === 'risk' ? 'Watch this area and prepare mitigation' : 'Keep monitoring',
      triage: getTriage('intel', key),
    };
  });

  return { recommendations: recs, predictions: preds };
}

function safeJoin(base, rel) {
  const full = path.resolve(base, rel);
  const root = path.resolve(base);
  if (!(full === root || full.startsWith(root + path.sep))) throw new Error('Path traversal blocked');
  return full;
}

function sanitizeRelPath(relPath) {
  if (!relPath || typeof relPath !== 'string') throw new Error('path is required');
  if (!/^([\w.-]+\/)*[\w.-]+$/.test(relPath)) throw new Error('invalid path');
  return relPath;
}

function snapshotKey(relPath) {
  return relPath.replace(/[\/]/g, '__');
}

async function loadTags() {
  const raw = await fs.readFile(tagsFile, 'utf8');
  try { return JSON.parse(raw); } catch { return {}; }
}

async function saveTags(tags) {
  await fs.writeFile(tagsFile, JSON.stringify(tags, null, 2), 'utf8');
}

function fileTagKey(agentId, relPath) {
  return `${agentId}:${relPath}`;
}

async function listSnapshots(agentId, relPath) {
  const dir = path.join(historyDir, validateAgentId(agentId), snapshotKey(relPath));
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile() && e.name.endsWith('.txt')).map(e => e.name).sort((a, b) => (a < b ? 1 : -1));
    return files.map(n => ({ id: n, ts: Number(n.replace('.txt', '')) || null }));
  } catch {
    return [];
  }
}

async function saveSnapshot(agentId, relPath, content) {
  const dir = path.join(historyDir, validateAgentId(agentId), snapshotKey(relPath));
  await fs.mkdir(dir, { recursive: true });

  const existing = await listSnapshots(agentId, relPath);
  if (existing[0]) {
    const latest = await fs.readFile(path.join(dir, existing[0].id), 'utf8').catch(() => null);
    if (latest === content) return;
  }

  const file = path.join(dir, `${Date.now()}.txt`);
  await fs.writeFile(file, content, 'utf8');

  const after = await listSnapshots(agentId, relPath);
  for (const extra of after.slice(12)) {
    await fs.rm(path.join(dir, extra.id), { force: true });
  }
}

function makeDiff(a, b, maxLines = 200) {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = Math.max(A.length, B.length);
  const out = [];
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const av = A[i] ?? '';
    const bv = B[i] ?? '';
    if (av !== bv) {
      changed += 1;
      if (out.length < maxLines) {
        out.push({ line: i + 1, from: av, to: bv });
      }
    }
  }
  return { changedLines: changed, preview: out };
}

async function resolveWorkspace(agentId) {
  const map = await getAgentMap();
  const id = validateAgentId(agentId);
  const ws = map[id];
  if (!ws) throw new Error(`unknown agentId: ${id}`);
  return { id, ws };
}

async function collectFiles({ agentId = 'all', q = '' } = {}) {
  const map = await getAgentMap();
  const tags = await loadTags();
  const query = (q || '').toLowerCase();
  const agents = agentId === 'all' ? Object.keys(map) : [validateAgentId(agentId)];
  const files = [];

  for (const id of agents) {
    const ws = map[id];
    if (!ws) continue;

    for (const name of ALLOWED_CORE) {
      const p = path.join(ws, name);
      try {
        const st = await fs.stat(p);
        if (st.isFile()) {
          const rel = name;
          const key = fileTagKey(id, rel);
          files.push({ agentId: id, path: rel, name, category: 'core', size: st.size, modified: st.mtime.toISOString(), tags: tags[key] || [] });
        }
      } catch {}
    }

    const memDir = path.join(ws, 'memory');
    try {
      const entries = await fs.readdir(memDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.md')) continue;
        const rel = `memory/${e.name}`;
        const p = path.join(ws, rel);
        const st = await fs.stat(p);
        const key = fileTagKey(id, rel);
        files.push({ agentId: id, path: rel, name: e.name, category: 'memory', size: st.size, modified: st.mtime.toISOString(), tags: tags[key] || [] });
      }
    } catch {}
  }

  let out = files.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  if (query) {
    out = out.filter(f => `${f.agentId} ${f.path} ${(f.tags || []).join(' ')}`.toLowerCase().includes(query));
  }
  return out.slice(0, 240);
}

async function readFileContent(agentId, relPath) {
  const { id, ws } = await resolveWorkspace(agentId);
  const rel = sanitizeRelPath(relPath);
  const ext = path.extname(rel).toLowerCase();
  if (!['.md', '.txt', '.json', '.yaml', '.yml'].includes(ext)) throw new Error('file type not allowed');
  if (!(ALLOWED_CORE.has(rel) || rel.startsWith('memory/'))) throw new Error('access denied');

  const full = safeJoin(ws, rel);
  const content = await fs.readFile(full, 'utf8');
  const trimmed = content.length > 220_000 ? `${content.slice(0, 220_000)}\n\n[truncated]` : content;
  await saveSnapshot(id, rel, trimmed);
  const tags = await loadTags();
  return { content: trimmed, tags: tags[fileTagKey(id, rel)] || [] };
}

async function setFileTags(agentId, relPath, tagsIn) {
  const id = validateAgentId(agentId);
  const rel = sanitizeRelPath(relPath);
  const tags = await loadTags();
  const arr = (Array.isArray(tagsIn) ? tagsIn : []).map(t => String(t).trim()).filter(Boolean).slice(0, 12);
  tags[fileTagKey(id, rel)] = [...new Set(arr)];
  await saveTags(tags);
  return tags[fileTagKey(id, rel)];
}

async function getFileHistory(agentId, relPath) {
  const id = validateAgentId(agentId);
  const rel = sanitizeRelPath(relPath);
  const snaps = await listSnapshots(id, rel);
  return snaps.map(s => ({ id: s.id, ts: s.ts, at: s.ts ? new Date(s.ts).toISOString() : null }));
}

async function getFileDiff(agentId, relPath, fromId = null, toId = null) {
  const id = validateAgentId(agentId);
  const rel = sanitizeRelPath(relPath);
  const snaps = await listSnapshots(id, rel);
  if (snaps.length < 2) return { changedLines: 0, preview: [], message: 'Not enough history yet' };

  const from = fromId || snaps[1].id;
  const to = toId || snaps[0].id;
  const dir = path.join(historyDir, id, snapshotKey(rel));
  const a = await fs.readFile(path.join(dir, from), 'utf8');
  const b = await fs.readFile(path.join(dir, to), 'utf8');
  const diff = makeDiff(a, b);
  return { ...diff, from, to };
}

async function collectSkills({ agentId = 'all', q = '' } = {}) {
  const map = await getAgentMap();
  const query = (q || '').toLowerCase();
  const agents = agentId === 'all' ? Object.keys(map) : [validateAgentId(agentId)];
  const skills = [];

  for (const id of agents) {
    const ws = map[id];
    if (!ws) continue;
    const dir = path.join(ws, 'skills');
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const sk = e.name;
        const skillMd = path.join(dir, sk, 'SKILL.md');
        try {
          const st = await fs.stat(skillMd);
          if (!st.isFile()) continue;
          // Extract description from SKILL.md front-matter
          let description = null;
          try {
            const mdText = await fs.readFile(skillMd, 'utf8');
            const match = mdText.match(/^description:\s*(.+)$/m);
            if (match) description = match[1].trim();
            else {
              // fallback: first non-empty line after the first heading
              const lines = mdText.split('\n').map(l => l.trim()).filter(Boolean);
              const headIdx = lines.findIndex(l => l.startsWith('#'));
              if (headIdx >= 0 && lines[headIdx + 1]) description = lines[headIdx + 1];
            }
          } catch {}
          skills.push({
            agentId: id,
            name: sk,
            slug: sk,
            source: 'custom',
            workspace: ws,
            path: `skills/${sk}`,
            modified: st.mtime.toISOString(),
            deletable: true,
            description,
          });
        } catch {}
      }
    } catch {}
  }

  const idx = await openclawSkillsIndex();
  for (const s of idx.skills || []) {
    if (s.source === 'openclaw-bundled') continue;
    skills.push({
      agentId: 'system',
      name: s.name,
      slug: s.name,
      source: s.source,
      path: null,
      modified: null,
      deletable: false,
      description: s.description || null,
      eligible: !!s.eligible,
    });
  }

  let out = skills;
  if (query) out = out.filter(s => `${s.agentId} ${s.name} ${s.description || ''}`.toLowerCase().includes(query));
  out = out.sort((a, b) => `${a.agentId}:${a.name}`.localeCompare(`${b.agentId}:${b.name}`));
  return out;
}

async function removeSkill(agentId, slug) {
  const id = validateAgentId(agentId);
  const s = validateSkillSlug(slug);
  const { ws } = await resolveWorkspace(id);
  const target = safeJoin(path.join(ws, 'skills'), s);
  await fs.rm(target, { recursive: true, force: false });
  invalidate(); // clear all caches to immediately reflect skill changes
  return { removed: `${id}:${s}` };
}

async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid json body');
  }
}

async function runCronAction(action, cronId) {
  const id = validateCronId(cronId);
  const cmd = `${OPENCLAW_BIN} cron ${action} ${id} --json 2>/dev/null`;
  const out = await runCmd(cmd, 65_000);
  invalidate(['crons', 'status']);
  return out;
}

async function cronRuns(cronId, limit = 20) {
  const id = validateCronId(cronId);
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  const out = await runCmd(`${OPENCLAW_BIN} cron runs --id ${id} --limit ${lim} 2>/dev/null`, 65_000);
  return extractJson(out);
}

function parseAgentFromSessionKey(key) {
  const parts = String(key || '').split(':');
  const i = parts.indexOf('agent');
  if (i >= 0 && parts[i + 1]) return parts[i + 1];
  if (parts[0] === 'agent' && parts[1]) return parts[1];
  return null;
}

async function controlSubagent({ action, key, sessionId, message }) {
  const act = String(action || '').toLowerCase();
  const sessKey = validateSessionKey(key);
  const agentId = parseAgentFromSessionKey(sessKey) || 'main';

  if (act === 'kill') {
    const params = JSON.stringify({ key: sessKey });
    const out = await runCmd(`${OPENCLAW_BIN} gateway call sessions.delete --params ${shQuote(params)} --json 2>/dev/null`, 25_000);
    const parsed = extractJson(out);
    return { ok: !!parsed?.ok, action: 'kill', key: sessKey, deleted: !!parsed?.deleted };
  }

  const sid = String(sessionId || '').trim();
  if (!sid) throw new Error('sessionId is required for steer/retry');

  const text = act === 'retry'
    ? 'Retry the last failed subtask, summarize what changed, and report status in 3 bullets.'
    : String(message || '').trim();
  if (!text) throw new Error('message is required for steer');

  const cmd = `${OPENCLAW_BIN} agent --agent ${agentId} --session-id ${sid} --message ${shQuote(text)} --json --timeout 240 2>/dev/null`;
  const out = await runCmd(cmd, 260_000);
  return { ok: true, action: act, key: sessKey, sessionId: sid, outputTail: String(out || '').slice(-1200) };
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const full = path.join(publicDir, rel);
  try {
    const st = await fs.stat(full);
    if (!st.isFile()) throw new Error('not file');
    const body = await fs.readFile(full);
    res.writeHead(200, { 'Content-Type': mimeFor(full), 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    const fallback = await fs.readFile(path.join(publicDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fallback);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const me = await getUserContext(req);

    if (pathname === '/health') return json(res, 200, { ok: true, ts: new Date().toISOString() });
    if (pathname === '/api/me') return json(res, 200, me);

    if (pathname === '/api/summary') {
      const summary = await cached('summary-api', () => collectSummary(), 30_000);
      return json(res, 200, summary);
    }
    if (pathname === '/api/usage') {
      const usage = await cached('usage-api', () => collectUsage(), 30_000);
      return json(res, 200, usage);
    }
    if (pathname === '/api/alerts') return json(res, 200, await collectAlerts());
    if (pathname === '/api/intel') return json(res, 200, await collectIntelligence());
    if (pathname === '/api/tasks/active') return json(res, 200, await collectActiveTasks());
    if (pathname === '/api/operator/now') return json(res, 200, await collectOperatorNow());
    if (pathname === '/api/operator/note' && req.method === 'POST') {
      enforceMutationRate(me);
      assertRole(me, ['operator', 'admin']);
      const body = await readJsonBody(req);
      const ev = await logOperatorEvent({
        kind: 'operator-note',
        title: body?.title || 'Operator note',
        details: body?.details || '',
        level: body?.level || 'info',
        actor: me.user || 'unknown',
        meta: body?.meta || {},
      });
      await auditLog(me, 'operator.note', { title: body?.title || null }, true);
      return json(res, 200, { ok: true, event: ev });
    }
    if (pathname === '/api/timeline') return json(res, 200, await collectTimeline());
    if (pathname === '/api/review/weekly') return json(res, 200, collectWeeklyReview());
    if (pathname === '/api/triage') {
      if (req.method === 'GET') {
        const kind = (url.searchParams.get('kind') || '').trim();
        return json(res, 200, { items: listTriage(kind || null) });
      }
      if (req.method === 'POST') {
        enforceMutationRate(me);
        assertRole(me, ['operator', 'admin']);
        const body = await readJsonBody(req);
        if (!body?.key) return json(res, 400, { error: 'key is required' });
        const tri = await setTriage(body.kind || 'alert', body.key, body, me.user || 'unknown');
        await auditLog(me, 'triage.set', { kind: body.kind || 'alert', key: body.key, status: body.status || null }, true);
        return json(res, 200, { ok: true, triage: tri });
      }
      return json(res, 405, { error: 'method not allowed' });
    }

    if (pathname === '/api/tasks/replay') {
      const id = (url.searchParams.get('id') || '').trim();
      if (!id) return json(res, 400, { error: 'id is required' });

      const direct = aiFixOps.get(id);
      if (direct) {
        return json(res, 200, {
          id,
          title: direct.title,
          status: direct.status,
          step: direct.step || null,
          events: direct.events || [],
        });
      }

      const active = await collectActiveTasks();
      const task = (active.items || []).find(t => t.id === id);
      if (!task) return json(res, 404, { error: 'task not found' });
      return json(res, 200, {
        id: task.id,
        title: task.title,
        status: task.status,
        step: task.step || null,
        events: task.events || [],
      });
    }

    if (pathname === '/api/update/check') {
      const info = await cached('update-check', () => collectUpdateInfo(), 30_000);
      return json(res, 200, info);
    }

    if (pathname === '/api/update/run' && req.method === 'POST') {
      enforceMutationRate(me);
      assertRole(me, ['admin']);
      const info = await collectUpdateInfo();
      if (!info.available) return json(res, 200, { ok: true, started: false, message: 'already up to date', ...info });

      const run = await runOpenclawUpdateNow();
      const status = String(run?.result?.status || '').toLowerCase();
      const reason = run?.result?.reason || null;
      const doctorHint = run?.sentinel?.payload?.doctorHint || null;
      const beforeVersion = run?.result?.before?.version || info.current || null;
      const afterVersion = run?.result?.after?.version || null;
      const started = status === 'started' || status === 'running' || status === 'updated';
      const skipped = status === 'skipped';

      invalidate(['status', 'summary-api', 'update-check', 'cli-version']);

      await logOperatorEvent({
        kind: 'update',
        title: skipped ? 'OpenClaw update skipped' : 'OpenClaw update run',
        details: `${beforeVersion || info.current || 'unknown'} → ${info.latest || 'unknown'}${reason ? ` (${reason})` : ''}`,
        actor: me.user || 'unknown',
        level: skipped ? 'info' : 'warn',
        meta: { status, reason, doctorHint, afterVersion },
      });
      await auditLog(me, 'update.run', { current: beforeVersion, latest: info.latest, status, reason }, true);

      return json(res, 200, {
        ok: true,
        started,
        skipped,
        status: status || null,
        reason,
        doctorHint,
        current: beforeVersion,
        latest: info.latest,
        available: !!info.latest && beforeVersion !== info.latest,
        run: {
          restart: run?.restart || null,
          result: run?.result || null,
        },
      });
    }

    if (pathname === '/api/ai/fix/start' && req.method === 'POST') {
      enforceMutationRate(me);
      assertRole(me, ['operator', 'admin']);
      const body = await readJsonBody(req);
      const op = startAiFixOperation(body, me.user || 'unknown');
      await auditLog(me, 'ai.fix.start', { source: body?.source || null, title: body?.item?.title || body?.title || null }, true);
      return json(res, 200, { ok: true, op });
    }

    if (pathname === '/api/ai/fix/status') {
      settleAiFixTimeouts();
      const id = (url.searchParams.get('id') || '').trim();
      if (!id) return json(res, 400, { error: 'id is required' });
      const op = aiFixOps.get(id);
      if (!op) return json(res, 404, { error: 'operation not found' });
      return json(res, 200, { ok: true, op: aiOpPublic(op) });
    }

    if (pathname === '/api/ai/fix/list') {
      settleAiFixTimeouts();
      pruneAiFixOps();
      const list = [...aiFixOps.values()]
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, 30)
        .map(aiOpPublic);
      return json(res, 200, { ok: true, items: list });
    }

    if (pathname === '/api/subagent/control' && req.method === 'POST') {
      enforceMutationRate(me);
      assertRole(me, ['operator', 'admin']);
      const body = await readJsonBody(req);
      const result = await controlSubagent(body || {});
      await logOperatorEvent({ kind: 'subagent-control', title: `Sub-agent ${body?.action || 'control'}`, details: `${body?.key || ''}`, actor: me.user || 'unknown', level: 'info', meta: result });
      await auditLog(me, 'subagent.control', { action: body?.action, key: body?.key }, true);
      return json(res, 200, { ok: true, ...result });
    }

    if (pathname === '/api/audit') {
      assertRole(me, ['admin']);
      const raw = await fs.readFile(auditFile, 'utf8').catch(() => '');
      const lines = raw.trim().split('\n').filter(Boolean).slice(-200).map(x => {
        try { return JSON.parse(x); } catch { return null; }
      }).filter(Boolean).reverse();
      return json(res, 200, { entries: lines });
    }


    if (pathname === '/api/sessions') {
      const agentId = url.searchParams.get('agentId') || 'all';
      const q = url.searchParams.get('q') || '';
      return json(res, 200, { sessions: await collectSessions({ agentId, q }) });
    }

    if (pathname.startsWith('/api/session/model')) {
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      enforceMutationRate(me);
      assertRole(me, ['operator', 'admin']);
      const body = await readJsonBody(req);
      const result = await setSessionModelOverride(body.key, body.model);
      await auditLog(me, 'session.model', { key: body.key, model: body.model }, true);
      return json(res, 200, { ok: true, ...result });
    }

    if (pathname === '/api/crons') {
      const agentId = url.searchParams.get('agentId') || 'all';
      return json(res, 200, { jobs: await collectCrons({ agentId }) });
    }

    if (pathname === '/api/cron/runs') {
      const id = url.searchParams.get('id') || '';
      const limit = url.searchParams.get('limit') || '20';
      return json(res, 200, await cronRuns(id, Number(limit)));
    }

    if (pathname === '/api/cron/run' && req.method === 'POST') {
      enforceMutationRate(me);
      assertRole(me, ['operator', 'admin']);
      const body = await readJsonBody(req);
      const output = await runCronAction('run', body.id);
      await logOperatorEvent({ kind: 'cron', title: `Cron run`, details: body.id, actor: me.user || 'unknown', level: 'info' });
      await auditLog(me, 'cron.run', { id: body.id }, true);
      return json(res, 200, { ok: true, action: 'run', id: body.id, output });
    }

    if (pathname === '/api/cron/toggle' && req.method === 'POST') {
      enforceMutationRate(me);
      assertRole(me, ['operator', 'admin']);
      const body = await readJsonBody(req);
      const output = await runCronAction(body.enabled ? 'enable' : 'disable', body.id);
      await logOperatorEvent({ kind: 'cron', title: `Cron ${body.enabled ? 'enabled' : 'disabled'}`, details: body.id, actor: me.user || 'unknown', level: 'info' });
      await auditLog(me, 'cron.toggle', { id: body.id, enabled: body.enabled }, true);
      return json(res, 200, { ok: true, action: body.enabled ? 'enable' : 'disable', id: body.id, output });
    }

    if (pathname === '/api/cron/delete' && req.method === 'POST') {
      enforceMutationRate(me);
      assertRole(me, ['admin']);
      const body = await readJsonBody(req);
      const output = await runCronAction('rm', body.id);
      await logOperatorEvent({ kind: 'cron', title: 'Cron deleted', details: body.id, actor: me.user || 'unknown', level: 'warn' });
      await auditLog(me, 'cron.delete', { id: body.id }, true);
      return json(res, 200, { ok: true, action: 'delete', id: body.id, output });
    }

    // ── Cron edit (update) ──────────────────────────────────────────────────────
    if (pathname === '/api/cron/update' && req.method === 'POST') {
      enforceMutationRate(me);
      assertRole(me, ['operator', 'admin']);
      const body = await readJsonBody(req);
      const id = validateCronId(body.id);
      const patch = {};
      if (body.schedule !== undefined) patch.schedule = body.schedule;
      if (body.payloadMessage !== undefined) patch.payloadMessage = String(body.payloadMessage || '');
      if (body.timeout !== undefined) patch.timeout = Number(body.timeout) || 0;
      if (body.sessionTarget !== undefined) patch.sessionTarget = body.sessionTarget;
      if (body.deliveryMode !== undefined) patch.deliveryMode = body.deliveryMode;
      const params = JSON.stringify({ id, patch });
      const out = await runCmd(`${OPENCLAW_BIN} gateway call cron.update --params ${shQuote(params)} --json 2>/dev/null`, 30_000);
      const parsed = extractJson(out);
      invalidate(['crons', 'status']);
      await logOperatorEvent({ kind: 'cron', title: 'Cron updated', details: id, actor: me.user || 'unknown', level: 'info' });
      await auditLog(me, 'cron.update', { id, patch }, true);
      return json(res, 200, { ok: true, id, result: parsed });
    }

    // ── Session transcript history ──────────────────────────────────────────────
    if (pathname.startsWith('/api/session/history')) {
      const key = url.searchParams.get('key') || '';
      if (!key) return json(res, 400, { error: 'key is required' });
      const sessionKey = validateSessionKey(key);
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 40)));
      let messages = [];
      let errorNote = null;
      try {
        const params = JSON.stringify({ sessionKey, limit });
        const out = await runCmd(`${OPENCLAW_BIN} gateway call chat.history --params ${shQuote(params)} --json 2>/dev/null`, 25_000);
        const parsed = extractJson(out);
        messages = Array.isArray(parsed?.messages) ? parsed.messages : (Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        errorNote = e.message?.slice(0, 200) || 'history unavailable';
      }
      return json(res, 200, { ok: true, sessionKey, messages, errorNote });
    }

    // ── Cron token tracker (7d) ───────────────────────────────────────────────
    if (pathname.startsWith('/api/cron/cost')) {
      const cronId = url.searchParams.get('id') || '';
      if (!cronId) return json(res, 400, { error: 'id is required' });
      validateCronId(cronId);

      let runs7d = 0;
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        const runsData = await cronRuns(cronId, 100);
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const recent = (runsData?.runs || runsData?.entries || []).filter(r => {
          const ts = r?.startedAt
            ? new Date(r.startedAt).getTime()
            : r?.createdAt
              ? new Date(r.createdAt).getTime()
              : (r?.ts || 0);
          return ts > sevenDaysAgo;
        });

        runs7d = recent.length;
        for (const r of recent) {
          const usage = extractRunTokens(r);
          inputTokens += usage.inputTokens;
          outputTokens += usage.outputTokens;
        }
      } catch {}

      const totalTokens = inputTokens + outputTokens;
      return json(res, 200, {
        ok: true,
        cronId,
        runs7d,
        inputTokens,
        outputTokens,
        totalTokens,
      });
    }

    // ── Activity heatmap ────────────────────────────────────────────────────────
    if (pathname === '/api/activity/heatmap') {
      const status = await openclawStatus();
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      // matrix[dayOfWeek 0=Mon..6=Sun][hour 0-23]
      const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
      const sessions = status?.sessions?.recent || [];
      for (const s of sessions) {
        const updMs = s?.updatedAt ? new Date(s.updatedAt).getTime() : 0;
        if (updMs < sevenDaysAgo || !updMs) continue;
        const d = new Date(updMs);
        let dow = d.getDay(); // 0=Sun
        dow = dow === 0 ? 6 : dow - 1; // convert to Mon=0..Sun=6
        const hr = d.getHours();
        if (dow >= 0 && dow < 7 && hr >= 0 && hr < 24) matrix[dow][hr]++;
      }
      // Also add cron run data from recent sessions
      const cronSessions = sessions.filter(s => String(s?.kind || s?.key || '').includes('cron'));
      for (const s of cronSessions) {
        const creMs = s?.createdAt ? new Date(s.createdAt).getTime() : 0;
        if (creMs < sevenDaysAgo || !creMs) continue;
        const d = new Date(creMs);
        let dow = d.getDay();
        dow = dow === 0 ? 6 : dow - 1;
        const hr = d.getHours();
        if (dow >= 0 && dow < 7 && hr >= 0 && hr < 24) matrix[dow][hr]++;
      }
      return json(res, 200, { ok: true, matrix, updatedAt: new Date().toISOString() });
    }

    // ── AI Chat endpoint ────────────────────────────────────────────────────────
    if (pathname === '/api/chat' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const userMessage = String(body.message || '').trim().slice(0, 4000);
      const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
      const lang = String(body.lang || 'ru').toLowerCase() === 'en' ? 'en' : 'ru';

      let chatAttachments = [];
      try {
        chatAttachments = await storeChatAttachments(body.attachments || []);
      } catch (e) {
        return json(res, 400, { error: e?.message || 'Invalid attachments' });
      }

      if (!userMessage && chatAttachments.length === 0) {
        return json(res, 400, { error: lang === 'en' ? 'message or image is required' : 'нужно сообщение или изображение' });
      }

      let summary;
      try { summary = await cached('summary-api', () => collectSummary(), 30_000); } catch { summary = {}; }

      const langNote = lang === 'en' ? 'Respond in English.' : 'Отвечай на русском языке.';
      const toolPolicy = chatAttachments.length
        ? (lang === 'en'
          ? 'You may use only image-analysis tools to inspect attached images when needed. Do not execute external actions.'
          : 'Можно использовать только инструменты анализа изображений для прикреплённых картинок. Внешние действия выполнять нельзя.')
        : 'Do not call tools or perform external actions. Return plain text only.';

      const systemPrompt = `You are an AI assistant for the Tima Ops Dashboard — a monitoring panel for OpenClaw AI agents. ${langNote}

Current state (${new Date().toISOString()}):
- Sessions: ${summary?.openclaw?.totalSessions ?? '?'} total, ${summary?.openclaw?.activeSessions ?? '?'} active
- Crons: ${summary?.openclaw?.totalCrons ?? '?'} total, ${summary?.openclaw?.enabledCrons ?? '?'} enabled
- Security warnings: ${summary?.openclaw?.securityWarn ?? 0}, critical: ${summary?.openclaw?.securityCritical ?? 0}
- Cron API degraded: ${summary?.openclaw?.cronDegraded ? 'yes' : 'no'}
- Dashboard uptime: ${summary?.app?.uptime ?? '?'}
- OpenClaw version: ${summary?.app?.version ?? '?'}

Answer questions about agents, sessions, crons, alerts, and costs. Be concise.
${toolPolicy}`;

      const historyText = history.slice(-4).map(m => {
        const role = m.role === 'user' ? (lang === 'en' ? 'User' : 'Пользователь') : (lang === 'en' ? 'Assistant' : 'Ассистент');
        const raw = m?.content;
        let content = '';
        if (typeof raw === 'string') content = raw;
        else if (Array.isArray(raw)) content = raw.map(x => typeof x === 'string' ? x : (x?.text || x?.thinking || x?.type || '')).join(' ');
        else if (raw != null) content = JSON.stringify(raw);
        return `${role}: ${String(content || '').slice(0, 700)}`;
      }).join('\n');

      const attachmentHint = chatAttachments.length
        ? (lang === 'en'
          ? `Attached images (${chatAttachments.length}):
${chatAttachments.map((a, i) => `- image ${i + 1}: ${a.path}`).join('\n')}
Use these files only if the user asks about image content.`
          : `Прикреплённые изображения (${chatAttachments.length}):
${chatAttachments.map((a, i) => `- изображение ${i + 1}: ${a.path}`).join('\n')}
Используй эти файлы, если вопрос связан с содержимым картинки.`)
        : '';

      const userLine = userMessage || (lang === 'en' ? 'Please analyze attached images.' : 'Проанализируй прикреплённые изображения.');
      const fullPrompt = `${systemPrompt}\n\n${historyText ? historyText + '\n' : ''}${attachmentHint ? attachmentHint + '\n\n' : ''}${lang === 'en' ? 'User' : 'Пользователь'}: ${userLine}\n\n${lang === 'en' ? 'Assistant (answer concisely in 2-4 sentences):' : 'Ассистент (ответь кратко, 2-4 предложения):'}`;

      const cmd = `${OPENCLAW_BIN} agent --agent tima --message ${shQuote(fullPrompt)} --json --timeout 60000 2>/dev/null`;
      let reply = '';
      try {
        const agentOut = await runCmd(cmd, 70_000);
        reply = extractAgentReplyText(agentOut).slice(0, 2000);
      } catch (e) {
        const fallback = lang === 'en'
          ? `AI model is temporarily unavailable. Quick status: ${summary?.openclaw?.activeSessions ?? '?'} active sessions out of ${summary?.openclaw?.totalSessions ?? '?'}, ${summary?.openclaw?.enabledCrons ?? '?'} enabled crons. Try again in a minute.`
          : `AI-модель временно недоступна. Быстрый статус: активных сессий ${summary?.openclaw?.activeSessions ?? '?'}/${summary?.openclaw?.totalSessions ?? '?'}, включённых cron ${summary?.openclaw?.enabledCrons ?? '?'}. Повтори запрос через минуту.`;
        return json(res, 200, { ok: true, degraded: true, reply: fallback, error: `Agent error: ${e.message?.slice(0, 240)}` });
      }

      if (!reply) {
        const fallback = lang === 'en'
          ? `AI returned an empty response. Quick status: ${summary?.openclaw?.activeSessions ?? '?'} active sessions, ${summary?.openclaw?.enabledCrons ?? '?'} enabled crons.`
          : `AI вернул пустой ответ. Быстрый статус: активных сессий ${summary?.openclaw?.activeSessions ?? '?'}, включённых cron ${summary?.openclaw?.enabledCrons ?? '?'}.`;
        return json(res, 200, { ok: true, degraded: true, reply: fallback });
      }

      return json(res, 200, {
        ok: true,
        reply,
        attachments: chatAttachments.map(a => ({ name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
      });
    }

    if (pathname === '/api/skills') {
      const agentId = url.searchParams.get('agentId') || 'all';
      const q = url.searchParams.get('q') || '';
      const cacheKey = `skills-api:${agentId}:${q.toLowerCase()}`;
      const skills = await cached(cacheKey, () => collectSkills({ agentId, q }), 120_000);
      return json(res, 200, { skills });
    }

    if (pathname === '/api/skill/delete' && req.method === 'POST') {
      enforceMutationRate(me);
      assertRole(me, ['admin']);
      const body = await readJsonBody(req);
      const result = await removeSkill(body.agentId, body.slug || body.name);
      await auditLog(me, 'skill.delete', { agentId: body.agentId, slug: body.slug || body.name }, true);
      return json(res, 200, { ok: true, ...result });
    }

    if (pathname === '/api/files') {
      const agentId = url.searchParams.get('agentId') || 'all';
      const q = url.searchParams.get('q') || '';
      return json(res, 200, { files: await collectFiles({ agentId, q }) });
    }

    if (pathname === '/api/file') {
      const agentId = url.searchParams.get('agentId') || '';
      const relPath = url.searchParams.get('path') || '';
      const result = await readFileContent(agentId, relPath);
      return json(res, 200, { agentId, path: relPath, ...result });
    }

    if (pathname === '/api/file/tags' && req.method === 'POST') {
      enforceMutationRate(me);
      assertRole(me, ['operator', 'admin']);
      const body = await readJsonBody(req);
      const tags = await setFileTags(body.agentId, body.path, body.tags);
      await auditLog(me, 'file.tags', { agentId: body.agentId, path: body.path, tags }, true);
      return json(res, 200, { ok: true, tags });
    }

    if (pathname === '/api/file/history') {
      const agentId = url.searchParams.get('agentId') || '';
      const relPath = url.searchParams.get('path') || '';
      return json(res, 200, { entries: await getFileHistory(agentId, relPath) });
    }

    if (pathname === '/api/file/diff') {
      const agentId = url.searchParams.get('agentId') || '';
      const relPath = url.searchParams.get('path') || '';
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      return json(res, 200, await getFileDiff(agentId, relPath, from, to));
    }

    return serveStatic(res, pathname);
  } catch (err) {
    const code = err.code && Number.isInteger(err.code) ? err.code : (err.message === 'forbidden' ? 403 : 500);
    return json(res, code, { error: err.message || 'internal error' });
  }
});

ensureFiles().then(() => {
  server.listen(port, host, () => {
    console.log(`tima-ops-dashboard listening on http://${host}:${port}`);
    // Pre-warm slow caches in background so first user request is fast
    openclawSkillsIndex().catch(() => {});
    openclawStatus().catch(() => {});
    openclawStatusUsage().catch(() => {});
    cached('summary-api', () => collectSummary(), 30_000).catch(() => {});
    cached('usage-api', () => collectUsage(), 30_000).catch(() => {});
    cached('skills-api:all:', () => collectSkills({ agentId: 'all', q: '' }), 120_000).catch(() => {});
  });
});
