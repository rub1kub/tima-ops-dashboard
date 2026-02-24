/* ══════════════════════════════════════════════════════════════════════
   Tima Ops Dashboard — app.js (RU)
   Правила:
   • UI показывается мгновенно, данные грузятся параллельно
   • Авто-обновление ТИХОЕ — скелетоны не мелькают при фоновом рефреше
   • Скелетоны только при первой загрузке секции
══════════════════════════════════════════════════════════════════════ */

/* ── utils ── */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

const COLORS = {
  main:  {bg:'#ede9fe',text:'#5b21b6'},
  tima:  {bg:'#dbeafe',text:'#1e40af'},
  leva:  {bg:'#d1fae5',text:'#065f46'},
  zhora: {bg:'#fff7ed',text:'#9a3412'},
};
const ac = id => COLORS[id] || {bg:'#f3f4f6',text:'#374151'};

const ctxColor = pct =>
  !Number.isFinite(pct) ? 'var(--muted-2)' : pct>=80 ? 'var(--red)' : pct>=60 ? 'var(--amber)' : 'var(--green)';

function humanDur(ms) {
  const s=Math.floor(ms/1000), d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60);
  if (L==='en') return d>0?`${d}d ${h}h`:h>0?`${h}h ${m}m`:`${m}m`;
  return d>0 ? `${d}д ${h}ч` : h>0 ? `${h}ч ${m}м` : `${m}м`;
}

const skelRow = (n=3,h='40px') => Array(n).fill(0).map(()=>
  `<div class="skeleton" style="height:${h};margin-bottom:8px;border-radius:8px"></div>`).join('');

function debounce(fn, wait=250) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function activateTab(tabName) {
  const btn = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (btn) btn.click();
}

/* ══════════════════════════════════════════════════════════════════════
   ACTIVITY HEATMAP
══════════════════════════════════════════════════════════════════════ */
const DAY_LABELS_RU = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const DAY_LABELS_EN = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

async function loadHeatmap(silent=false) {
  const card = $('#heatmapCard');
  const grid = $('#heatmapGrid');
  if (!card || !grid) return;

  try {
    const d = await api('activity/heatmap', 15000);
    const raw = Array.isArray(d?.matrix) ? d.matrix : [];

    // normalize to 7x24, so UI never crashes on malformed payload
    const matrix = Array.from({ length: 7 }, (_, day) => {
      const row = Array.isArray(raw[day]) ? raw[day] : [];
      return Array.from({ length: 24 }, (_, h) => Number(row[h] || 0));
    });

    const total = matrix.flat().reduce((a, b) => a + b, 0);
    const maxVal = Math.max(1, ...matrix.flat());

    card.style.display = '';

    // Update i18n labels
    const titleEl = $('#heatmapTitle');
    const subEl = $('#heatmapSub');
    if (titleEl) titleEl.textContent = t('heatmapTitle');
    if (subEl) {
      subEl.textContent = total > 0
        ? t('heatmapSub')
        : (L === 'en' ? 'no activity in last 7 days' : 'за 7 дней активности не было');
    }

    const days = L === 'en' ? DAY_LABELS_EN : DAY_LABELS_RU;

    // balanced size: not tiny on desktop, not stretched on mobile
    const dayLabelW = 28;
    const containerW = Math.max(280, grid.clientWidth || card.clientWidth || 640);
    const targetGridW = containerW < 560
      ? Math.max(300, containerW - 8)
      : Math.min(680, Math.max(520, containerW - 24));

    const cellOuter = Math.max(11, Math.floor((targetGridW - dayLabelW) / 24));
    const cell = Math.max(9, cellOuter - 2);
    const hourStep = cell <= 11 ? 8 : cell <= 16 ? 6 : 4;
    const legendCell = Math.max(9, cell - 2);

    const gridWidth = dayLabelW + (24 * cellOuter) + 8;
    let html = `<div style="display:flex;justify-content:center;width:100%"><div style="font-size:11px;width:min(100%,${gridWidth}px)">`;

    // Hour labels
    html += `<div style="display:flex;padding-left:${dayLabelW + 2}px;gap:0;margin-bottom:4px">`;
    for (let h = 0; h < 24; h++) {
      const show = h % hourStep === 0;
      html += `<div style="width:${cellOuter}px;text-align:center;color:var(--muted);font-size:10px">${show ? h : ''}</div>`;
    }
    html += `</div>`;

    // Grid rows
    for (let d2 = 0; d2 < 7; d2++) {
      html += `<div style="display:flex;align-items:center;gap:0;margin-bottom:3px">`;
      html += `<div style="width:${dayLabelW}px;font-size:10px;color:var(--muted);text-align:right;padding-right:4px;flex-shrink:0">${days[d2]}</div>`;
      for (let h = 0; h < 24; h++) {
        const val = matrix[d2][h];
        const pct = val / maxVal;
        let bg;
        if (val === 0) bg = 'var(--border)';
        else if (pct < 0.25) bg = 'rgba(99,102,241,0.28)';
        else if (pct < 0.6) bg = 'rgba(99,102,241,0.62)';
        else bg = 'rgba(99,102,241,1)';
        const dayStr = L === 'en' ? DAY_LABELS_EN[d2] : DAY_LABELS_RU[d2];
        html += `<div style="width:${cell}px;height:${cell}px;background:${bg};border-radius:3px;margin:1px;flex-shrink:0;cursor:default" title="${dayStr} ${h}:00 — ${val}"></div>`;
      }
      html += `</div>`;
    }

    // Legend
    html += `<div style="display:flex;align-items:center;gap:5px;margin-top:8px;padding-left:${dayLabelW + 2}px">
      <span style="font-size:10px;color:var(--muted)">${t('heatmapLess')}</span>
      ${[0,0.15,0.4,0.7,1].map(p=>{
        const bg = p===0?'var(--border)':p<0.25?'rgba(99,102,241,0.28)':p<0.6?'rgba(99,102,241,0.62)':'rgba(99,102,241,1)';
        return `<div style="width:${legendCell}px;height:${legendCell}px;background:${bg};border-radius:3px"></div>`;
      }).join('')}
      <span style="font-size:10px;color:var(--muted)">${t('heatmapMore')}</span>
    </div>`;

    html += `</div></div>`;
    grid.innerHTML = html;
  } catch {
    if (!silent && card) {
      card.style.display = '';
      grid.innerHTML = `<div style="padding:8px 2px;color:var(--muted);font-size:12px">${L==='en'?'Failed to load heatmap':'Не удалось загрузить heatmap'}</div>`;
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   AI CHAT WIDGET
══════════════════════════════════════════════════════════════════════ */
const CHAT_STORAGE_KEY = 'ops.chat.v1';
const CHAT_PANEL_PREF_KEY = 'ops.chat.panel.v2';
const CHAT_ATTACH_MAX = 4;
let chatHistory = [];
let chatAttachments = [];
let chatPanelPrefs = { mode: 'float', width: 380, height: 520 };

function loadChatHistory() {
  try { chatHistory = JSON.parse(sessionStorage.getItem(CHAT_STORAGE_KEY) || '[]'); } catch { chatHistory = []; }
}

function saveChatHistory() {
  try { sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatHistory.slice(-20))); } catch {}
}

function loadChatPanelPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_PANEL_PREF_KEY) || '{}');
    if (raw && typeof raw === 'object') {
      chatPanelPrefs = {
        mode: ['left', 'right', 'float'].includes(raw.mode) ? raw.mode : 'float',
        width: Number(raw.width) || 380,
        height: Number(raw.height) || 520,
      };
    }
  } catch {}
}

function saveChatPanelPrefs() {
  try { localStorage.setItem(CHAT_PANEL_PREF_KEY, JSON.stringify(chatPanelPrefs)); } catch {}
}

function formatChatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return '0 B';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function applyChatPanelPrefs(panel) {
  if (!panel) return;
  const isMobile = window.innerWidth <= 700;
  panel.classList.remove('chat-panel-dock-left', 'chat-panel-dock-right', 'chat-panel-float');

  if (isMobile) {
    panel.classList.add('chat-panel-float');
    panel.style.width = '';
    panel.style.height = '';
    return;
  }

  const width = Math.max(320, Math.min(860, Number(chatPanelPrefs.width) || 380));
  const height = Math.max(300, Math.min(980, Number(chatPanelPrefs.height) || 520));

  if (chatPanelPrefs.mode === 'left') {
    panel.classList.add('chat-panel-dock-left');
    panel.style.width = `${width}px`;
    panel.style.height = '';
  } else if (chatPanelPrefs.mode === 'right') {
    panel.classList.add('chat-panel-dock-right');
    panel.style.width = `${width}px`;
    panel.style.height = '';
  } else {
    panel.classList.add('chat-panel-float');
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
  }
}

function captureChatPanelSize(panel) {
  if (!panel || panel.classList.contains('hidden')) return;
  const rect = panel.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  chatPanelPrefs.width = Math.round(rect.width);
  if (chatPanelPrefs.mode === 'float') chatPanelPrefs.height = Math.round(rect.height);
  saveChatPanelPrefs();
}

function renderAttachmentBadges(items = []) {
  if (!items.length) return '';
  return `<div class="chat-bubble-attachments">${items.map(a =>
    `<span class="chat-attach-badge">🖼 ${esc(a.name || 'image')}</span>`
  ).join('')}</div>`;
}

