'use strict';

// Painel admin — vanilla JS. Nicknames/comentários vêm de usuários do TikTok
// (não confiáveis): TUDO é inserido via textContent/createElement, nunca innerHTML.

const WS_URL = `ws://${location.hostname}:8787/?role=admin`;
const STATUS_POLL_MS = 3000;
const MAX_FEED = 150;

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('pt-BR');

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

let lastStatus = null;
let wsOpen = false;

// ---------------------------------------------------------------- comandos

function toast(text, isError = false) {
  const t = h('div', { className: `toast${isError ? ' err' : ''}`, textContent: text });
  $('toasts').append(t);
  setTimeout(() => t.remove(), isError ? 6000 : 2500);
}

async function api(body, { quiet = false } = {}) {
  try {
    const res = await fetch('/api/admin/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin': '1' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      toast(data.error || `erro ${res.status}`, true);
      return { ok: false, error: data.error || `erro ${res.status}` };
    }
    if (!quiet) toast(data.message || 'ok');
    return { ok: true };
  } catch (err) {
    toast(`falha de rede: ${err.message}`, true);
    return { ok: false, error: err.message };
  }
}

function numberValue(id) {
  return Number($(id).value);
}

// ---------------------------------------------------------------- renderização

function renderPills(s) {
  const pills = $('pills');
  pills.replaceChildren();
  const add = (text, cls = '') => pills.append(h('span', { className: `pill ${cls}`, textContent: text }));

  if (s.source.kind === 'tiktok') {
    add(`TikTok @${s.source.username}: ${s.source.connected ? 'conectado' : 'desconectado'}`, s.source.connected ? 'ok' : 'bad');
  } else {
    add('Modo teste (sem TikTok)', 'warn');
  }
  const renders = s.clients.render;
  add(`Jogo/OBS: ${renders}`, renders > 0 ? 'ok' : s.mode === 'fake' ? 'warn' : 'bad');
  add(`Admin: ${s.clients.admin}`);
  add(`Health: ${s.health.ok ? 'ok' : 'FALHA'}`, s.health.ok ? 'ok' : 'bad');
  add(`OBS WS: ${s.obsEnabled ? 'ligado' : 'desligado'}`, s.obsEnabled ? 'ok' : '');
  add(`Painel↔servidor: ${wsOpen ? 'ao vivo' : 'reconectando…'}`, wsOpen ? 'ok' : 'bad');
  add(`Uptime ${formatUptime(s.uptimeSec)}`);
  if (s.game.paused) add('PAUSADO', 'warn');
}