function appendChatBubble(role, content, loading=false, attachments=[]) {
  const box = $('#chatMessages');
  if (!box) return;
  const isUser = role === 'user';
  const bg = isUser ? 'var(--accent)' : 'var(--bg)';
  const color = isUser ? '#fff' : 'var(--text)';
  const align = isUser ? 'flex-end' : 'flex-start';
  const id = loading ? 'chat-typing-indicator' : '';
  const inner = loading
    ? `<span class="chat-typing-dots">···</span>`
    : `<span style="white-space:pre-wrap;word-break:break-word">${esc(content || '')}</span>${renderAttachmentBadges(attachments)}`;
  const el = document.createElement('div');
  el.style.cssText = `display:flex;justify-content:${align};${id ? '' : ''}`;
  if (id) el.id = id;
  el.innerHTML = `<div style="max-width:88%;background:${bg};color:${color};border:1px solid var(--border);border-radius:10px;padding:8px 12px;font-size:13px">${inner}</div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function addChatAttachments(fileList) {
  const files = Array.from(fileList || []);
  for (const file of files) {
    if (chatAttachments.length >= CHAT_ATTACH_MAX) {
      toast(L === 'en' ? `Max ${CHAT_ATTACH_MAX} images` : `Максимум ${CHAT_ATTACH_MAX} изображений`, 'warn');
      break;
    }
    if (!String(file.type || '').startsWith('image/')) {
      toast(L === 'en' ? 'Only images are supported' : 'Поддерживаются только изображения', 'warn');
      continue;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast(L === 'en' ? `${file.name}: too large (8MB max)` : `${file.name}: слишком большой файл (макс 8MB)`, 'warn');
      continue;
    }
    const dataUrl = await readFileAsDataUrl(file);
    chatAttachments.push({ name: file.name, mimeType: file.type, sizeBytes: file.size, dataUrl });
  }
  renderChatAttachments();
}

function renderChatAttachments() {
  const box = $('#chatAttachments');
  if (!box) return;
  if (!chatAttachments.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = chatAttachments.map((a, idx) =>
    `<button class="chat-attach-chip" data-chat-remove="${idx}" title="${esc(a.name)}">🖼 ${esc(a.name)} · ${formatChatBytes(a.sizeBytes)} ✕</button>`
  ).join('');
}

async function sendChatMessage() {
  const input = $('#chatInput');
  const sendBtn = $('#chatSend');
  const attachBtn = $('#chatAttachBtn');
  if (!input) return;

  const msg = input.value.trim();
  const outgoingAttachments = chatAttachments.slice();
  if (!msg && !outgoingAttachments.length) return;

  input.value = '';
  chatAttachments = [];
  renderChatAttachments();

  input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  if (attachBtn) attachBtn.disabled = true;

  appendChatBubble('user', msg || (L === 'en' ? '[image attached]' : '[прикреплено изображение]'), false, outgoingAttachments);
  chatHistory.push({ role: 'user', content: msg || (L === 'en' ? `[${outgoingAttachments.length} image]` : `[${outgoingAttachments.length} изображение]`) });

  const typingEl = appendChatBubble('assistant', '', true);
  try {
    const res = await fetch('./api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        history: chatHistory.slice(-6),
        lang: L,
        attachments: outgoingAttachments.map(a => ({
          name: a.name,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          dataUrl: a.dataUrl,
        })),
      }),
      signal: AbortSignal.timeout(80_000),
    });
    const data = await res.json().catch(() => ({}));
    if (typingEl) typingEl.remove();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    const reply = data.reply || '';
    chatHistory.push({ role: 'assistant', content: reply });
    saveChatHistory();
    appendChatBubble('assistant', reply);
  } catch (err) {
    if (typingEl) typingEl.remove();
    appendChatBubble('assistant', `${t('chatError')}: ${esc(err.message || 'unknown')}`);
  } finally {
    input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    if (attachBtn) attachBtn.disabled = false;
    input.focus();
  }
}

function initChatWidget() {
  loadChatHistory();
  loadChatPanelPrefs();

  const toggle = $('#chatToggle');
  const panel = $('#chatPanel');
  const closeBtn = $('#chatClose');
  const sendBtn = $('#chatSend');
  const input = $('#chatInput');
  const dockLeftBtn = $('#chatDockLeft');
  const dockRightBtn = $('#chatDockRight');
  const dockFloatBtn = $('#chatDockFloat');
  const attachBtn = $('#chatAttachBtn');
  const fileInput = $('#chatFileInput');

  if (!toggle || !panel) return;

  // Update i18n labels
  const titleEl = $('#chatTitle');
  const inputEl = $('#chatInput');
  if (titleEl) titleEl.textContent = t('chatTitle');
  if (inputEl) inputEl.placeholder = t('chatPlaceholder');
  if (sendBtn) sendBtn.textContent = t('chatSend');

  dockLeftBtn?.setAttribute('title', L === 'en' ? 'Dock left' : 'Закрепить слева');
  dockRightBtn?.setAttribute('title', L === 'en' ? 'Dock right' : 'Закрепить справа');
  dockFloatBtn?.setAttribute('title', L === 'en' ? 'Floating mode' : 'Плавающий режим');
  attachBtn?.setAttribute('title', L === 'en' ? 'Attach image' : 'Прикрепить изображение');

  applyChatPanelPrefs(panel);
  window.addEventListener('resize', () => applyChatPanelPrefs(panel));
  window.addEventListener('mouseup', () => captureChatPanelSize(panel));

  toggle.addEventListener('click', () => {
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !isHidden);
    if (isHidden) {
      applyChatPanelPrefs(panel);
      const box = $('#chatMessages');
      if (box && !box.children.length) {
        if (chatHistory.length) {
          chatHistory.forEach(m => appendChatBubble(m.role, m.content));
        } else {
          appendChatBubble('assistant', t('chatWelcome'));
        }
      }
      input?.focus();
    }
  });

  closeBtn?.addEventListener('click', () => panel.classList.add('hidden'));

  dockLeftBtn?.addEventListener('click', () => {
    chatPanelPrefs.mode = 'left';
    applyChatPanelPrefs(panel);
    saveChatPanelPrefs();
  });
  dockRightBtn?.addEventListener('click', () => {
    chatPanelPrefs.mode = 'right';
    applyChatPanelPrefs(panel);
    saveChatPanelPrefs();
  });
  dockFloatBtn?.addEventListener('click', () => {
    chatPanelPrefs.mode = 'float';
    applyChatPanelPrefs(panel);
    saveChatPanelPrefs();
  });

  attachBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async (e) => {
    const files = e.target?.files;
    if (files?.length) await addChatAttachments(files);
    if (fileInput) fileInput.value = '';
  });

  $('#chatAttachments')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chat-remove]');
    if (!btn) return;
    const idx = Number(btn.dataset.chatRemove);
    if (!Number.isFinite(idx) || idx < 0 || idx >= chatAttachments.length) return;
    chatAttachments.splice(idx, 1);
    renderChatAttachments();
  });

  sendBtn?.addEventListener('click', sendChatMessage);
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
}

function initQuickActions() {
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || String(e.key).toLowerCase() !== 'k') return;
    e.preventDefault();
    const choice = prompt(L==='en'
      ? 'Quick actions:\n1 — Overview\n2 — Schedule\n3 — Sessions\n4 — Files\n5 — Skills\n6 — Refresh all\nEnter number:'
      : 'Быстрые действия:\n1 — Обзор\n2 — Расписание\n3 — Сессии\n4 — Файлы\n5 — Скиллы\n6 — Обновить всё\nВведите номер:'
    );
    if (!choice) return;
    if (choice === '1') activateTab('overview');
    if (choice === '2') activateTab('crons');
    if (choice === '3') activateTab('sessions');
    if (choice === '4') activateTab('files');
    if (choice === '5') activateTab('skills');
    if (choice === '6') { refreshAll(); toast(t('updating')); }
  });
}

/* ════ i18n ════════════════════════════════════════════════════════ */
const LANG_KEY = 'ops.lang.v1';
const i18n = {
  ru: {
    overview:'Обзор', crons:'Расписание', sessions:'Сессии', files:'Файлы', skills:'Скиллы',
    alerts:'Алерты', alertsSub:'проблемы и риски',
    recommendations:'Рекомендации', recommendationsSub:'AI-анализ системы',
    activeTasks:'Активные задачи (live)', activeTasksSub:'Telegram · Sub-agents · AI-fix',
    incidentCenter:'Инцидент-центр', incidentCenterSub:'single pane: алерты · действия · статус',
    healthScore:'Health Score + Отчёт', healthScoreSub:'по агентам и executive-summary',
    operatorNow:'Оператор сейчас делает', operatorNowSub:'live stream ручных и авто-действий',
    weeklyReview:'Недельный review (7д)',
    usageGuard:'Лимиты и usage guard', healthScoreAgents:'Health score по агентам',
    buildReport:'Собрать отчёт', copyReport:'Копировать',
    updating:'Обновление…', statusOk:'Всё в порядке', taskEmpty:'Сейчас активных задач нет',
    dismiss:'✕ Закрыть', fixAi:'🤖 Исправить ИИ', whyImportant:'Почему важно',
    triageNew:'new', triageAck:'ack', triageInv:'solving', triageResolved:'resolved', triageIgnored:'ignored',
    noAlerts:'Нет активных алертов', noEvents:'Нет событий',
    steer:'Направить', kill:'Убить', retry:'Повтор',
    update:'Обновить OpenClaw',
    apply:'Применить', searchFiles:'поиск по файлам', searchSessions:'ключ сессии, модель…', searchSkills:'поиск по скиллам',
    agentFilter:'Агент', searchFilter:'Поиск',
    telegramSessions:'Telegram сессии', regularSessions:'Обычные сессии', cronSessions:'Cron сессии',
    telegramCrons:'Telegram задачи', otherCrons:'Остальные задачи',
    runHistory:'Запустить', enable:'Вкл', disable:'Выкл', history:'История', deleteCron:'Удалить',
    confirmDelete:'Удалить этот cron?', confirmDeleteSkill:'Удалить скилл',
    fileTree:'Дерево файлов', fileTags:'Теги', saveTags:'Сохранить теги', showDiff:'Показать diff',
    reportReady:'Отчёт скопирован ✓', reportNotBuilt:'Отчёт ещё не собран',
    healthHelp:'Health Score:\n100 = идеально\n75–99 = хорошо\n50–74 = есть проблемы\n<50 = требует внимания\n\nБерём: ошибки cron, usage лимиты, статусы сессий.',
    sessionModel:'Модель сессии', ctxUsage:'Контекст',
    noItems:'Нет данных', loading:'Загрузка…', error:'Ошибка',
    incidentCenterEmpty:'Нет инцидентов', usageGuardEmpty:'Нет данных об использовании',
    runbook:'Runbook',
    editCron:'✏️ Изменить', saveCron:'💾 Сохранить', cancelEdit:'Отмена',
    cronEditTitle:'Редактировать задачу',
    cronEditSchedLabel:'Расписание (cron или мс)',
    cronEditMsgLabel:'Текст задачи',
    cronEditTimeoutLabel:'Таймаут (мс)',
    cronEditSessionLabel:'Сессия',
    cronEditDeliveryLabel:'Доставка',
    viewTranscript:'👁 История', transcriptTitle:'История сессии',
    noHistory:'История пуста', showMore:'Показать ещё', showLess:'Свернуть',
    heatmapTitle:'Активность по часам', heatmapSub:'сессии и cron за 7 дней',
    heatmapLess:'меньше', heatmapMore:'больше',
    chatTitle:'💬 AI Chat', chatPlaceholder:'Спроси про агентов, cron, бюджет…',
    chatSend:'→', chatWelcome:'Привет! Спроси что-нибудь про систему.',
    chatError:'Ошибка подключения к AI',
    cronCostBadge:'7д: токены',
  },
  en: {
    overview:'Overview', crons:'Schedule', sessions:'Sessions', files:'Files', skills:'Skills',
    alerts:'Alerts', alertsSub:'issues and risks',
    recommendations:'Recommendations', recommendationsSub:'AI system analysis',
    activeTasks:'Active tasks (live)', activeTasksSub:'Telegram · Sub-agents · AI-fix',
    incidentCenter:'Incident center', incidentCenterSub:'single pane: alerts · actions · status',
    healthScore:'Health Score + Report', healthScoreSub:'per-agent + executive summary',
    operatorNow:'Operator right now', operatorNowSub:'live stream of manual & auto actions',
    weeklyReview:'Weekly review (7d)',
    usageGuard:'Limits & usage guard', healthScoreAgents:'Health score by agent',
    buildReport:'Build report', copyReport:'Copy',
    updating:'Updating…', statusOk:'All clear', taskEmpty:'No active tasks right now',
    dismiss:'✕ Dismiss', fixAi:'🤖 AI Fix', whyImportant:'Why it matters',
    triageNew:'new', triageAck:'ack', triageInv:'solving', triageResolved:'resolved', triageIgnored:'ignored',
    noAlerts:'No active alerts', noEvents:'No events yet',
    steer:'Steer', kill:'Kill', retry:'Retry',
    update:'Update OpenClaw',
    apply:'Apply', searchFiles:'search files…', searchSessions:'session key, model…', searchSkills:'search skills…',
    agentFilter:'Agent', searchFilter:'Search',
    telegramSessions:'Telegram sessions', regularSessions:'Regular sessions', cronSessions:'Cron sessions',
    telegramCrons:'Telegram tasks', otherCrons:'Other tasks',
    runHistory:'Run', enable:'Enable', disable:'Disable', history:'History', deleteCron:'Delete',
    confirmDelete:'Delete this cron?', confirmDeleteSkill:'Delete skill',
    fileTree:'File tree', fileTags:'Tags', saveTags:'Save tags', showDiff:'Show diff',
    reportReady:'Report copied ✓', reportNotBuilt:'Report not built yet',
    healthHelp:'Health Score:\n100 = perfect\n75–99 = good\n50–74 = issues present\n<50 = needs attention\n\nBased on: cron errors, usage limits, session statuses.',
    sessionModel:'Session model', ctxUsage:'Context',
    noItems:'No data', loading:'Loading…', error:'Error',
    incidentCenterEmpty:'No incidents', usageGuardEmpty:'No usage data',
    runbook:'Runbook',
    editCron:'✏️ Edit', saveCron:'💾 Save', cancelEdit:'Cancel',
    cronEditTitle:'Edit cron job',
    cronEditSchedLabel:'Schedule (cron expr or ms interval)',
    cronEditMsgLabel:'Task message',
    cronEditTimeoutLabel:'Timeout (ms)',
    cronEditSessionLabel:'Session target',
    cronEditDeliveryLabel:'Delivery mode',
    viewTranscript:'👁 History', transcriptTitle:'Session history',
    noHistory:'No history yet', showMore:'Show more', showLess:'Show less',
    heatmapTitle:'Activity heatmap', heatmapSub:'sessions & crons last 7 days',
    heatmapLess:'less', heatmapMore:'more',
    chatTitle:'💬 AI Chat', chatPlaceholder:'Ask about agents, crons, budget…',
    chatSend:'→', chatWelcome:'Hi! Ask me anything about your system.',
    chatError:'Failed to connect to AI',
    cronCostBadge:'7d: tokens',
  }
};

let L = 'ru';

function setLang(lang) {
  L = (lang === 'en') ? 'en' : 'ru';
  try { localStorage.setItem(LANG_KEY, L); } catch {}
  const btn = $('#langBtn');
  if (btn) btn.textContent = L === 'ru' ? 'EN' : 'RU';
  applyI18nToDOM();
  S.loaded = {};
  refreshAll();
}

function loadLang() {
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch {}
  L = (saved === 'en') ? 'en' : 'ru';
  const btn = $('#langBtn');
  if (btn) btn.textContent = L === 'ru' ? 'EN' : 'RU';
  applyI18nToDOM();
}

function t(key) { return (i18n[L] || i18n.ru)[key] || key; }

function applyI18nToDOM() {
  // Tab labels
  const tabMap = { overview: t('overview'), crons: t('crons'), sessions: t('sessions'), files: t('files'), skills: t('skills') };
  $$('.tab[data-tab]').forEach(btn => {
    const lbl = tabMap[btn.dataset.tab];
    if (!lbl) return;
    const svg = btn.querySelector('svg');
    btn.innerHTML = `${svg ? svg.outerHTML : ''} ${esc(lbl)}`;
  });

  // Main labels/titles
  const domMap = {
    '#globalLoaderText': L === 'en' ? 'Loading data…' : 'Загрузка данных…',
    '#agentsSectionTitle': L === 'en' ? 'Agents' : 'Агенты',
    '#alertsTitle': t('alerts'),
    '#alertsSub': t('alertsSub'),
    '#intelTitle': t('recommendations'),
    '#intelSub': t('recommendationsSub'),
    '#activeTasksTitle': t('activeTasks'),
    '#activeTasksSub': t('activeTasksSub'),
    '#incidentCenterTitle': t('incidentCenter'),
    '#incidentCenterSub': t('incidentCenterSub'),
    '#weeklyReviewTitle': t('weeklyReview'),
    '#healthTitle': t('healthScore'),
    '#healthSub': t('healthScoreSub'),
    '#usageGuardTitle': t('usageGuard'),
    '#healthAgentsTitle': t('healthScoreAgents'),
    '#cronAgentLabel': t('agentFilter'),
    '#sessionAgentLabel': t('agentFilter'),
    '#fileAgentLabel': t('agentFilter'),
    '#skillAgentLabel': t('agentFilter'),
    '#sessionSearchLabel': t('searchFilter'),
    '#fileSearchLabel': t('searchFilter'),
    '#skillSearchLabel': t('searchFilter'),
    '#cronHistoryTitle': L === 'en' ? 'Run history' : 'История запусков',
    '#thSessionAgent': t('agentFilter'),
    '#thSessionKey': L === 'en' ? 'Session' : 'Сессия',
    '#thSessionModel': L === 'en' ? 'Model' : 'Модель',
    '#thSessionAge': L === 'en' ? 'Age' : 'Возраст',
    '#thSessionCtx': L === 'en' ? 'Context usage' : 'Использование контекста',
    '#fileListLabel': L === 'en' ? 'Select file' : 'Выбери файл',
    '#saveTagsBtn': t('saveTags'),
    '#showDiffBtn': t('showDiff'),
    '#fileDiffHeader': L === 'en' ? 'Recent changes' : 'Последние изменения',
    '#buildReportBtn': t('buildReport'),
    '#copyReportBtn': t('copyReport'),
    '#updateBtn': t('update'),
    '#cronHelperText': L === 'en' ? 'Run · Enable/Disable · History · Delete' : 'Run · Enable/Disable · History · Delete',
    '#taskReplayTitle': L === 'en' ? 'Task timeline' : 'История этапов задачи',
  };
  for (const [sel, txt] of Object.entries(domMap)) {
    const el = $(sel);
    if (el && txt != null) el.textContent = txt;
  }

  // Keep refresh button icon-only (no text)
  const rbtn = $('#refreshBtn');
  if (rbtn) {
    if (!rbtn.dataset.iconHtml) rbtn.dataset.iconHtml = rbtn.innerHTML;
    rbtn.innerHTML = rbtn.dataset.iconHtml;
    rbtn.title = L === 'en' ? 'Refresh' : 'Обновить';
  }

  // Tooltips / placeholders
  const hb = $('#healthHelpBtn');
  if (hb) hb.title = L === 'en' ? 'What does Health score mean?' : 'Что означает Health score?';

  const ph = $('#sessionSearch');
  if (ph) ph.placeholder = t('searchSessions');
  const phf = $('#fileSearch');
  if (phf) phf.placeholder = t('searchFiles');
  const phs = $('#skillSearch');
  if (phs) phs.placeholder = t('searchSkills');

  const fvTitle = $('#fileViewTitle');
  if (fvTitle && (!S.file || !S.file.path)) fvTitle.textContent = L === 'en' ? 'No file selected' : 'Файл не выбран';
  const fv = $('#fileView');
  if (fv && (!S.file || !S.file.path) && /Выбери файл|Select file/.test(fv.textContent || '')) {
    fv.textContent = L === 'en' ? 'Select a file to preview…' : 'Выбери файл для просмотра…';
  }
  const rp = $('#reportPreview');
  if (rp && (!S.reportText || !S.reportText.trim())) rp.textContent = t('reportNotBuilt');
}

/* ── state ── */
const S = { me:{user:'…',role:'viewer'}, agents:[], file:null, loaded:{}, aiOps:{}, summary:null, lastSessions:[], lastCrons:[], alerts:[], intel:null, reportText:'', activeTasks:[], usage:null, healthRows:[], dismissed:{alerts:{}, intel:{}} };

const DISMISS_STORE_KEYS = {
  alerts: 'ops.dismiss.alerts.v1',
  intel: 'ops.dismiss.intel.v1',
};
const THEME_KEY = 'ops.theme.v1';

function loadDismissed() {
  try {
    S.dismissed.alerts = JSON.parse(localStorage.getItem(DISMISS_STORE_KEYS.alerts) || '{}') || {};
    S.dismissed.intel = JSON.parse(localStorage.getItem(DISMISS_STORE_KEYS.intel) || '{}') || {};
  } catch {
    S.dismissed.alerts = {};
    S.dismissed.intel = {};
  }
}

function saveDismissed(kind) {
  try {
    const key = kind === 'intel' ? DISMISS_STORE_KEYS.intel : DISMISS_STORE_KEYS.alerts;
    const data = kind === 'intel' ? S.dismissed.intel : S.dismissed.alerts;
    localStorage.setItem(key, JSON.stringify(data || {}));
  } catch {}
}

function setTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem(THEME_KEY, t); } catch {}

  const b = $('#themeBtn');
  if (b) {
    b.textContent = t === 'dark' ? '☀️' : '🌙';
    if (L === 'en') b.title = t === 'dark' ? 'Light theme' : 'Dark theme';
    else b.title = t === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  }
  S.theme = t;
}

function loadTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  if (saved === 'dark' || saved === 'light') {
    setTheme(saved);
    return;
  }
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(prefersDark ? 'dark' : 'light');
}

function toggleTheme() {
  setTheme(S.theme === 'dark' ? 'light' : 'dark');
}

function itemKey(item) {
  const stableId = item?.id || item?.taskId || item?.cronId || item?.jobId || item?.sessionKey || item?.checkId || item?.title || '';
  return [item?.kind || item?.__kind || '', stableId].join('|').slice(0, 300);
}

/* ── API ── */
async function api(p, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('./api/'+p, {cache:'no-store', signal: ctrl.signal});
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.error || ((L==='en' ? 'Error ' : 'Ошибка ') + r.status));
    return d;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(L==='en' ? 'Request timeout' : 'Таймаут запроса');
    throw e;
  } finally {
    clearTimeout(t);
  }
}
async function post(p, body, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('./api/'+p, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body), signal: ctrl.signal});
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.error || ((L==='en' ? 'Error ' : 'Ошибка ') + r.status));
    return d;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(L==='en' ? 'Request timeout' : 'Таймаут запроса');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/* ── toast ── */
function toast(msg, type='') {
  const el=$('#toast'); el.textContent=msg;
  el.className='toast'+(type?' '+type:'');
  el.classList.remove('hidden');
  clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.add('hidden'),3200);
}

/* ── per-section loader: show skeleton only on first load ── */
function withSkel(elId, html) {
  const el=$(elId); if (!el) return;
  if (!S.loaded[elId]) { el.innerHTML = html; S.loaded[elId]=true; }
}

/* ── RU localization for alerts/recommendations ── */
function ruText(text) {
  if (!text) return '';
  let t = String(text);

  const fullMap = {
    'Security warnings detected': 'Обнаружены предупреждения безопасности',
    'High context usage': 'Высокое использование контекста',
    'Close security warning debt': 'Закрыть долг по предупреждениям безопасности',
    'Open run history, inspect summary, then run once manually.': 'Открой историю запусков, проверь summary и запусти вручную один раз.',
    'Address security audit warnings to reduce exploit surface.': 'Устрани предупреждения аудита безопасности, чтобы снизить поверхность атак.',
    'Cron API temporarily unavailable': 'Cron API временно недоступно',
    'Cron-based checks may be incomplete': 'Проверки на основе cron могут быть неполными',
    'Check gateway responsiveness and retry cron list. Dashboard is in degraded mode for cron-dependent widgets.': 'Проверь отклик gateway и повтори cron list. Дашборд работает в degraded-режиме для cron-зависимых виджетов.',
  };
  if (fullMap[t]) return fullMap[t];

  t = t
    .replace(/^Security:\s*/i, 'Безопасность: ')
    .replace(/^Cron issue:\s*/i, 'Проблема cron: ')
    .replace(/^Investigate recent error:\s*/i, 'Проверь последнюю ошибку: ')
    .replace(/^Fix unstable cron:\s*/i, 'Исправь нестабильный cron: ')
    .replace(/^Likely to fail again soon:\s*/i, 'Скоро может снова упасть: ')
    .replace(/^Long running task:\s*/i, 'Долго выполняется: ')
    .replace(/^(\d+) warning\(s\) in security audit$/i, (_, n) => `${n} ${Number(n) === 1 ? 'предупреждение' : 'предупреждений'} в аудите безопасности`)
    .replace(/Reverse proxy headers are not trusted/gi, 'Заголовки reverse proxy не доверены')
    .replace(/gateway\.bind is loopback and gateway\.trustedProxies is empty\./gi, 'gateway.bind = loopback, а gateway.trustedProxies пустой.')
    .replace(/If you expose the Control UI through a reverse proxy, configure trusted proxies so local-client checks cannot be spoofed\./gi, 'Если UI открыт через reverse proxy — настрой trusted proxies, чтобы нельзя было подменить локальные проверки клиента.')
    .replace(/Set gateway\.trustedProxies to your proxy IPs or keep the Control UI local-only\./gi, 'Укажи IP прокси в gateway.trustedProxies или оставь UI только локальным.')
    .replace(/\bagent=/gi, 'агент=')
    .replace(/\btype=/gi, 'тип=')
    .replace(/\bduration=/gi, 'длительность=')
    .replace(/\bstep=/gi, 'этап=')
    .replace(/\berrors=/gi, 'ошибок=')
    .replace(/\bstatus=error\b/gi, 'статус=ошибка')
    .replace(/\bstatus=ok\b/gi, 'статус=ок')
    .replace(/\bstatus=warning\b/gi, 'статус=предупреждение');

  t = t.replace(
    /Review logs and run manually; if still failing, disable temporarily \(id=([^\)]+)\)\./i,
    'Проверь логи и запусти вручную; если снова падает — временно отключи (id=$1).'
  );

  return t;
}

function uiText(text) {
  return L === 'ru' ? ruText(text) : String(text ?? '');
}

/* ── tabs ── */
function initTabs() {
  $$('.tab').forEach(btn => btn.addEventListener('click', () => {
    $$('.tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab-content').forEach(s=>s.classList.add('hidden'));
    const key = btn.dataset.tab;
    document.getElementById('tab-'+key).classList.remove('hidden');
    if (key==='crons')    loadCrons(false);
    if (key==='sessions') loadSessions(false);
    if (key==='files')    loadFiles(false);
    if (key==='skills')   loadSkills(false);
  }));
}

function populateSelects(agents) {
  const opts=`<option value="all">${L==='en'?'All agents':'Все агенты'}</option>`+
    agents.map(a=>`<option value="${esc(a.id)}">${esc(a.id)}</option>`).join('');
  ['cronAgentFilter','sessionAgentFilter','fileAgentFilter','skillAgentFilter'].forEach(id=>{
    const sel=document.getElementById(id); if(!sel) return;
    const cur=sel.value; sel.innerHTML=opts;
    sel.value=agents.some(a=>a.id===cur)?cur:'all';
  });
}

/* ══════════════════════════════════════════════════════════════════════
   OVERVIEW — 4 секции, каждая независимая
══════════════════════════════════════════════════════════════════════ */

async function loadStats(silent=false) {
  if (!silent) withSkel('#statRow', Array(4).fill('<div class="stat-card loading-placeholder"></div>').join(''));
  try {
    const d=await api('summary', 45000), o=d.openclaw;
    S.summary = d;
    S.agents=o.agents; populateSelects(o.agents);
    $('#lastUpdated').textContent = (L === 'en' ? 'updated ' : 'обновлено ') + new Date(d.app.updatedAt).toLocaleTimeString();
    const dotCls=o.securityCritical>0?'dot-error':o.securityWarn>0?'dot-warn':'dot-ok';
    $('#topbarStatus').className='status-dot '+dotCls;

    const shield = o.securityCritical>0
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

    const cards=[
      {icon:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
       bg:'#eef2ff',value:esc(d.app.version),label:L==='en'?'OpenClaw version':'Версия OpenClaw',trend:esc(o.host),tc:'pill-blue'},
      {icon:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`,
       bg:'#eff6ff',value:o.activeSessions,label:L==='en'?'Active sessions':'Активных сессий',trend:o.totalSessions + (L==='en'?' total':' всего'),tc:'pill-muted'},
      {icon:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
       bg:'#f0fdf4',value:o.enabledCrons,label:L==='en'?'Active jobs':'Активных задач',trend:o.totalCrons + (L==='en'?' total':' всего'),tc:'pill-muted'},
      {icon:shield,
       bg:o.securityCritical>0?'#fef2f2':o.securityWarn>0?'#fffbeb':'#f0fdf4',
       value:o.securityCritical>0?(L==='en'?'Critical':'Критично'):o.securityWarn>0?(L==='en'?'Warning':'Внимание'):'OK',
       label:L==='en'?'Security':'Безопасность',
       trend:o.securityCritical>0?(o.securityCritical + (L==='en'?' critical':' крит.')):o.securityWarn>0?(o.securityWarn + (L==='en'?' warnings':' предупр.')):(L==='en'?'All good':'Всё хорошо'),
       tc:o.securityCritical>0?'pill-red':o.securityWarn>0?'pill-amber':'pill-green'},
    ];
    $('#statRow').innerHTML=cards.map(c=>
      `<div class="stat-card"><div class="stat-top"><div class="stat-icon" style="background:${c.bg}">${c.icon}</div><span class="pill ${c.tc}">${c.trend}</span></div><div class="stat-value">${c.value}</div><div class="stat-label">${c.label}</div></div>`
    ).join('');
  } catch(err) {
    const hasRenderedStats = !!$('#statRow')?.querySelector('.stat-card:not(.loading-placeholder)');
    if (silent || hasRenderedStats) {
      if (!S.statsTimeoutNotifiedAt || Date.now() - S.statsTimeoutNotifiedAt > 120000) {
        S.statsTimeoutNotifiedAt = Date.now();
        toast(L==='en' ? 'Stats temporarily stale, showing last data' : 'Статистика временно не обновилась, показываю последние данные', 'warn');
      }
      return;
    }
    $('#statRow').innerHTML=`<div style="color:var(--red);grid-column:1/-1;padding:12px">${L==='en'?'Stats error':'Ошибка статистики'}: ${esc(err.message)}</div>`;
  }
}

async function loadAgentRow(silent=false) {
  if (!silent) withSkel('#agentRow', Array(2).fill('<div class="agent-card loading-placeholder"></div>').join(''));
  try {
    const d=await api('summary', 45000);
    $('#agentRow').innerHTML=d.openclaw.agents.map(a=>{
      const c=ac(a.id), last=a.lastActiveAgeMs!=null?humanDur(a.lastActiveAgeMs):(L==='en'?'n/a':'н/д');
      const meta = L==='en' ? `active ${last} ago` : `активность ${last} назад`;
      return `<div class="agent-card"><div class="agent-avatar" style="background:${c.bg};color:${c.text}">${esc(a.id[0].toUpperCase())}</div><div><div class="agent-name">${esc(a.id)}</div><div class="agent-meta">${meta}</div></div></div>`;
    }).join('');
  } catch { $('#agentRow').innerHTML=`<div style="color:var(--muted);font-size:12px;padding:8px">${t('noItems')}</div>`; }
}

function alertWhyImportant(a) {
  if (L === 'en') {
    if (a.kind === 'security') return 'Can lead to false trusted-client detection behind proxy and wrong access decisions.';
    if (a.kind === 'cron') return 'A failing cron breaks automation and causes missed tasks/reports.';
    if (a.kind === 'context') return 'High context usage increases degradation risk on long tasks.';
    if (a.kind === 'session') return 'Recent aborted run suggests repeat failures without manual check.';
    return 'Impacts system stability and automation quality.';
  }
  if (a.kind === 'security') return 'Может привести к ложному определению доверенного клиента через прокси и ошибочным правам доступа.';
  if (a.kind === 'cron') return 'Падающий cron ломает автоматизацию и приводит к пропущенным задачам/отчётам.';
  if (a.kind === 'context') return 'Высокий контекст повышает риск деградации ответов и обрывов на длинных задачах.';
  if (a.kind === 'session') return 'Есть недавний аварийный запуск — возможны повторные сбои без ручной проверки.';
  return 'Влияет на стабильность системы и качество автоматизации.';
}

function renderAlertActions(a) {
  const isHealthy = a?.severity === 'ok' || a?.kind === 'ok';
  const canAiFix = !isHealthy && ['warning', 'critical', 'info'].includes(String(a?.severity || ''));

  const explainBtn = isHealthy ? '' : `<button class="btn btn-sm btn-ghost" data-action="alert-explain">${t('whyImportant')}</button>`;
  const aiBtn = canAiFix ? `<button class="btn btn-sm btn-ghost" data-action="alert-ai-fix">${t('fixAi')}</button>` : '';
  const closeBtn = `<button class="btn btn-sm btn-ghost" data-action="alert-dismiss">${t('dismiss')}</button>`;

  if (a.kind === 'cron' && a.cronId) {
    return `${explainBtn}${aiBtn}<button class="btn btn-sm btn-ghost" data-action="alert-cron-history" data-cron-id="${esc(a.cronId)}">${t('history')}</button><button class="btn btn-sm btn-success" data-action="alert-cron-run" data-cron-id="${esc(a.cronId)}">${t('runHistory')}</button><button class="btn btn-sm btn-danger" data-action="alert-cron-disable" data-cron-id="${esc(a.cronId)}">${t('disable')}</button>${closeBtn}`;
  }
  return `${explainBtn}${aiBtn}${closeBtn}`;
}

async function loadAlerts(silent=false) {
  if (!silent) withSkel('#alertsList', skelRow(2,'36px'));
  try {
    const d=await api('alerts');
    const visible = (d.alerts || []).filter(a => !S.dismissed.alerts[itemKey(a)]);
    $('#alertsList').innerHTML=visible.map((a,idx)=> {
      const k = a.key || itemKey(a);
      const tri = a.triage || null;
      const impactLine = a.impact ? `<div style="font-size:11px;color:var(--muted);margin-top:1px">💥 ${esc(uiText(a.impact))}</div>` : '';
      const nextLine = a.nextStep ? `<div style="font-size:11px;color:var(--blue);margin-top:2px">→ ${esc(uiText(a.nextStep))}</div>` : '';
      const triP = triagePill(tri);
      const triActions = `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${renderTriageActions('alert', k, tri)}</div>`;
      return `<div class="alert-item ${esc(a.severity)}" data-alert-idx="${idx}" data-alert-key="${esc(k)}"><div class="alert-dot"></div><div style="width:100%"><div style="display:flex;align-items:center;gap:6px">${triP}<div class="alert-title">${esc(uiText(a.title))}</div></div><div class="alert-detail">${esc(uiText(a.details))}</div>${impactLine}${nextLine}<div class="alert-actions" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${renderAlertActions(a)}</div>${triActions}<div class="alert-op-status hidden" style="margin-top:6px;font-size:12px;color:var(--muted)"></div><div class="alert-why hidden" style="margin-top:6px;font-size:12px;color:var(--muted)">${esc(alertWhyImportant(a))}</div></div></div>`;
    }).join('') || `<div style="color:var(--muted);font-size:12px;padding:8px">${t('noAlerts')}</div>`;
    S.alerts = visible;
  } catch(err) { $('#alertsList').innerHTML=`<div style="color:var(--red);font-size:12px;padding:8px">${t('error')}: ${esc(err.message)}</div>`; }
}