function formatUptime(sec) {
  const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function renderGame(g) {
  $('g-day').textContent = g.seasonDay;
  $('g-era').textContent = g.era.name;
  $('g-wave').textContent = g.wave;
  $('g-monster').textContent = `${g.isBoss ? '⚠ CHEFÃO · ' : ''}${g.monsterName}`;
  $('g-monster-hp').textContent = `${fmt(g.monsterHp)} / ${fmt(g.monsterMaxHp)}`;
  $('g-monster-bar').style.width = `${Math.max(0, Math.min(100, (g.monsterHp / g.monsterMaxHp) * 100))}%`;
  document.querySelector('.bar.monster').classList.toggle('boss', g.isBoss);
  $('g-kingdom-hp').textContent = `${fmt(g.kingdomHp)} / ${fmt(g.kingdomMaxHp)}`;
  $('g-kingdom-bar').style.width = `${Math.max(0, Math.min(100, (g.kingdomHp / g.kingdomMaxHp) * 100))}%`;

  const totals = [
    ['Likes', g.totalLikes],
    ['Comentários', g.totalComments],
    ['Gifts', g.totalGifts],
    ['Diamantes', g.totalDiamondValue],
    ['Follows', g.totalFollows],
    ['Shares', g.totalShares],
  ];
  $('g-totals').replaceChildren(
    ...totals.map(([label, value]) => h('div', {}, h('span', { textContent: label }), document.createTextNode(fmt(value)))),
  );

  $('btn-pause').textContent = g.paused ? 'Retomar' : 'Pausar';
  $('btn-pause').classList.toggle('warn', g.paused);
}

function renderRankList(id, rows, format) {
  const list = $(id);
  list.replaceChildren(...(rows.length ? rows.map((r) => h('li', { textContent: format(r) })) : [h('li', { textContent: '—' })]));
}

function renderRankings(lb) {
  renderRankList('r-gifters', (lb.today.gifters || []).slice(0, 5), (r) => `${r.nickname} — ${fmt(r.value)}💎`);
  renderRankList('r-chatters', (lb.today.chatters || []).slice(0, 5), (r) => `${r.nickname} — ${fmt(r.value)}`);
  renderRankList('r-gifters-all', (lb.allTime.gifters || []).slice(0, 5), (r) => `${r.nickname} — ${fmt(r.value)}💎`);
  renderRankList('r-hall', (lb.hallOfFame || []).slice(0, 5), (r) => `Dia ${r.day}: ${r.topGifterNickname ?? '—'} (${fmt(r.topGifterValue)}💎)`);
  $('r-heroes').textContent = `⚔️ ${fmt(lb.heroCount)} heróis no Reino`;
}

function renderLevels(rows) {
  renderRankList('r-levels', rows || [], (r) => `Nv ${r.level} ${r.nickname} — ${r.title} · ${r.classKey} (${fmt(r.xp)} XP)`);
}

function renderBurst(burst) {
  $('burst-status').textContent = burst
    ? `Rajada ativa: ${burst.ratePerSec} eventos/s, restam ${Math.max(0, Math.round((burst.endsAt - Date.now()) / 1000))}s`
    : 'Nenhuma rajada ativa.';
}

// ---------------------------------------------------------------- balanceamento

const BALANCE_LABELS = {
  kingdomMaxHp: ['HP máximo do Reino', ''],
  kingdomDecayPerTick: ['Decaimento do Reino', 'por segundo'],
  kingdomHealPerFollow: ['Cura por follow', ''],
  kingdomHealPerWaveCleared: ['Cura por onda vencida', ''],
  dmgPerLike: ['Dano por like', ''],
  dmgPerComment: ['Dano por comentário', ''],
  dmgPerDiamond: ['Dano por diamante', ''],
  dmgShareRally: ['Dano do share', ''],
  bossEveryWaves: ['Chefão a cada N ondas', 'próxima onda'],
  monsterBaseHp: ['HP base do monstro', 'próxima onda'],
  monsterHpGrowth: ['Crescimento de HP por onda (×)', 'próxima onda · 1.05 = +5%'],
  bossHpMultiplier: ['Multiplicador de HP do chefão', 'próxima onda'],
};

const balanceInputs = {};
let balanceBuilt = false;

function buildBalanceForm(s) {
  const root = $('balance');
  root.replaceChildren();
  for (const key of Object.keys(s.balanceRanges)) {
    const range = s.balanceRanges[key];
    const [label, note] = BALANCE_LABELS[key] ?? [key, ''];
    const input = h('input', {
      type: 'number',
      min: range.min,
      max: range.max,
      step: range.integer ? 1 : 'any',
      title: `faixa ${range.min} a ${range.max} · padrão ${s.balanceDefaults[key]}`,
    });
    input.addEventListener('input', () => {
      input.dataset.dirty = '1';
      markChanged(input, key);
    });
    balanceInputs[key] = input;
    root.append(h('div', { className: 'name' }, document.createTextNode(label), h('small', { textContent: note || `padrão ${s.balanceDefaults[key]}` })), input);
  }
  balanceBuilt = true;
}

function markChanged(input, key) {
  const current = lastStatus?.balance?.[key];
  input.classList.toggle('changed', Number(input.value) !== current);
}

function syncBalanceInputs(s) {
  if (!balanceBuilt) buildBalanceForm(s);
  for (const [key, input] of Object.entries(balanceInputs)) {
    if (input.dataset.dirty === '1' || document.activeElement === input) continue;
    input.value = s.balance[key];
    input.classList.remove('changed');
  }
}

async function saveBalance() {
  const patch = {};
  for (const [key, input] of Object.entries(balanceInputs)) patch[key] = Number(input.value);
  $('balance-error').textContent = '';
  const result = await api({ cmd: 'setBalance', balance: patch });
  if (!result.ok) {
    $('balance-error').textContent = result.error;
    return;
  }
  for (const input of Object.values(balanceInputs)) delete input.dataset.dirty;
  await loadStatus();
}

// ---------------------------------------------------------------- feed

function addFeedEntry(entry) {
  const li = h('li', { className: entry.kind });
  li.dataset.kind = entry.kind;
  li.dataset.event = entry.eventType ?? '';
  li.append(h('span', { className: 'ts', textContent: new Date(entry.ts).toLocaleTimeString('pt-BR') }));
  if (entry.test) li.append(h('span', { className: 'tag', textContent: 'TESTE' }));
  li.append(h('span', { className: 'text', textContent: entry.text }));
  li.hidden = !passesFilter(li);

  const feed = $('feed');
  feed.prepend(li);
  while (feed.children.length > MAX_FEED) feed.lastElementChild.remove();
}

function passesFilter(li) {
  if (!$(`f-${li.dataset.kind}`).checked) return false;
  if (li.dataset.event === 'like' && $('f-hidelikes').checked) return false;
  return true;
}

function applyFilters() {
  for (const li of $('feed').children) li.hidden = !passesFilter(li);
}

// ---------------------------------------------------------------- dados

async function loadStatus() {
  try {
    const res = await fetch('/api/admin/status');
    if (!res.ok) throw new Error(`status ${res.status}`);
    const s = await res.json();
    const first = lastStatus === null;
    lastStatus = s;

    renderPills(s);
    renderGame(s.game);
    renderRankings(s.leaderboard);
    renderLevels(s.topLevels);
    renderBurst(s.burst);
    syncBalanceInputs(s);
    if (first) [...s.log].forEach(addFeedEntry);
  } catch (err) {
    $('pills').replaceChildren(h('span', { className: 'pill bad', textContent: `sem resposta do servidor (${err.message})` }));
  }
}

function connectWs() {
  const ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    wsOpen = true;
    if (lastStatus) renderPills(lastStatus);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'state' && lastStatus) {
      lastStatus.game = msg.payload;
      renderGame(msg.payload);
    } else if (msg.type === 'log') {
      addFeedEntry(msg.payload);
    } else if (msg.type === 'balance' && lastStatus) {
      lastStatus.balance = msg.payload;
      syncBalanceInputs(lastStatus);
    }
  };
  ws.onclose = () => {
    wsOpen = false;
    if (lastStatus) renderPills(lastStatus);
    setTimeout(connectWs, 2000);
  };
  ws.onerror = () => ws.close();
}