function renderIntelActions({ allowAiFix=false } = {}) {
  const aiBtn = allowAiFix ? `<button class="btn btn-sm btn-ghost" data-action="intel-ai-fix">${t('fixAi')}</button>` : '';
  return `<div class="alert-actions" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${aiBtn}<button class="btn btn-sm btn-ghost" data-action="intel-dismiss">${t('dismiss')}</button></div><div class="alert-op-status hidden" style="margin-top:6px;font-size:12px;color:var(--muted)"></div>`;
}

async function loadIntel(silent=false) {
  if (!silent) withSkel('#intelList', skelRow(2,'36px'));
  try {
    const intel=await api('intel');
    const recommendations = (intel.recommendations || []).filter(r => !S.dismissed.intel[itemKey({ ...r, __kind:'recommendation' })]);
    const predictions = (intel.predictions || []).filter(p => !S.dismissed.intel[itemKey({ ...p, __kind:'prediction' })]);
    S.intel = { recommendations, predictions };

    const items=[
      ...recommendations.map((r,idx)=>{
        const cls=r.priority==='high'?'warning':r.priority==='medium'?'info':'ok';
        const k = r.key || itemKey({ ...r, __kind:'recommendation' });
        const allowAiFix = ['high', 'medium'].includes(String(r.priority || '').toLowerCase());
        const tri = r.triage || null;
        const impactLine = r.impact ? `<div style="font-size:11px;color:var(--muted);margin-top:1px">💥 ${esc(uiText(r.impact))}</div>` : '';
        const nextLine = r.nextStep ? `<div style="font-size:11px;color:var(--blue);margin-top:2px">→ ${esc(uiText(r.nextStep))}</div>` : '';
        return `<div class="alert-item ${cls}" data-intel-kind="recommendation" data-intel-idx="${idx}" data-intel-key="${esc(k)}"><div class="alert-dot"></div><div style="width:100%"><div style="display:flex;align-items:center;gap:6px">${triagePill(tri)}<div class="alert-title">${esc(uiText(r.title))}</div></div><div class="alert-detail">${esc(uiText(r.action||''))}</div>${impactLine}${nextLine}<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${renderTriageActions('intel', k, tri)}</div>${renderIntelActions({ allowAiFix })}</div></div>`;
      }),
      ...predictions.map((p,idx)=>{
        const cls=p.level==='risk'?'warning':'ok';
        const k = p.key || itemKey({ ...p, __kind:'prediction' });
        const allowAiFix = String(p.level || '').toLowerCase() === 'risk';
        const tri = p.triage || null;
        const conf = L === 'ru' ? `уверенность ${Math.round((p.confidence||0)*100)}%` : `confidence ${Math.round((p.confidence||0)*100)}%`;
        return `<div class="alert-item ${cls}" data-intel-kind="prediction" data-intel-idx="${idx}" data-intel-key="${esc(k)}"><div class="alert-dot"></div><div style="width:100%"><div style="display:flex;align-items:center;gap:6px">${triagePill(tri)}<div class="alert-title">${esc(uiText(p.title))}</div></div><div class="alert-detail">${conf}</div><div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${renderTriageActions('intel', k, tri)}</div>${renderIntelActions({ allowAiFix })}</div></div>`;
      }),
    ];
    $('#intelList').innerHTML=items.join('')||
      `<div class="alert-item ok"><div class="alert-dot"></div><div class="alert-title">${L==='en'?'No issues detected':'Проблем не обнаружено'}</div></div>`;
  } catch(err) { $('#intelList').innerHTML=`<div style="color:var(--red);font-size:12px;padding:8px">${t('error')}: ${esc(err.message)}</div>`; }
}

function scoreColor(score) {
  if (score >= 80) return 'var(--green)';
  if (score >= 60) return 'var(--amber)';
  return 'var(--red)';
}

function showHealthScoreHelp() {
  if (L === 'en') {
    alert(
      'Health score (0–100) — quick agent stability metric.\n\n' +
      'Based on:\n' +
      '• cron errors\n' +
      '• high context usage (ctx 80%+ and 60%+)\n' +
      '• aborted runs\n\n' +
      '100 = all stable; lower = higher risk of failures.'
    );
  } else {
    alert(
      'Health score (0–100) — это быстрая метрика стабильности агента.\n\n' +
      'Считается из:\n' +
      '• ошибок cron\n' +
      '• высокого контекста (ctx 80%+ и 60%+)\n' +
      '• аварийных запусков (aborted)\n\n' +
      '100 = всё стабильно, чем ниже — тем выше риск сбоев.'
    );
  }
}

function minutesToReset(iso) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(diff / 60000));
}

function resetLabel(iso) {
  const m = minutesToReset(iso);
  if (L === 'en') {
    if (m == null) return 'reset: n/a';
    if (m < 60) return `reset in ${m}m`;
    const h = Math.floor(m/60), mm = m%60;
    return `reset in ${h}h ${mm}m`;
  }
  if (m == null) return 'сброс: н/д';
  if (m < 60) return `сброс через ${m}м`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `сброс через ${h}ч ${mm}м`;
}

function normalizeUsageError(provider, errorText) {
  const p = String(provider || '').toLowerCase();
  const err = String(errorText || '');
  if (p === 'anthropic' && /scope requirement\s+user:profile/i.test(err)) {
    return L==='en'
      ? 'Anthropic usage API unavailable for this token type (needs OAuth scope user:profile). Model auth is unaffected.'
      : 'Usage API Anthropic недоступно для этого типа токена (нужен OAuth scope user:profile). На обычную token-авторизацию моделей это не влияет.';
  }
  return err;
}

async function loadUsageGuard(silent=false) {
  const box = $('#usageGuardList');
  if (!box) return;
  if (!silent && !S.loaded['#usageGuardList']) withSkel('#usageGuardList', skelRow(3,'28px'));
  try {
    const u = await api('usage', 20000);
    S.usage = u;
    const providers = u.providers || [];
    if (!providers.length) {
      box.innerHTML = `<div style="font-size:12px;color:var(--muted)">${t('usageGuardEmpty')}</div>`;
      return;
    }

    const rows = [];
    for (const p of providers) {
      if (p.error) {
        const errText = normalizeUsageError(p.provider, p.error);
        rows.push(`<div style="margin-bottom:8px"><div style="font-size:12px;font-weight:600">${esc(p.displayName || p.provider)}</div><div style="font-size:11px;color:var(--amber)">${esc(errText)}</div></div>`);
        continue;
      }
      for (const w of (p.windows || [])) {
        const used = Number(w.usedPercent || 0);
        const left = Number(w.remainingPercent ?? Math.max(0, 100 - used));
        const color = used >= 90 ? 'var(--red)' : used >= 75 ? 'var(--amber)' : 'var(--green)';
        const leftLbl=L==='en'?`${left}% left`:`осталось ${left}%`, usedLbl=L==='en'?`used ${used}%`:`использовано ${used}%`;
        rows.push(`<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:8px"><div style="font-size:12px"><b>${esc(p.displayName || p.provider)}</b> · ${esc(w.label || 'window')}</div><div style="font-size:11px;color:${color};font-weight:700">${leftLbl}</div></div><div class="ctx-bar" style="margin-top:4px"><div class="ctx-fill" style="width:${used}%;background:${color}"></div></div><div style="font-size:11px;color:var(--muted);margin-top:3px">${usedLbl} · ${resetLabel(w.resetAt)}</div></div>`);
      }
    }

    box.innerHTML = rows.join('') || `<div style="font-size:12px;color:var(--muted)">${L==='en'?'No limit windows':'Нет окон лимитов'}</div>`;
  } catch (err) {
    box.innerHTML = `<div style="font-size:12px;color:var(--red)">${L==='en'?'Usage error':'Ошибка usage'}: ${esc(err.message)}</div>`;
  }
}

async function loadHealthScore(silent=false) {
  const box = $('#healthScoreList');
  if (!box) return;
  if (!silent && !S.loaded['#healthScoreList']) withSkel('#healthScoreList', skelRow(4,'28px'));
  try {
    let sessions = S.lastSessions;
    let crons = S.lastCrons;
    if (!sessions?.length) sessions = (await api('sessions?agentId=all')).sessions || [];
    if (!crons?.length) crons = (await api('crons?agentId=all')).jobs || [];

    const agents = [...new Set([...(S.agents||[]).map(a=>a.id), ...sessions.map(s=>s.agentId), ...crons.map(c=>c.agentId)])].filter(Boolean).sort();
    const rows = agents.map(agentId => {
      const aSessions = sessions.filter(s => s.agentId === agentId);
      const aCrons = crons.filter(c => c.agentId === agentId);
      const cronErrors = aCrons.filter(c => c.lastStatus === 'error' || (c.consecutiveErrors||0) > 0).length;
      const highCtx = aSessions.filter(s => Number.isFinite(s.percentUsed) && s.percentUsed >= 80).length;
      const warnCtx = aSessions.filter(s => Number.isFinite(s.percentUsed) && s.percentUsed >= 60 && s.percentUsed < 80).length;
      const aborted = aSessions.filter(s => s.abortedLastRun).length;
      let score = 100 - cronErrors*15 - highCtx*10 - warnCtx*6 - aborted*12;
      score = Math.max(0, Math.min(100, score));
      const color = scoreColor(score);
      return { agentId, score, color, cronErrors, highCtx, warnCtx, aborted };
    });

    S.healthRows = rows;
    box.innerHTML = rows.map(r => {
      const c = ac(r.agentId);
      return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="pill" style="background:${c.bg};color:${c.text}">${esc(r.agentId)}</span><span style="font-size:12px;color:${r.color};font-weight:700">${r.score}/100</span></div><div class="ctx-bar" style="margin-top:6px"><div class="ctx-fill" style="width:${r.score}%;background:${r.color}"></div></div><div style="margin-top:4px;font-size:11px;color:var(--muted)">cron err: ${r.cronErrors} · ctx80+: ${r.highCtx} · ctx60+: ${r.warnCtx}</div></div>`;
    }).join('') || `<div style="font-size:12px;color:var(--muted)">${t('noItems')}</div>`;
  } catch (err) {
    box.innerHTML = `<div style="font-size:12px;color:var(--red)">${L==='en'?'Health score error':'Ошибка health-score'}: ${esc(err.message)}</div>`;
  }
}

async function loadIncidentCenter(silent=false) {
  const box = $('#incidentList');
  if (!box) return;
  if (!silent && !S.loaded['#incidentList']) withSkel('#incidentList', skelRow(3,'34px'));
  try {
    const ai = await api('ai/fix/list', 12000).catch(() => ({ items: [] }));
    const aiItems = (ai.items || []).slice(0, 8).map(op => ({
      kind: 'ai-op',
      ts: op.updatedAtMs || op.createdAtMs || Date.now(),
      source: L === 'en' ? 'AI-fix' : 'ИИ-фикс',
      title: op.title || (L === 'en' ? 'AI operation' : 'ИИ-операция'),
      details: op.status === 'running'
        ? (L === 'en' ? 'running…' : 'выполняется…')
        : op.status === 'done'
          ? (L === 'en' ? 'completed' : 'выполнено')
          : `${L === 'en' ? 'error' : 'ошибка'}: ${op.error || (L === 'en' ? 'unknown' : 'неизвестно')}`,
      status: op.status === 'running' ? 'info' : op.status === 'done' ? 'ok' : 'warn',
    }));

    const now = Date.now();
    const alertItems = (S.alerts || []).slice(0, 6).map((a, idx) => ({
      kind: 'alert',
      ts: now - idx * 1000,
      source: L === 'en' ? 'Alert' : 'Алерт',
      title: ruText(a.title),
      details: ruText(a.details || a.impact || ''),
      status: a.severity === 'critical' ? 'risk' : a.severity === 'warning' ? 'warn' : a.severity === 'ok' ? 'ok' : 'info',
    }));

    const merged = [...aiItems, ...alertItems]
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 10);

    const statusLabel = (status) => {
      if (L === 'en') {
        if (status === 'ok') return 'ok';
        if (status === 'warn') return 'warning';
        if (status === 'risk') return 'critical';
        return 'info';
      }
      if (status === 'ok') return 'ок';
      if (status === 'warn') return 'предупреждение';
      if (status === 'risk') return 'критично';
      return 'инфо';
    };

    box.innerHTML = merged.map(x => {
      const color = x.status === 'ok'
        ? 'var(--green)'
        : x.status === 'warn'
          ? 'var(--amber)'
          : x.status === 'risk'
            ? 'var(--red)'
            : 'var(--blue)';
      const tm = x.ts ? new Date(x.ts).toLocaleTimeString() : '';
      return `<div style="padding:9px;border:1px solid var(--border);border-left:3px solid ${color};border-radius:8px;margin-bottom:8px;background:var(--surface)"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div style="min-width:0"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="pill" style="background:var(--bg);color:var(--muted);border:1px solid var(--border)">${esc(x.source || '')}</span><span class="pill" style="background:${color};color:#fff">${esc(statusLabel(x.status))}</span></div><div style="font-size:13px;font-weight:600;margin-top:4px;word-break:break-word">${esc(x.title || '')}</div></div>${tm ? `<span style="font-size:10px;color:var(--muted);flex-shrink:0">${esc(tm)}</span>` : ''}</div><div style="font-size:12px;color:var(--muted);margin-top:4px;word-break:break-word">${esc(x.details || '')}</div></div>`;
    }).join('') || `<div class="incident-empty">${L==='en'?'No active incidents':'Нет активных инцидентов'}<div class="incident-empty-sub">${L==='en'?'Everything looks stable right now.':'Сейчас всё стабильно — наблюдаем дальше.'}</div></div>`;
  } catch (err) {
    box.innerHTML = `<div style="font-size:12px;color:var(--red)">${L==='en'?'Incident center error':'Ошибка инцидент-центра'}: ${esc(err.message)}</div>`;
  }
}

const STEP_MAP = {
  ru: {
    queued: 'в очереди', prepare: 'подготовка', diagnostics: 'диагностика',
    applying: 'применение фикса', verification: 'проверка', completed: 'завершено', failed: 'ошибка',
    'tg-reading': 'читает контекст', 'tg-thinking': 'формирует ответ',
    'tg-responding': 'отправляет ответ', 'tg-waiting': 'ожидает новое сообщение',
    'tg-finished': 'недавно завершено', 'subagent-running': 'выполняет подзадачу',
    'subagent-finished': 'подзадача завершена',
  },
  en: {
    queued: 'queued', prepare: 'preparing', diagnostics: 'diagnostics',
    applying: 'applying fix', verification: 'verifying', completed: 'completed', failed: 'failed',
    'tg-reading': 'reading context', 'tg-thinking': 'thinking',
    'tg-responding': 'responding', 'tg-waiting': 'waiting for message',
    'tg-finished': 'recently finished', 'subagent-running': 'running subtask',
    'subagent-finished': 'subtask done',
  }
};

function taskStepRu(step) {
  const map = STEP_MAP[L] || STEP_MAP.ru;
  return map[String(step || '').toLowerCase()] || (step || '—');
}

function taskStatusRu(status) {
  if (L === 'en') {
    if (status === 'running') return 'running';
    if (status === 'done') return 'done';
    if (status === 'error') return 'error';
    return status || '—';
  }
  if (status === 'running') return 'в работе';
  if (status === 'done') return 'готово';
  if (status === 'error') return 'ошибка';
  return status || '—';
}

function taskEtaLabel(task) {
  const eta_lbl = L === 'en' ? 'ETA' : 'ETA';
  if (task.status !== 'running') return `${eta_lbl}: —`;
  const eta = Number(task.etaMs || 0);
  if (!Number.isFinite(eta) || eta <= 0) return `${eta_lbl}: <1${L==='en'?'m':'м'}`;
  const m = Math.ceil(eta / 60000);
  if (m < 60) return `${eta_lbl}: ~${m}${L==='en'?'m':'м'}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${eta_lbl}: ~${h}${L==='en'?'h':'ч'} ${mm}${L==='en'?'m':'м'}`;
}

function taskProgressColor(task) {
  if (task.status === 'done') return 'var(--green)';
  if (task.status === 'error') return 'var(--red)';
  const p = Number(task.progressPercent || 0);
  if (p >= 80) return 'var(--amber)';
  return 'var(--blue)';
}

function taskTypeRu(taskType) {
  const tp = String(taskType || '').toLowerCase();
  if (tp === 'ai-fix') return L === 'en' ? 'AI-fix' : 'ИИ-фикс';
  if (tp === 'telegram-live') return 'Telegram live';
  if (tp === 'subagent-live') return 'Sub-agent live';
  return taskType || 'task';
}

function renderTaskEvents(events = []) {
  const items = (events || []).slice(-4).reverse();
  if (!items.length) return `<div class="task-log-empty">${L==='en'?'No events yet':'Событий пока нет'}</div>`;
  return items.map(ev => {
    const tm = ev.ts ? new Date(ev.ts).toLocaleTimeString() : '—';
    return `<div class="task-log-row"><span class="task-log-time">${esc(tm)}</span><span class="task-log-text">${esc(ev.text || '')}</span></div>`;
  }).join('');
}

async function loadActiveTasks(silent=false) {
  const box = $('#activeTasksList');
  if (!box) return;
  if (!silent && !S.loaded['#activeTasksList']) withSkel('#activeTasksList', skelRow(2,'64px'));
  try {
    const d = await api('tasks/active', 12000);
    const tasks = d.items || [];
    S.activeTasks = tasks;

    if (!tasks.length) {
      box.innerHTML = `<div class="task-empty">${t('taskEmpty')}</div>`;
      return;
    }

    box.innerHTML = tasks.map(task => {
      const pct = Math.max(0, Math.min(100, Number(task.progressPercent || 0)));
      const color = taskProgressColor(task);
      const badgeCls = task.status === 'done' ? 'pill-green' : task.status === 'error' ? 'pill-red' : 'pill-blue';
      const controls = task.controls || {};
      const subBtns = (task.taskType === 'subagent-live' || task.taskType === 'telegram-live') && task.sessionKey
        ? [
          controls.canSteer !== false ? `<button class="btn btn-sm btn-ghost" data-action="subagent-steer" data-key="${esc(task.sessionKey)}" data-sid="${esc(task.sessionId||'')}">🎛 ${t('steer')}</button>` : '',
          controls.canKill !== false ? `<button class="btn btn-sm btn-danger" data-action="subagent-kill" data-key="${esc(task.sessionKey)}">💀 ${t('kill')}</button>` : '',
          controls.canRetry !== false ? `<button class="btn btn-sm btn-ghost" data-action="subagent-retry" data-key="${esc(task.sessionKey)}" data-sid="${esc(task.sessionId||'')}">🔄 ${t('retry')}</button>` : '',
        ].filter(Boolean).join('')
        : '';
      return `<div class="task-card" data-task-id="${esc(task.id)}"><div class="task-head"><div class="task-title">${esc(task.title || (L==='en'?'Task':'Задача'))}</div><span class="pill ${badgeCls}">${esc(taskStatusRu(task.status))}</span></div><div class="task-meta">${esc(taskTypeRu(task.taskType))} · ${L==='en'?'step':'этап'}: ${esc(taskStepRu(task.step))} · ${esc(taskEtaLabel(task))}</div><div class="task-progress"><div class="task-progress-fill" style="width:${pct}%;background:${color}"></div></div><div class="task-progress-label">${pct}%</div><div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap"><button class="btn btn-sm btn-ghost" data-action="task-replay" data-task-id="${esc(task.id)}">📜 Replay</button>${subBtns}</div><div class="task-log">${renderTaskEvents(task.events || [])}</div></div>`;
    }).join('');
  } catch (err) {
    box.innerHTML = `<div class="task-empty" style="color:var(--red)">${L==='en'?'Task load error':'Ошибка загрузки задач'}: ${esc(err.message)}</div>`;
  }
}

/* ══ Operator Now ════════════════════════════════════════════════════ */
const LEVEL_COLORS = { ok:'var(--green)', info:'var(--blue)', warn:'var(--amber)', warning:'var(--amber)', error:'var(--red)' };
const LEVEL_ICONS  = { ok:'✅', info:'ℹ️', warn:'⚠️', warning:'⚠️', error:'❌', triage:'🏷', 'ai-fix':'🤖', 'cron':'⏱', 'subagent-control':'🎛', 'operator-note':'📝', update:'🔄' };

function kindIcon(kind, level) { return LEVEL_ICONS[kind] || LEVEL_ICONS[level] || '•'; }
function levelColor(level) { return LEVEL_COLORS[String(level||'info').toLowerCase()] || 'var(--muted)'; }

function renderOperatorEvent(ev) {
  const icon = kindIcon(ev.kind, ev.level);
  const tm = ev.ts ? new Date(ev.ts).toLocaleTimeString() : '—';
  const color = levelColor(ev.level);
  return `<div class="task-log-row" style="align-items:flex-start;margin-bottom:6px;padding:5px 7px;border-radius:6px;background:var(--bg)">
    <span style="font-size:14px;flex-shrink:0">${icon}</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:600;color:var(--text)">${esc(ev.title || ev.kind || '—')}</div>
      ${ev.details ? `<div style="font-size:11px;color:var(--muted);margin-top:1px">${esc(ev.details)}</div>` : ''}
      ${ev.actor && ev.actor !== 'system' ? `<div style="font-size:10px;color:var(--muted-2)">by ${esc(ev.actor)}</div>` : ''}
    </div>
    <span style="font-size:10px;color:${color};flex-shrink:0;margin-top:2px">${tm}</span>
  </div>`;
}

async function loadOperatorNow(silent=false) {
  const box = $('#operatorNowList');
  if (!box) return;
  if (!silent && !S.loaded['#operatorNowList']) withSkel('#operatorNowList', skelRow(3,'34px'));
  try {
    const d = await api('operator/now', 15000);
    const recent = (d.recent || []).slice(0, 8);
    box.innerHTML = recent.length
      ? recent.map(renderOperatorEvent).join('')
      : `<div class="task-empty">${t('noEvents')}</div>`;
    S.loaded['#operatorNowList'] = true;
  } catch (err) {
    box.innerHTML = `<div class="task-empty" style="color:var(--red)">${t('error')}: ${esc(err.message)}</div>`;
  }
}

async function loadWeeklyReview(silent=false) {
  const box = $('#weeklyReviewBox');
  if (!box) return;
  if (!silent && !S.loaded['#weeklyReviewBox']) withSkel('#weeklyReviewBox', skelRow(2,'28px'));
  try {
    const d = await api('review/weekly', 12000);
    const triage = d.triage || {};
    const total = d.eventsTotal || 0;
    const errCount = (d.byLevel || {}).error || 0;

    const labels = L === 'en'
      ? { events: 'Events (7d)', errors: 'Errors', new: 'New', resolved: 'Resolved', solving: 'Solving', ignored: 'Ignored' }
      : { events: 'События (7д)', errors: 'Ошибки', new: 'Новые', resolved: 'Решено', solving: 'В работе', ignored: 'Игнор' };

    box.innerHTML = `
      <div class="weekly-review-grid">
        <div class="weekly-review-item"><div class="k">📊 ${labels.events}</div><div class="v">${total}</div></div>
        <div class="weekly-review-item ${errCount > 0 ? 'tone-red' : 'tone-green'}"><div class="k">❌ ${labels.errors}</div><div class="v">${errCount}</div></div>
        <div class="weekly-review-item"><div class="k">🆕 ${labels.new}</div><div class="v">${triage.new || 0}</div></div>
        <div class="weekly-review-item tone-green"><div class="k">✅ ${labels.resolved}</div><div class="v">${triage.resolved || 0}</div></div>
        <div class="weekly-review-item tone-amber"><div class="k">🔍 ${labels.solving}</div><div class="v">${triage.investigating || 0}</div></div>
        <div class="weekly-review-item"><div class="k">🙈 ${labels.ignored}</div><div class="v">${triage.ignored || 0}</div></div>
      </div>`;
    S.loaded['#weeklyReviewBox'] = true;
  } catch (err) {
    if (box) box.innerHTML = `<div class="task-empty" style="color:var(--red)">${t('error')}: ${esc(err.message)}</div>`;
  }
}

/* ══ Triage ══════════════════════════════════════════════════════════ */
const TRIAGE_STATUSES = ['new','ack','investigating','resolved','ignored'];
const TRIAGE_LABELS = { new:'🆕', ack:'👀 ack', investigating:'🔍 solving', resolved:'✅ ok', ignored:'🙈' };

function triageKey(a) { return String(a?.key || ''); }

function triagePill(triage) {
  if (!triage) return '';
  const st = triage.status || 'new';
  const colors = { new:'var(--muted)', ack:'var(--blue)', investigating:'var(--amber)', resolved:'var(--green)', ignored:'var(--muted-2)' };
  return `<span style="font-size:10px;font-weight:700;color:${colors[st]||'var(--muted)'};border:1px solid ${colors[st]||'var(--border)'};padding:1px 5px;border-radius:999px">${TRIAGE_LABELS[st]||st}</span>`;
}

async function setTriageForItem(kind, itemKey, status) {
  try {
    await post('triage', { kind, key: itemKey, status });
    toast(`Triage: ${status}`);
    if (kind === 'alert') loadAlerts(true);
    else loadIntel(true);
    loadWeeklyReview(true);
  } catch (err) {
    toast(err.message || (L==='en'?'Triage error':'Ошибка triage'), 'err');
  }
}

function renderTriageActions(kind, key, currentTriage) {
  const cur = currentTriage?.status || 'new';
  const next = TRIAGE_STATUSES.filter(s => s !== cur).slice(0, 3);
  return next.map(s =>
    `<button class="btn btn-sm btn-ghost" data-action="triage-set" data-triage-kind="${esc(kind)}" data-triage-key="${esc(key)}" data-triage-status="${esc(s)}">${TRIAGE_LABELS[s]||s}</button>`
  ).join('');
}

/* ══ Sub-agent controls ══════════════════════════════════════════════ */
async function subagentControl(action, sessionKey, sessionId, message) {
  try {
    const r = await post('subagent/control', { action, key: sessionKey, sessionId, message }, 90000);
    toast(`${action}: ${r.ok ? 'ok' : 'fail'}`);
    loadActiveTasks(true);
  } catch (err) {
    toast(err.message || (L==='en'?'Sub-agent control error':'Ошибка управления sub-agent'), 'err');
  }
}

async function showTaskReplay(taskId) {
  const panel = $('#taskReplayPanel');
  const title = $('#taskReplayTitle');
  const body = $('#taskReplayContent');
  if (!panel || !title || !body) return;

  panel.classList.remove('hidden');
  body.textContent = t('loading');

  try {
    const d = await api('tasks/replay?id=' + encodeURIComponent(taskId), 12000);
    title.textContent = `История этапов: ${d.title || taskId}`;
    const events = (d.events || []).slice().sort((a,b)=>(a.ts||0)-(b.ts||0));
    body.textContent = events.length
      ? events.map(ev => `[${new Date(ev.ts || Date.now()).toLocaleString()}] ${ev.level || 'info'} · ${ev.text || ''}`).join('\n')
      : 'Событий нет';
  } catch (err) {
    body.textContent = `${t('error')}: ${err.message || (L==='en' ? 'failed to load replay' : 'не удалось загрузить replay')}`;
  }
}

async function onActiveTaskAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'task-replay') {
    showTaskReplay(btn.dataset.taskId);
    return;
  }

  if (action === 'subagent-kill') {
    if (!confirm('Kill this session?')) return;
    btn.disabled = true;
    await subagentControl('kill', btn.dataset.key, null, null);
    btn.disabled = false;
    return;
  }

  if (action === 'subagent-steer') {
    const msg = prompt('Message to steer the agent:');
    if (!msg) return;
    btn.disabled = true;
    await subagentControl('steer', btn.dataset.key, btn.dataset.sid || null, msg);
    btn.disabled = false;
    return;
  }

  if (action === 'subagent-retry') {
    btn.disabled = true;
    await subagentControl('retry', btn.dataset.key, btn.dataset.sid || null, null);
    btn.disabled = false;
    return;
  }
}

async function loadUpdateState() {
  const btn = $('#updateBtn');
  if (!btn) return;
  try {
    const d = await api('update/check', 12000);
    S.update = d;
    if (d.available) {
      btn.classList.remove('hidden');
      btn.textContent = `${t('update')} (${d.latest})`;
      btn.disabled = false;
      btn.title = L==='en'?`Current ${d.current}, available ${d.latest}`:`Текущая ${d.current}, доступна ${d.latest}`;
    } else {
      btn.classList.add('hidden');
    }
  } catch {
    btn.classList.add('hidden');
  }
}

async function runOpenclawUpdate() {
  const d = S.update || await api('update/check', 12000);
  if (!d?.available) {
    toast(L==='en'?'Already up to date':'Уже актуальная версия');
    return;
  }
  const ok = confirm(L==='en'?`Update OpenClaw from ${d.current} to ${d.latest}?\n\nService will restart.`:`Обновить OpenClaw с ${d.current} до ${d.latest}?\n\nСервис будет перезапущен.`);
  if (!ok) return;
  try {
    const btn = $('#updateBtn');
    if (btn) btn.disabled = true;
    const r = await post('update/run', {}, 200000);
    if (r?.started) {
      toast(L==='en'?'Update started. Service may restart.':'Обновление запущено. Сервис может перезапуститься.', 'warn');
    } else if (r?.skipped) {
      const reason = r?.reason || 'skipped';
      const hint = r?.doctorHint ? ` (${r.doctorHint})` : '';
      toast((L==='en'?'Update skipped: ':'Обновление пропущено: ') + reason + hint, 'warn');
    } else {
      toast(r?.message || (L==='en'?'Already up to date':'Уже актуальная версия'));
    }
    await loadUpdateState();
  } catch (err) {
    toast(err.message || (L==='en'?'Failed to start update':'Не удалось запустить обновление'), 'err');
  } finally {
    const btn = $('#updateBtn');
    if (btn) btn.disabled = false;
  }
}