// ---------------------------------------------------------------- UI

const QUICK = [
  { label: 'Like ×20', event: { type: 'like', likeCount: 20 } },
  { label: 'Like ×200', event: { type: 'like', likeCount: 200 } },
  { label: 'Comentário', event: { type: 'comment', comment: 'Vai Reino! 🔥' } },
  { label: '🌹 Rosa (1)', event: { type: 'gift', giftName: 'Rosa', diamondValue: 1 } },
  { label: '🧴 Perfume (20)', event: { type: 'gift', giftName: 'Perfume', diamondValue: 20 } },
  { label: '🎁 GG (100)', event: { type: 'gift', giftName: 'GG', diamondValue: 100 } },
  { label: '🦁 Leão (5k)', event: { type: 'gift', giftName: 'Leão', diamondValue: 5000 } },
  { label: '🌌 Galáxia (20k)', event: { type: 'gift', giftName: 'Galáxia', diamondValue: 20000 } },
  { label: '➕ Follow', event: { type: 'follow' } },
  { label: '↗ Share', event: { type: 'share' } },
];

function withNickname(event) {
  const nickname = $('t-nick').value.trim();
  return nickname ? { ...event, nickname } : event;
}

function updateFormVisibility() {
  const type = $('t-type').value;
  const show = (id, on) => ($(id).style.display = on ? '' : 'none');
  show('lbl-likes', type === 'like');
  show('lbl-comment', type === 'comment');
  show('lbl-gift', type === 'gift');
  show('lbl-diamonds', type === 'gift');
  show('lbl-repeat', type === 'gift');
}