function buildExecutiveReportText() {
  const now = new Date();
  const summary = S.summary;
  const alerts = S.alerts || [];
  const intel = S.intel || { recommendations: [] };
  const health = S.healthRows || [];
  const usage = S.usage || { providers: [] };
  const activeTasks = S.activeTasks || [];

  const topAlerts = alerts.slice(0, 4).map(a => `- ${ruText(a.title)}: ${ruText(a.details)}`).join('\n') || '- Нет критичных сигналов';
  const topRecs = (intel.recommendations || []).slice(0, 4).map(r => `- ${ruText(r.title)}`).join('\n') || '- Нет срочных рекомендаций';
  const healthLine = health.map(h => `${h.agentId}:${h.score}`).join(' | ') || 'нет данных';
  const activeTaskLines = activeTasks.slice(0, 5).map(t => `- ${t.title}: ${taskStatusRu(t.status)}, этап ${taskStepRu(t.step)}, ${Math.max(0, Math.min(100, Number(t.progressPercent || 0)))}%`);

  const usageRows = [];
  for (const p of (usage.providers || [])) {
    if (p.error) {
      usageRows.push(`- ${p.displayName || p.provider}: ${normalizeUsageError(p.provider, p.error)}`);
      continue;
    }
    for (const w of (p.windows || [])) {
      const used = Number(w.usedPercent || 0);
      const left = Number(w.remainingPercent ?? Math.max(0, 100 - used));
      usageRows.push(`- ${p.displayName || p.provider} / ${w.label}: осталось ${left}% (использовано ${used}%)`);
    }
  }

  return [
    `Отчёт по Ops (${now.toLocaleString()})`,
    '',
    `Система: версия ${summary?.app?.version || 'unknown'}, активных сессий ${summary?.openclaw?.activeSessions ?? '-'}, активных задач ${summary?.openclaw?.enabledCrons ?? '-'}`,
    `Security: warn=${summary?.openclaw?.securityWarn ?? '-'}, critical=${summary?.openclaw?.securityCritical ?? '-'}`,
    '',
    'Лимиты и usage:',
    usageRows.join('\n') || '- Нет данных по usage',
    '',
    'Активные задачи:',
    activeTaskLines.join('\n') || '- Активных задач нет',
    '',
    'Что сломалось / риски:',
    topAlerts,
    '',
    'Что делаем:',
    topRecs,
    '',
    `Health-score агентов: ${healthLine}`,
    '',
    'Следующий шаг: приоритетно закрыть security warning + стабилизировать падающие cron.'
  ].join('\n');
}

function bindReportActions() {
  const buildBtn = $('#buildReportBtn');
  const copyBtn = $('#copyReportBtn');
  const preview = $('#reportPreview');
  if (!buildBtn || !copyBtn || !preview) return;

  buildBtn.onclick = async () => {
    await loadActiveTasks(true);
    await loadUsageGuard(true);
    await loadHealthScore(true);
    await loadIncidentCenter(true);
    const text = buildExecutiveReportText();
    S.reportText = text;
    preview.textContent = text;
    toast(L === 'en' ? 'Report ready' : 'Отчёт собран');
  };

  copyBtn.onclick = async () => {
    const text = S.reportText || preview.textContent || '';
    const emptyMsg = t('reportNotBuilt');
    if (!text || text === 'Отчёт ещё не собран' || text === 'Report not built yet') {
      toast(L === 'en' ? 'Build the report first' : 'Сначала собери отчёт', 'warn');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast(t('reportReady'));
    } catch {
      toast(L === 'en' ? 'Copy failed' : 'Не удалось скопировать', 'err');
    }
  };
}

/* Фоновое обновление — без скелетонов */
function refreshAll() { loadStats(true); loadAgentRow(true); loadAlerts(true); loadIntel(true); loadIncidentCenter(true); loadActiveTasks(true); loadWeeklyReview(true); loadUsageGuard(true); loadHealthScore(true); loadUpdateState(); loadHeatmap(true); }

function setOpStatusText(container, text, cls='') {
  const el = container?.querySelector('.alert-op-status');
  if (!el) return;
  el.classList.remove('hidden');
  el.style.color = cls === 'err' ? 'var(--red)' : cls === 'ok' ? 'var(--green)' : 'var(--muted)';
  el.textContent = text;
}

async function pollAiFixOperation(opId, container) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8 * 60 * 1000) {
    try {
      const s = await api('ai/fix/status?id=' + encodeURIComponent(opId), 12000);
      const op = s?.op;
      if (!op) return;
      if (op.status === 'running') {
        setOpStatusText(container, `🤖 ${L==='en'?'AI agent running…':'ИИ-агент работает…'} (${new Date(op.createdAtMs).toLocaleTimeString()})`);
        loadActiveTasks(true);
      } else if (op.status === 'done') {
        const tail = op.resultText ? String(op.resultText).slice(-260).replace(/\s+/g, ' ') : 'готово';
        setOpStatusText(container, `✅ ${L==='en'?'Fix done':'Исправление завершено'}: ${tail}`, 'ok');
        refreshAll();
        loadCrons(true);
        loadSessions(true);
        loadActiveTasks(true);
        return;
      } else if (op.status === 'error') {
        setOpStatusText(container, `❌ ${L==='en'?'Error':'Ошибка'}: ${op.error || (L==='en'?'failed':'не удалось выполнить')}`, 'err');
        loadActiveTasks(true);
        return;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 2500));
  }
  setOpStatusText(container, L==='en'?'⏱ Still running, refresh later.':'⏱ Операция ещё выполняется, обнови страницу позже.', '');
}

async function startAiFix(payload, container) {
  const title = payload?.item?.title || payload?.title || 'задачу';
  const approved = confirm(L==='en'?`Approve AI-fix?\n\n${title}\n\nAgent will perform safe actions automatically.`:`Подтвердить AI-fix?\n\n${title}\n\nАгент выполнит безопасные действия автоматически.`);
  if (!approved) throw new Error(L==='en'?'Cancelled by user':'Отменено пользователем');

  const res = await post('ai/fix/start', payload, 20000);
  const opId = res?.op?.id;
  if (!opId) throw new Error('op id missing');
  setOpStatusText(container, L==='en'?'🤖 Launching AI agent…':'🤖 Запускаю ИИ-агента…');
  pollAiFixOperation(opId, container);
}

async function onAlertAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const item = btn.closest('.alert-item');

  if (action === 'triage-set') {
    const btn2 = e.target.closest('[data-triage-kind]');
    if (btn2) {
      await setTriageForItem(btn2.dataset.triageKind, btn2.dataset.triageKey, btn2.dataset.triageStatus);
    }
    return;
  }

  if (action === 'alert-dismiss') {
    const k = item?.dataset.alertKey;
    if (k) {
      S.dismissed.alerts[k] = Date.now();
      saveDismissed('alerts');
      loadAlerts(true);
    }
    return;
  }

  if (action === 'alert-explain') {
    const why = item?.querySelector('.alert-why');
    if (!why) return;
    why.classList.toggle('hidden');
    return;
  }

  if (action === 'alert-ai-fix') {
    const idx = Number(item?.dataset.alertIdx ?? -1);
    const alert = (S.alerts || [])[idx];
    if (!alert) return;
    try {
      btn.disabled = true;
      await startAiFix({ source: 'alert', item: alert }, item);
      toast(L==='en'?'AI fix started':'ИИ-исправление запущено');
    } catch (err) {
      if (!String(err?.message || '').match(/Отменено|Cancelled/)) {
        setOpStatusText(item, `❌ ${err.message || (L==='en'?'Failed to start AI fix':'Не удалось запустить ИИ-исправление')}`, 'err');
      }
    } finally {
      btn.disabled = false;
    }
    return;
  }

  const cronId = btn.dataset.cronId;
  if (!cronId) return;

  try {
    btn.disabled = true;
    if (action === 'alert-cron-history') {
      await showCronHistory(cronId);
    } else if (action === 'alert-cron-run') {
      await post('cron/run', { id: cronId });
      toast(L==='en'?'Cron started from alert ✓':'Cron запущен из алерта ✓');
      loadCrons(true);
      loadAlerts(true);
    } else if (action === 'alert-cron-disable') {
      await post('cron/toggle', { id: cronId, enabled: false });
      toast(L==='en'?'Cron disabled from alert':'Cron отключён из алерта');
      loadCrons(true);
      loadAlerts(true);
    }
  } catch (err) {
    toast(err.message || (L==='en'?'Alert action error':'Ошибка действия по алерту'), 'err');
  } finally {
    btn.disabled = false;
  }
}

async function onIntelAction(e) {
  const anyBtn = e.target.closest('[data-action]');
  if (!anyBtn) return;
  const item = anyBtn.closest('.alert-item');

  if (anyBtn.dataset.action === 'intel-dismiss') {
    const k = item?.dataset.intelKey;
    if (k) {
      S.dismissed.intel[k] = Date.now();
      saveDismissed('intel');
      loadIntel(true);
    }
    return;
  }

  const btn = e.target.closest('[data-action="intel-ai-fix"]');
  if (!btn) return;
  const kind = item?.dataset.intelKind;
  const idx = Number(item?.dataset.intelIdx ?? -1);
  const src = kind === 'prediction' ? (S.intel?.predictions || []) : (S.intel?.recommendations || []);
  const intelItem = src[idx];
  if (!intelItem) return;

  try {
    btn.disabled = true;
    await startAiFix({ source: kind || 'recommendation', item: intelItem }, item);
    toast(L==='en'?'AI fix started':'ИИ-исправление запущено');
  } catch (err) {
    if (!String(err?.message || '').match(/Отменено|Cancelled/)) {
      setOpStatusText(item, `❌ ${err.message || (L==='en'?'Failed to start AI fix':'Не удалось запустить ИИ-исправление')}`, 'err');
    }
  } finally {
    btn.disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   CRONS
══════════════════════════════════════════════════════════════════════ */
function isTelegramCron(job) {
  if (typeof job?.isTelegram === 'boolean') return job.isTelegram;
  const n = String(job?.name || '').toLowerCase();
  return /(^|\W)(telegram|tg)(\W|$)|канал|чат/.test(n);
}

function renderCronCard(j, canOp, canAdm) {
  const dot=!j.enabled?'var(--muted-2)':(j.consecutiveErrors>0||j.lastStatus==='error')?'var(--red)':j.lastStatus==='ok'?'var(--green)':'var(--amber)';
  const c=ac(j.agentId);
  const errB=j.consecutiveErrors>0?`<span class="pill pill-red">${j.consecutiveErrors} ${L==='en'?'errors':'ошибок'}</span>`:'';
  const stB=j.lastStatus==='ok'?'<span class="pill pill-green">OK</span>':j.lastStatus==='error'?`<span class="pill pill-red">${L==='en'?'Error':'Ошибка'}</span>`:`<span class="pill pill-muted">${esc(j.lastStatus||'—')}</span>`;
  const diff=j.nextRunAt?new Date(j.nextRunAt)-Date.now():null;
  const nxt=diff==null?'—':diff<0?(L==='en'?'now':'сейчас'):diff<3600000?(L==='en'?'in '+Math.floor(diff/60000)+'m':'через '+Math.floor(diff/60000)+' мин'):(L==='en'?'in '+Math.floor(diff/3600000)+'h '+Math.floor((diff%3600000)/60000)+'m':'через '+Math.floor(diff/3600000)+'ч '+Math.floor((diff%3600000)/60000)+'м');
  const disabledPill=j.enabled?'':`<span class="pill pill-muted">${L==='en'?'Disabled':'Отключён'}</span>`;
  const costBadge=`<span class="pill pill-muted" id="cron-cost-${esc(j.id)}" style="font-size:10px">...</span>`;
  const nextLbl=L==='en'?'Next':'Следующий', lastLbl=L==='en'?'Last':'Последний';
  return `<div class="cron-card" data-id="${esc(j.id)}" data-enabled="${j.enabled?'1':'0'}">
    <div class="cron-head">
      <div class="cron-status" style="background:${dot}"></div>
      <div class="cron-name">${esc(j.name)}</div>
      <span class="pill" style="background:${c.bg};color:${c.text};font-size:10px">${esc(j.agentId)}</span>
      ${errB}${stB}${disabledPill}${costBadge}
    </div>
    <div class="cron-meta">${nextLbl}: ${nxt} · ${lastLbl}: ${j.lastRunAt?new Date(j.lastRunAt).toLocaleString():'—'}</div>
    <div class="cron-actions">
      <button class="btn btn-sm btn-success" data-action="run" ${canOp?'':'disabled'}>▶ ${t('runHistory')}</button>
      <button class="btn btn-sm btn-ghost" data-action="toggle" ${canOp?'':'disabled'}>${j.enabled?`⏸ ${t('disable')}`:`▶ ${t('enable')}`}</button>
      <button class="btn btn-sm btn-ghost" data-action="history">📋 ${t('history')}</button>
      <button class="btn btn-sm btn-ghost" data-action="dry">🧪 Dry-run</button>
      <button class="btn btn-sm btn-ghost" data-action="edit" ${canOp?'':'disabled'}>${t('editCron')}</button>
      <button class="btn btn-sm btn-danger" data-action="delete" ${canAdm?'':'disabled'}>🗑 ${L==='en'?'Delete':'Удалить'}</button>
    </div>
  </div>`;
}

function renderCronSection(title, jobs, canOp, canAdm) {
  if (!jobs.length) return '';
  return `<div style="margin:10px 0 6px;font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">${esc(title)} (${jobs.length})</div>` +
    jobs.map(j => renderCronCard(j, canOp, canAdm)).join('');
}

async function loadCrons(silent=false) {
  if (!silent) withSkel('#cronList', skelRow(3,'80px'));
  try {
    const aid=$('#cronAgentFilter').value||'all';
    const d=await api('crons?agentId='+encodeURIComponent(aid));
    S.lastCrons = d.jobs || [];
    const canOp=['operator','admin'].includes(S.me.role), canAdm=S.me.role==='admin';
    const tg = d.jobs.filter(isTelegramCron);
    const other = d.jobs.filter(j => !isTelegramCron(j));
    const html =
      renderCronSection(t('telegramCrons'), tg, canOp, canAdm) +
      renderCronSection(t('otherCrons'), other, canOp, canAdm);
    $('#cronList').innerHTML = html || `<div style="padding:16px;color:var(--muted);text-align:center">${L==='en'?'No jobs':'Нет задач'}</div>`;
    // Load cost badges asynchronously
    setTimeout(() => loadCronCosts(d.jobs || []), 100);
  } catch(err) { $('#cronList').innerHTML=`<div style="color:var(--red);padding:12px">${t('error')}: ${esc(err.message)}</div>`; }
}

async function loadCronCosts(jobs) {
  await Promise.allSettled(jobs.map(async j => {
    try {
      const d = await api(`cron/cost?id=${encodeURIComponent(j.id)}`);
      const el = $(`#cron-cost-${j.id.replace(/[^a-zA-Z0-9-]/g, '-')}`);
      if (!el) return;

      const runs = Number(d.runs7d || 0);
      const totalTokens = Number(d.totalTokens || ((Number(d.inputTokens || 0) + Number(d.outputTokens || 0))));
      if (!runs || !totalTokens) {
        el.textContent = '7d: --';
        return;
      }

      const fmt = totalTokens >= 1_000_000
        ? `${(totalTokens / 1_000_000).toFixed(2)}M`
        : totalTokens >= 1_000
          ? `${(totalTokens / 1_000).toFixed(1)}k`
          : String(totalTokens);
      el.textContent = `7d: ${runs}x · ${fmt} tok`;
      el.style.background = 'var(--blue-soft, rgba(59,130,246,0.12))';
      el.style.color = 'var(--blue, #3b82f6)';
    } catch {}
  }));
}

function openCronEditModal(id, job) {
  const modal = $('#cronEditModal');
  if (!modal) return;
  $('#cronEditId').value = id;
  // Pre-fill fields from job data
  const sched = job?.schedule;
  if (sched?.kind === 'every') {
    $('#cronEditSched').value = String(sched.everyMs || '');
  } else if (sched?.kind === 'cron') {
    $('#cronEditSched').value = sched.expr || '';
  } else {
    $('#cronEditSched').value = '';
  }
  const msg = job?.payload?.message || '';
  $('#cronEditMsg').value = msg;
  const timeout = job?.payload?.timeoutSeconds ? job.payload.timeoutSeconds * 1000 : (job?.timeout || '');
  $('#cronEditTimeout').value = timeout || '';
  $('#cronEditSessionTarget').value = job?.sessionTarget || 'isolated';
  $('#cronEditDelivery').value = job?.delivery?.mode || 'announce';
  // Update i18n labels
  if ($('#cronEditTitle')) $('#cronEditTitle').textContent = t('cronEditTitle') + ' · ' + (job?.name || id);
  if ($('#cronEditSchedLabel')) $('#cronEditSchedLabel').textContent = t('cronEditSchedLabel');
  if ($('#cronEditMsgLabel')) $('#cronEditMsgLabel').textContent = t('cronEditMsgLabel');
  if ($('#cronEditTimeoutLabel')) $('#cronEditTimeoutLabel').textContent = t('cronEditTimeoutLabel');
  if ($('#cronEditSessionLabel')) $('#cronEditSessionLabel').textContent = t('cronEditSessionLabel');
  if ($('#cronEditDeliveryLabel')) $('#cronEditDeliveryLabel').textContent = t('cronEditDeliveryLabel');
  if ($('#saveCronEdit')) $('#saveCronEdit').textContent = t('saveCron');
  if ($('#cancelCronEdit')) $('#cancelCronEdit').textContent = t('cancelEdit');
  modal.classList.remove('hidden');
}

async function saveCronEdit() {
  const id = $('#cronEditId').value;
  if (!id) return;
  const schedRaw = ($('#cronEditSched').value || '').trim();
  let schedule;
  if (schedRaw) {
    if (/^\d+$/.test(schedRaw)) {
      schedule = { kind: 'every', everyMs: Number(schedRaw) };
    } else if (schedRaw.split(' ').length >= 5) {
      schedule = { kind: 'cron', expr: schedRaw };
    }
  }
  const patch = {};
  if (schedule) patch.schedule = schedule;
  const msg = ($('#cronEditMsg').value || '').trim();
  if (msg) patch.payloadMessage = msg;
  const to = Number($('#cronEditTimeout').value || 0);
  if (to > 0) patch.timeout = to;
  patch.sessionTarget = $('#cronEditSessionTarget').value;
  patch.deliveryMode = $('#cronEditDelivery').value;

  const btn = $('#saveCronEdit');
  btn.disabled = true;
  btn.textContent = t('loading');
  try {
    await post('cron/update', { id, ...patch });
    toast(L==='en' ? 'Cron updated ✓' : 'Задача обновлена ✓');
    $('#cronEditModal').classList.add('hidden');
    await loadCrons(true);
  } catch (err) {
    toast(err.message || (L==='en' ? 'Update failed' : 'Ошибка обновления'), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = t('saveCron');
  }
}

async function showCronHistory(id) {
  $('#cronHistoryContent').textContent=t('loading');
  $('#cronHistoryPanel').classList.remove('hidden');
  try {
    const h=await api('cron/runs?id='+encodeURIComponent(id)+'&limit=8');
    $('#cronHistoryContent').textContent=(h.entries||[]).length
      ?(h.entries||[]).map(x=>'['+new Date(x.ts).toLocaleString()+'] '+x.status+' · '+(x.durationMs||0)+(L==='en'?'ms':'мс')+'\n'+(x.summary||'')).join('\n\n────\n\n')
      :(L==='en'?'No history yet':'История пуста');
  } catch(err) { $('#cronHistoryContent').textContent=`${t('error')}: ${err.message}`; }
}

async function onCronClick(e) {
  const btn=e.target.closest('[data-action]'); if(!btn) return;
  const card=btn.closest('[data-id]'), id=card&&card.dataset.id, action=btn.dataset.action; if(!id) return;

  if (action==='history') {
    await showCronHistory(id);
    return;
  }

  if (action==='edit') {
    const job = (S.lastCrons || []).find(j => j.id === id);
    openCronEditModal(id, job);
    return;
  }

  if (action==='dry') {
    try {
      const h=await api('cron/runs?id='+encodeURIComponent(id)+'&limit=1');
      const last=(h.entries||[])[0];
      const txt = last
        ? (L==='en'
          ? `Dry-run (no execution):\nLast result: ${last.status}\nDuration: ${last.durationMs||0}ms\n\nSummary:\n${last.summary||'—'}`
          : `Dry-run (без выполнения):\nПоследний результат: ${last.status}\nДлительность: ${last.durationMs||0}мс\n\nSummary:\n${last.summary||'—'}`)
        : (L==='en' ? 'Dry-run: no run history.\nJob has never executed.' : 'Dry-run: истории запусков нет.\nЗадача не запускалась.');
      $('#cronHistoryContent').textContent = txt;
      $('#cronHistoryPanel').classList.remove('hidden');
    } catch (err) {
      toast(err.message || (L==='en' ? 'Dry-run failed' : 'Dry-run не удался'), 'err');
    }
    return;
  }

  try {
    btn.disabled=true;
    const enabled=card.dataset.enabled==='1';
    if (action==='run') { if(!confirm(L==='en'?'Run this cron now?':'Запустить прямо сейчас?')) return; await post('cron/run',{id}); toast(L==='en'?'Cron started ✓':'Задача запущена ✓'); }
    else if (action==='toggle') { if(!confirm(enabled?(L==='en'?'Disable?':'Отключить?'):(L==='en'?'Enable?':'Включить?'))) return; await post('cron/toggle',{id,enabled:!enabled}); toast(enabled?(L==='en'?'Disabled':'Отключено'):(L==='en'?'Enabled ✓':'Включено ✓')); }
    else if (action==='delete') { if(!confirm(L==='en'?'Delete job permanently?':'Удалить задачу навсегда?')) return; await post('cron/delete',{id}); toast(L==='en'?'Job deleted':'Задача удалена'); }
    await loadCrons(true);
  } catch(err) { toast(err.message,'err'); }
  finally { btn.disabled=false; }
}

/* ══════════════════════════════════════════════════════════════════════
   SESSIONS
══════════════════════════════════════════════════════════════════════ */
function sessionType(key) {
  const k = String(key || '');
  if (k.includes(':telegram:')) return 'telegram';
  if (k.includes(':cron:')) return 'cron';
  return 'regular';
}

const MODEL_PRESETS = ['default','gpt-5.3-codex','sonnet','opus','claude-sonnet-4-6','claude-opus-4-6'];

function modelOptions(currentModel) {
  const list = Array.from(new Set([currentModel, ...MODEL_PRESETS].filter(Boolean)));
  return list.map(m => `<option value="${esc(m)}" ${m===currentModel?'selected':''}>${esc(m)}</option>`).join('');
}

function renderSessionGroup(label, items) {
  if (!items.length) return '';
  const canSetModel = ['operator','admin'].includes(S.me.role);
  const rows = items.map(s => {
    const pct=Number.isFinite(s.percentUsed)?s.percentUsed:null, fc=pct!=null?ctxColor(pct):'var(--muted-2)';
    const bar=pct!=null
      ?`<div style="display:flex;align-items:center;gap:6px"><div class="ctx-bar"><div class="ctx-fill" style="width:${pct}%;background:${fc}"></div></div><span style="font-size:11px;color:${fc}">${pct}%</span></div>`
      :'—';
    const c=ac(s.agentId);
    const modelControl = `<div style="display:flex;gap:6px;align-items:center">
      <select class="session-model-select" data-key="${esc(s.key)}" ${canSetModel?'':'disabled'}>${modelOptions(s.model)}</select>
      <button class="btn btn-sm btn-ghost" data-action="session-model-set" data-key="${esc(s.key)}" ${canSetModel?'':'disabled'}>${t('apply')}</button>
    </div>`;
    const viewBtn = `<button class="btn btn-sm btn-ghost" data-action="view-transcript" data-key="${esc(s.key)}" style="padding:2px 6px;font-size:11px" title="${t('viewTranscript')}">👁</button>`;
    return `<tr><td><span class="pill" style="background:${c.bg};color:${c.text}">${esc(s.agentId)}</span></td><td style="font-size:12px;color:var(--muted)" title="${esc(s.key)}">${esc(s.key.slice(0,50))}${s.key.length>50?'…':''} ${viewBtn}</td><td style="font-size:12px">${modelControl}</td><td>${esc(humanDur(s.ageMs))}</td><td>${bar}</td></tr>`;
  }).join('');
  return `<tr><td colspan="5" style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;background:var(--bg)">${esc(label)} (${items.length})</td></tr>` + rows;
}

async function loadSessions(silent=false) {
  if (!silent) withSkel('#sessionsTbody', `<tr><td colspan="5">${skelRow(3,'28px')}</td></tr>`);
  try {
    const aid=$('#sessionAgentFilter').value||'all', q=$('#sessionSearch').value||'';
    const d=await api('sessions?agentId='+encodeURIComponent(aid)+'&q='+encodeURIComponent(q));
    S.lastSessions = d.sessions || [];
    if (!d.sessions.length) { $('#sessionsTbody').innerHTML=`<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">${L==='en'?'No sessions':'Сессий нет'}</td></tr>`; return; }

    const telegram = d.sessions.filter(s => sessionType(s.key) === 'telegram');
    const regular = d.sessions.filter(s => sessionType(s.key) === 'regular');
    const cron = d.sessions.filter(s => sessionType(s.key) === 'cron');

    $('#sessionsTbody').innerHTML =
      renderSessionGroup(t('telegramSessions'), telegram) +
      renderSessionGroup(t('regularSessions'), regular) +
      renderSessionGroup(t('cronSessions'), cron);
  } catch(err) { $('#sessionsTbody').innerHTML=`<tr><td colspan="5" style="color:var(--red);padding:12px">${t('error')}: ${esc(err.message)}</td></tr>`; }
}

async function onSessionAction(e) {
  const viewBtn = e.target.closest('[data-action="view-transcript"]');
  if (viewBtn) {
    const key = viewBtn.dataset.key;
    if (key) await openTranscriptPanel(key);
    return;
  }

  const btn = e.target.closest('[data-action="session-model-set"]');
  if (!btn) return;
  const key = btn.dataset.key;
  const select = [...document.querySelectorAll('.session-model-select')].find(x => x.dataset.key === key);
  const model = select?.value;
  if (!key || !model) return;
  try {
    btn.disabled = true;
    const res = await post('session/model', { key, model }, 20000);
    const resolved = res?.resolved?.model;
    if (model !== 'default' && resolved && resolved !== model) {
      toast(L==='en'?`Model ${model} unavailable, active: ${resolved}`:`Модель ${model} недоступна, активна ${resolved}`, 'warn');
    } else {
      toast(L==='en'?`Session model updated: ${model}`:`Модель сессии обновлена: ${model}`);
    }
    await loadSessions(true);
    refreshAll();
  } catch (err) {
    toast(err.message || (L==='en'?'Failed to change model':'Не удалось сменить модель'), 'err');
  } finally {
    btn.disabled = false;
  }
}

async function openTranscriptPanel(sessionKey) {
  const panel = $('#transcriptPanel');
  const msgs = $('#transcriptMessages');
  const titleEl = $('#transcriptTitle');
  if (!panel || !msgs) return;
  panel.classList.remove('hidden');
  if (titleEl) titleEl.textContent = t('transcriptTitle') + ': ' + sessionKey.slice(0, 50);
  msgs.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px">${t('loading')}</div>`;
  try {
    const d = await api(`session/history?key=${encodeURIComponent(sessionKey)}&limit=40`);
    const messages = d.messages || [];
    if (!messages.length) {
      msgs.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:8px">${t('noHistory')}${d.errorNote ? ` (${esc(d.errorNote)})` : ''}</div>`;
      return;
    }
    msgs.innerHTML = messages.map(m => {
      const role = String(m.role || m.type || 'unknown').toLowerCase();
      const isUser = role === 'human' || role === 'user';
      const isTool = role.includes('tool') || !!m.tool_calls?.length || !!m.toolCallId;

      const normalizeContent = (value) => {
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) {
          return value.map(part => {
            if (typeof part === 'string') return part;
            if (part?.type === 'text') return part.text || '';
            if (part?.type === 'thinking') return `[thinking] ${part.thinking || ''}`;
            if (part?.type === 'toolCall') {
              const args = part.arguments ? JSON.stringify(part.arguments) : '';
              return `[toolCall:${part.name || 'tool'}] ${args}`;
            }
            return part?.text || part?.content || part?.name || part?.type || '';
          }).filter(Boolean).join('\n');
        }
        if (value && typeof value === 'object') {
          try { return JSON.stringify(value, null, 2); } catch { return String(value); }
        }
        return '';
      };

      const content = normalizeContent(m.content ?? m.text ?? '');
      const shortContent = content.length > 500 ? content.slice(0, 500) : content;
      const hasMore = content.length > 500;
      const ts = m.createdAt || m.timestamp || m.ts || '';
      const tsMs = Number(ts);
      const tsStr = ts
        ? new Date(Number.isFinite(tsMs) && tsMs > 0 ? tsMs : ts).toLocaleTimeString()
        : '';
      if (isTool) {
        const toolName = m.tool_calls?.[0]?.function?.name || m.toolName || m.name || 'tool';
        return `<details style="margin:2px 0;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px 8px"><summary style="font-size:11px;color:var(--muted);cursor:pointer">🔧 ${esc(toolName)} ${tsStr}</summary><pre style="font-size:11px;white-space:pre-wrap;word-break:break-word;margin:4px 0;max-height:200px;overflow-y:auto">${esc(shortContent)}${hasMore?`\n…(${content.length - 500} ${L==='en'?'more chars':'символов ещё'})`:''}</pre></details>`;
      }
      const bg = isUser ? 'var(--accent)' : 'var(--surface-2, var(--card-bg, var(--bg)))';
      const color = isUser ? '#fff' : 'var(--text)';
      const align = isUser ? 'flex-end' : 'flex-start';
      return `<div style="display:flex;justify-content:${align}">
        <div style="max-width:85%;background:${bg};color:${color};border:1px solid var(--border);border-radius:10px;padding:8px 12px;font-size:13px">
          ${tsStr ? `<div style="font-size:10px;opacity:.6;margin-bottom:3px">${tsStr}</div>` : ''}
          <div style="white-space:pre-wrap;word-break:break-word">${esc(shortContent)}${hasMore?`<span style="opacity:.5;font-size:11px"> …(${content.length - 500} ${L==='en'?'more':'ещё'})</span>`:''}</div>
        </div>
      </div>`;
    }).join('');
    // Scroll to bottom
    msgs.scrollTop = msgs.scrollHeight;
  } catch(err) {
    msgs.innerHTML = `<div style="color:var(--red);font-size:13px;padding:8px">${t('error')}: ${esc(err.message)}</div>`;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   FILES — дерево по агентам + категориям (Конфиг / Память / Прочее)
══════════════════════════════════════════════════════════════════════ */
const FILE_CATS = {
  'SOUL.md':      {cat:'⚙️ Конфиг', label:'Характер агента'},
  'AGENTS.md':    {cat:'⚙️ Конфиг', label:'Правила агента'},
  'MEMORY.md':    {cat:'⚙️ Конфиг', label:'Долгосрочная память'},
  'TOOLS.md':     {cat:'⚙️ Конфиг', label:'Инструменты'},
  'HEARTBEAT.md': {cat:'⚙️ Конфиг', label:'Heartbeat расписание'},
  'USER.md':      {cat:'⚙️ Конфиг', label:'Данные пользователя'},
  'IDENTITY.md':  {cat:'⚙️ Конфиг', label:'Идентичность'},
};

function catOf(path) {
  const base=path.split('/').pop();
  if (FILE_CATS[base]) return FILE_CATS[base].cat;
  if (path.startsWith('memory/')) return '📅 Память (дни)';
  return '📁 Прочее';
}

function labelOf(path) {
  const base=path.split('/').pop();
  if (FILE_CATS[base]) return FILE_CATS[base].label;
  if (path.startsWith('memory/')) {
    const d=base.replace('.md','');
    return d==='working-buffer'?'Рабочий буфер':d==='reflections'?'Размышления':d;
  }
  return base;
}

let allFiles=[], openDirs={}, openAgents={};
let openSkillAgents={};

async function loadFiles(silent=false) {
  if (!silent) withSkel('#fileTree', skelRow(5,'28px'));
  try {
    const aid=$('#fileAgentFilter').value||'all', q=$('#fileSearch').value||'';
    const d=await api('files?agentId='+encodeURIComponent(aid)+'&q='+encodeURIComponent(q));
    allFiles=d.files;
    renderFileTree();
  } catch(err) { $('#fileTree').innerHTML=`<div style="color:var(--red);font-size:12px;padding:8px">${t('error')}: ${esc(err.message)}</div>`; }
}

function renderFileTree() {
  const q=($('#fileSearch').value||'').toLowerCase();
  const files=q?allFiles.filter(f=>(f.agentId+'/'+f.path).toLowerCase().includes(q)):allFiles;

  // group: agentId → cat → files[]
  const tree={};
  files.forEach(f=>{
    if (!tree[f.agentId]) tree[f.agentId]={};
    const cat=catOf(f.path);
    if (!tree[f.agentId][cat]) tree[f.agentId][cat]=[];
    tree[f.agentId][cat].push(f);
  });

  const catOrder=['⚙️ Конфиг','📅 Память (дни)','📁 Прочее'];

  let html='';
  Object.keys(tree).sort().forEach(agentId=>{
    const c=ac(agentId);
    const akey='agent:'+agentId;
    const aOpen=openAgents[akey]!==false;
    html+=`<div class="tree-agent"><div class="tree-agent-hd" style="background:${c.bg};color:${c.text}" data-toggle="${esc(akey)}">${aOpen?'▾':'▸'} ${esc(agentId)}</div>`;

    if (aOpen) {
      const cats=tree[agentId];
      catOrder.concat(Object.keys(cats).filter(k=>!catOrder.includes(k))).forEach(cat=>{
        if (!cats[cat]) return;
        const ckey='cat:'+agentId+':'+cat;
        const open=openDirs[ckey]!==false;
        html+=`<div class="tree-cat"><div class="tree-cat-hd" data-toggle="${esc(ckey)}">${open?'▾':'▸'} ${esc(cat)} <span class="tree-count">${cats[cat].length}</span></div>`;
        if (open) {
          html+='<div class="tree-files">';
          cats[cat].forEach(f=>{
            const sel=S.file&&S.file.agentId===f.agentId&&S.file.path===f.path?' selected':'';
            const tags=(f.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('');
            html+=`<div class="tree-file${sel}" data-agent="${esc(f.agentId)}" data-path="${esc(f.path)}"><span class="tree-file-icon">📄</span><span class="tree-file-name">${esc(labelOf(f.path))}</span>${tags}</div>`;
          });
          html+='</div>';
        }
        html+='</div>';
      });
    }

    html+='</div>';
  });

  $('#fileTree').innerHTML=html||`<div style="color:var(--muted);font-size:13px;padding:8px">${L==='en'?'No files':'Файлов нет'}</div>`;
}

function onFileTreeClick(e) {
  // toggle collapse
  const tog=e.target.closest('[data-toggle]');
  if (tog) {
    const key=tog.dataset.toggle;
    if (key.startsWith('agent:')) {
      openAgents[key]=openAgents[key]===false?true:false;
      renderFileTree();
      return;
    }
    openDirs[key]=openDirs[key]===false?true:false;
    renderFileTree(); return;
  }
  // file select
  const item=e.target.closest('[data-agent][data-path]');
  if (!item) return;
  S.file={agentId:item.dataset.agent, path:item.dataset.path};
  renderFileTree();
  openFileView(S.file.agentId, S.file.path);
}

async function openFileView(agentId, path) {
  $('#fileViewTitle').textContent=agentId+' / '+path;
  $('#fileView').textContent=t('loading');
  $('#saveTagsBtn').disabled=false; $('#showDiffBtn').disabled=false;
  $('#fileDiffBox').classList.add('hidden');
  try {
    const f=await api('file?agentId='+encodeURIComponent(agentId)+'&path='+encodeURIComponent(path));
    $('#fileView').textContent=f.content;
    $('#fileTagsInput').value=(f.tags||[]).join(', ');
  } catch(err) { $('#fileView').textContent=`${t('error')}: ${err.message}`; }
}

async function onSaveTags() {
  if (!S.file) return toast(L==='en'?'Select a file':'Выберите файл','warn');
  const tags=$('#fileTagsInput').value.split(',').map(t=>t.trim()).filter(Boolean);
  try { await post('file/tags',Object.assign({},S.file,{tags})); toast(L==='en'?'Tags saved ✓':'Теги сохранены ✓'); await loadFiles(true); }
  catch(err) { toast(err.message,'err'); }
}

async function onShowDiff() {
  if (!S.file) return toast(L==='en'?'Select a file':'Выберите файл','warn');
  try {
    const d=await api('file/diff?agentId='+encodeURIComponent(S.file.agentId)+'&path='+encodeURIComponent(S.file.path));
    if (d.message) { toast(d.message,'warn'); return; }
    const lineLbl = L==='en'?'Line ':'Строка ';
    const lines=(d.preview||[]).map(x=>lineLbl+x.line+':\n− '+x.from+'\n+ '+x.to).join('\n\n');
    const changedLbl = L==='en'?'Changed lines: ':'Изменено строк: ';
    const noPreview = L==='en'?'(no preview)':'(нет предпросмотра)';
    $('#fileDiff').textContent=changedLbl+d.changedLines+'\n\n'+(lines||noPreview);
    $('#fileDiffBox').classList.remove('hidden');
  } catch(err) { toast(err.message,'err'); }
}

/* ══════════════════════════════════════════════════════════════════════
   SKILLS — с описаниями и группировкой по агентам
══════════════════════════════════════════════════════════════════════ */
async function loadSkills(silent=false) {
  if (!silent) withSkel('#skillsList', skelRow(4,'80px'));
  const reqId = (S.skillsReqId || 0) + 1;
  S.skillsReqId = reqId;
  try {
    const aid=$('#skillAgentFilter').value||'all', q=$('#skillSearch').value||'';
    const d=await api('skills?agentId='+encodeURIComponent(aid)+'&q='+encodeURIComponent(q), 12000);
    if (reqId !== S.skillsReqId) return; // stale response
    renderSkills(d.skills);
  } catch(err) {
    if (reqId !== S.skillsReqId) return;
    $('#skillsList').innerHTML=`<div style="color:var(--red);padding:12px">${t('error')}: ${esc(err.message)}</div>`;
  }
}

function renderSkills(skills) {
  const canAdm=S.me.role==='admin';
  const groups={};
  skills.forEach(s=>{ if(!groups[s.agentId]) groups[s.agentId]=[]; groups[s.agentId].push(s); });
  if (!skills.length) { $('#skillsList').innerHTML=`<div style="padding:16px;color:var(--muted);text-align:center">${L==='en'?'No skills':'Скиллов нет'}</div>`; return; }
  let html='';
  Object.keys(groups).sort().forEach(agentId=>{
    const c=ac(agentId);
    const key=`skills-agent:${agentId}`;
    const isOpen = openSkillAgents[key] !== false;
    html+=`<div style="margin-bottom:20px">`+
      `<button class="skills-agent-toggle" data-action="skills-agent-toggle" data-key="${esc(key)}" style="border:0;cursor:pointer;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${c.text};margin-bottom:8px;padding:6px 10px;background:${c.bg};border-radius:8px;display:inline-flex;gap:8px;align-items:center">${isOpen?'▾':'▸'} ${esc(agentId)} <span class="tree-count">${groups[agentId].length}</span></button>`;

    if (isOpen) {
      html+=groups[agentId].map(s=>{
        const srcPill=s.source==='custom'?'<span class="pill pill-purple">custom</span>':'<span class="pill pill-muted">system</span>';
        const eligPill=s.eligible!==undefined?(s.eligible?`<span class="pill pill-green">${L==='en'?'ready':'готов'}</span>`:`<span class="pill pill-amber">${L==='en'?'not ready':'не готов'}</span>`):'';
        const desc=s.description?`<div class="skill-desc">${esc(s.description)}</div>`:`<div class="skill-desc" style="color:var(--muted-2);font-style:italic">${L==='en'?'No description':'Без описания'}</div>`;
        const delBtn=s.deletable?`<button class="btn btn-sm btn-danger" data-action="skill-delete" data-agent="${esc(s.agentId)}" data-slug="${esc(s.slug||s.name)}" ${canAdm?'':'disabled'}>🗑 Удалить</button>`:'';
        return `<div class="skill-card"><div class="skill-head"><span class="skill-name">${esc(s.name)}</span>${srcPill} ${eligPill}</div>${desc}<div>${delBtn}</div></div>`;
      }).join('');
    }

    html+='</div>';
  });
  $('#skillsList').innerHTML=html;
}

async function onSkillDelete(e) {
  const toggleBtn=e.target.closest('[data-action="skills-agent-toggle"]');
  if (toggleBtn) {
    const key = toggleBtn.dataset.key;
    openSkillAgents[key] = openSkillAgents[key] === false ? true : false;
    await loadSkills(true);
    return;
  }

  const btn=e.target.closest('[data-action="skill-delete"]'); if(!btn) return;
  const agentId=btn.dataset.agent, slug=btn.dataset.slug;
  if(!confirm(`${t('confirmDeleteSkill')} "${slug}" (${agentId})?`)) return;
  try { btn.disabled=true; await post('skill/delete',{agentId,slug}); toast((L==='en'?'Skill deleted: ':'Скилл удалён: ')+slug); await loadSkills(true); }
  catch(err) { toast(err.message,'err'); } finally { btn.disabled=false; }
}

/* ══════════════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════════════ */
async function boot() {
  // 1. Показываем UI сразу
  $('#globalLoader').classList.add('hidden');
  $('#app').classList.remove('hidden');
  loadDismissed();
  loadTheme();
  loadLang();

  // 2. Events
  initTabs();
  initQuickActions();
  initChatWidget();
  $('#refreshBtn').addEventListener('click', ()=>{ refreshAll(); toast(t('updating')); });
  $('#themeBtn')?.addEventListener('click', toggleTheme);
  $('#langBtn')?.addEventListener('click', ()=>setLang(L==='ru'?'en':'ru'));
  $('#updateBtn')?.addEventListener('click', runOpenclawUpdate);

  // Cron edit modal
  $('#closeCronEdit')?.addEventListener('click', ()=>$('#cronEditModal')?.classList.add('hidden'));
  $('#cancelCronEdit')?.addEventListener('click', ()=>$('#cronEditModal')?.classList.add('hidden'));
  $('#saveCronEdit')?.addEventListener('click', saveCronEdit);
  $('#cronEditModal')?.addEventListener('click', e => { if (e.target === $('#cronEditModal')) $('#cronEditModal').classList.add('hidden'); });

  // Session transcript panel
  $('#closeTranscript')?.addEventListener('click', ()=>$('#transcriptPanel')?.classList.add('hidden'));

  $('#cronAgentFilter').addEventListener('change', ()=>loadCrons(true));
  $('#cronList').addEventListener('click', onCronClick);
  $('#closeCronHistory').addEventListener('click', ()=>$('#cronHistoryPanel').classList.add('hidden'));

  $('#sessionAgentFilter').addEventListener('change', ()=>loadSessions(true));
  $('#sessionSearch').addEventListener('input', debounce(()=>loadSessions(true), 220));
  $('#sessionsTbody').addEventListener('click', onSessionAction);

  $('#fileAgentFilter').addEventListener('change', ()=>loadFiles(true));
  $('#fileSearch').addEventListener('input',       ()=>{ renderFileTree(); });
  // delegate click to tree
  $('#fileTree').addEventListener('click', onFileTreeClick);
  $('#saveTagsBtn').addEventListener('click', onSaveTags);
  $('#showDiffBtn').addEventListener('click', onShowDiff);

  $('#skillAgentFilter').addEventListener('change', ()=>loadSkills(true));
  $('#skillSearch').addEventListener('input', debounce(()=>loadSkills(true), 260));
  $('#skillsList').addEventListener('click', onSkillDelete);

  // 3. Роль
  api('me').then(me=>{ S.me=me; $('#userBadge').textContent=me.user+' · '+me.role; }).catch(()=>{});

  $('#alertsList').addEventListener('click', onAlertAction);
  $('#intelList').addEventListener('click', onIntelAction);
  $('#activeTasksList')?.addEventListener('click', onActiveTaskAction);
  $('#closeTaskReplay')?.addEventListener('click', ()=>$('#taskReplayPanel')?.classList.add('hidden'));
  $('#healthHelpBtn')?.addEventListener('click', showHealthScoreHelp);
  bindReportActions();
  window.addEventListener('resize', debounce(() => loadHeatmap(true), 180));

  // 4. Первая загрузка обзора — каждая секция независимо
  loadStats(false);
  loadAgentRow(false);
  loadAlerts(false);
  loadIntel(false);
  loadIncidentCenter(false);
  loadActiveTasks(false);
  loadWeeklyReview(false);
  loadUsageGuard(false);
  loadHealthScore(false);
  loadUpdateState();
  loadHeatmap(false);

  // 4.1 Прогрев тяжелых вкладок в фоне (без скелетонов)
  loadSkills(true);

  // 5. Авто-обновление ТИХОЕ — без скелетонов
  setInterval(refreshAll, 60000);
  setInterval(() => loadActiveTasks(true), 7000);
  setInterval(() => loadUpdateState(), 180000);
}

boot();