function formEvent() {
  const type = $('t-type').value;
  const event = { type };
  if (type === 'like') event.likeCount = numberValue('t-likes');
  if (type === 'comment') event.comment = $('t-comment').value;
  if (type === 'gift') {
    event.giftName = $('t-gift').value;
    event.diamondValue = numberValue('t-diamonds');
    event.repeatCount = numberValue('t-repeat');
  }
  return withNickname(event);
}

function init() {
  const previewVertical = $('preview-vertical');
  const applyPreview = () => {
    const vertical = previewVertical.checked;
    $('preview-box').classList.toggle('vertical', vertical);
    $('preview').src = `/?role=preview&vertical=${vertical ? 1 : 0}`;
    try {
      localStorage.setItem('previewVertical', vertical ? '1' : '0');
    } catch {
      // sem storage: só não lembra a escolha
    }
  };
  try {
    previewVertical.checked = localStorage.getItem('previewVertical') === '1';
  } catch {
    previewVertical.checked = false;
  }
  previewVertical.addEventListener('change', applyPreview);
  applyPreview();

  for (const q of QUICK) {
    const btn = h('button', { className: 'btn', textContent: q.label });
    btn.addEventListener('click', () => api({ cmd: 'inject', event: withNickname(q.event) }, { quiet: true }));
    $('quick').append(btn);
  }

  document.querySelectorAll('[data-cmd]').forEach((btn) =>
    btn.addEventListener('click', () => api({ cmd: btn.dataset.cmd })),
  );

  $('btn-pause').addEventListener('click', () => api({ cmd: lastStatus?.game.paused ? 'resume' : 'pause' }).then(loadStatus));
  $('btn-season').addEventListener('click', () => {
    if (confirm('Encerrar a season agora? Isso arquiva o dia no Hall da Fama (dado real) e reseta a onda.')) {
      api({ cmd: 'endSeason' });
    }
  });
  $('btn-wave').addEventListener('click', () => api({ cmd: 'setWave', wave: numberValue('in-wave') }));
  $('btn-heal').addEventListener('click', () => api({ cmd: 'healKingdom', amount: numberValue('in-kingdom') }));
  $('btn-hurt').addEventListener('click', () => api({ cmd: 'damageKingdom', amount: numberValue('in-kingdom') }));
  $('btn-score').addEventListener('click', () => api({ cmd: 'addScore', amount: numberValue('in-score') }));

  $('btn-grantxp').addEventListener('click', () =>
    api({ cmd: 'grantXp', nickname: $('xp-nick').value, amount: numberValue('xp-amount') }).then(loadStatus),
  );
  $('btn-resetprogress').addEventListener('click', () => {
    if (confirm('Zerar XP, missões e conquistas de TODOS os espectadores? Não dá pra desfazer.')) {
      api({ cmd: 'resetProgress' }).then(loadStatus);
    }
  });

  $('t-type').addEventListener('change', updateFormVisibility);
  updateFormVisibility();
  $('btn-send').addEventListener('click', () => api({ cmd: 'inject', event: formEvent() }, { quiet: true }));

  $('btn-burst').addEventListener('click', () =>
    api({ cmd: 'burst', ratePerSec: numberValue('b-rate'), seconds: numberValue('b-secs') }).then(loadStatus),
  );
  $('btn-stopburst').addEventListener('click', () => api({ cmd: 'stopBurst' }).then(loadStatus));

  $('btn-balance-save').addEventListener('click', saveBalance);
  $('btn-balance-reset').addEventListener('click', async () => {
    const result = await api({ cmd: 'resetBalance' });
    if (!result.ok) return;
    for (const input of Object.values(balanceInputs)) delete input.dataset.dirty;
    $('balance-error').textContent = '';
    await loadStatus();
  });

  for (const id of ['f-event', 'f-narrative', 'f-system', 'f-hidelikes']) $(id).addEventListener('change', applyFilters);
  $('btn-clearfeed').addEventListener('click', () => $('feed').replaceChildren());

  loadStatus();
  setInterval(loadStatus, STATUS_POLL_MS);
  connectWs();
}

init();
