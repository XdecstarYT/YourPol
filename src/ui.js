// ui.js — all rendering and DOM interaction. The UI is a pure function of
// game state plus an `api` object of actions; after any action we re-render.

import { fmtDate, fmtMoney, fmtPct, round, clamp } from './engine.js';
import { METRICS, STATES, PARTIES, CAREERS, RANKS, partyById } from './data.js';
import {
  approval, totalSpend, polById, polName, govLabel, nationalMood,
  availableActions, currentRankIndex, buildPendulum, seatStatus,
  REFERENDUM_CATALOGUE, topIndustries, renewableShare, courtBalance,
  mediaMood, dynastyMembers, ACHIEVEMENTS, legacyScore,
} from './sim/index.js';
import { POLICY_CATALOGUE } from './sim/legislation.js';
import { sfx, configureAudio, getAudioSettings, startMusic, unlockAudio } from './audio.js';
import { lineChart, donut } from './charts.js';
import { buildAusMap } from './ausmap.js';
import { DIFFICULTIES } from './data.js';
import { BILL_CATEGORIES, customEffect, effectOf } from './sim/legislation.js';

// Leading party among a state's electorates (for colouring the map).
function stateLeadParty(state, code) {
  const seats = state.electorates.filter((e) => e.state === code);
  if (!seats.length) return state.stateGovs?.[code]?.party || 'ind';
  const tally = {};
  seats.forEach((e) => (tally[e.held] = (tally[e.held] || 0) + 1));
  // coalition counts together for colour purposes
  const coal = (tally.lib || 0) + (tally.nat || 0);
  let best = 'ind', bestN = 0;
  for (const [p, n] of Object.entries(tally)) if (n > bestN) { best = p; bestN = n; }
  if (coal >= bestN) best = 'lib';
  return best;
}
function partyColour(id) { return partyById(id)?.colour || '#8a8f94'; }

let API = null;
let VIEW = 'dashboard';

export function initUI(api) {
  API = api;
  wireChrome();
  loadSettings();
}

/* ------------------------------------------------------------------ helpers */
function $(sel) { return document.querySelector(sel); }
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return n;
}
function metricColour(v) {
  if (v >= 66) return 'var(--good)';
  if (v >= 40) return 'var(--warn)';
  return 'var(--bad)';
}
export function modal(title, bodyNode, actions = []) {
  $('#modal-title').textContent = title;
  const body = $('#modal-body'); body.innerHTML = ''; body.appendChild(bodyNode);
  const act = $('#modal-actions'); act.innerHTML = '';
  for (const a of actions) {
    act.appendChild(el('button', { class: `btn ${a.kind || ''}`, onclick: () => { a.run?.(); if (!a.keepOpen) closeModal(); } }, a.label));
  }
  $('#modal-host').classList.remove('hidden');
}
export function closeModal() { $('#modal-host').classList.add('hidden'); }

/* ------------------------------------------------------------------ chrome */
function wireChrome() {
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.querySelectorAll('.rail-btn').forEach((b) =>
    b.addEventListener('click', () => { sfx('tab'); setView(b.dataset.view); }));
  $('#btn-endturn').addEventListener('click', () => API.endTurn());
  $('#btn-endyear').addEventListener('click', () => API.endYear());
  $('#btn-auto').addEventListener('click', () => API.toggleAuto());
  document.querySelectorAll('.speed-btn').forEach((b) =>
    b.addEventListener('click', () => { sfx('click'); API.setSpeed(+b.dataset.speed); }));
  $('#btn-save').addEventListener('click', () => { sfx('success'); API.save(); toast('Game saved', 'Your progress is stored locally.', 'good'); });
  $('#btn-load').addEventListener('click', () => { sfx('click'); API.load(); });
  $('#btn-settings').addEventListener('click', () => { sfx('click'); showSettings(); });
  $('#btn-menu').addEventListener('click', () => { sfx('click'); API.openMenu(); });
  $('#modal-backdrop').addEventListener('click', closeModal);
}
function setView(v) {
  VIEW = v;
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  render(API.state());
}

/* ---- toast notifications ---- */
export function toast(title, body = '', kind = '') {
  const host = $('#toast-host'); if (!host) return;
  const t = el('div', { class: `toast ${kind}` }, el('div', { class: 'tt' }, title), body ? el('div', { class: 'tb' }, body) : null);
  host.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 4200);
  // keep the ticker in sync too
  $('#cb-ticker').textContent = title;
}

/* ------------------------------------------------------------------ render */
export function render(state) {
  renderTopbar(state);
  renderMetrics(state);
  renderControlbar(state);
  renderView(state);
  renderContext(state);
}

function renderTopbar(state) {
  const e = state.economy;
  $('#tb-approval').textContent = `👍 ${round(approval(state))}%`;
  $('#tb-gdp').textContent = `💰 ${fmtMoney(e.gdp)}`;
  $('#tb-balance').textContent = `📊 ${fmtMoney(state.budget.lastBalance)}`;
  $('#tb-unemp').textContent = `🧑‍🏭 ${fmtPct(e.unemployment)}`;
  $('#tb-debt').textContent = `🏦 ${fmtMoney(e.debt)} debt`;
  const role = playerRoleLabel(state);
  $('#tb-role').textContent = role;
}
function playerRoleLabel(state) {
  const pl = state.player;
  if (!pl) return 'Observer';
  if (pl.polId) {
    const pol = polById(state, pl.polId);
    const rank = RANKS.find((r) => r.id === pol?.rank);
    return `${pl.name} · ${rank?.name || 'MP'}`;
  }
  const c = CAREERS.find((c) => c.id === pl.careerId);
  return `${pl.name} · ${c?.name || 'Citizen'}`;
}

function renderMetrics(state) {
  const wrap = $('#metrics-list'); wrap.innerHTML = '';
  for (const def of METRICS) {
    const v = state.metrics[def.key];
    wrap.appendChild(el('div', { class: 'metric' },
      el('span', { class: 'm-name' }, `${def.icon} ${def.label}`),
      el('span', { class: 'm-val' }, String(round(v))),
      el('div', { class: 'm-bar' }, el('div', { class: 'm-fill', style: `width:${v}%;background:${metricColour(v)}` })),
    ));
  }
}

function renderControlbar(state) {
  const turn = state.tick + 1;
  $('#cb-date').textContent = `Turn ${turn} · ${fmtDate(state.tick)}`;
  $('#btn-auto').classList.toggle('active', state.auto);
  $('#btn-auto').textContent = state.auto ? '⏸ Auto' : '⏯ Auto';
  // End Turn is disabled while a crisis awaits a decision
  const blocked = state.events.length > 0;
  $('#btn-endturn').disabled = blocked;
  $('#btn-endyear').disabled = blocked;
  $('#speed-group').style.display = state.auto ? 'flex' : 'none';
  document.querySelectorAll('.speed-btn').forEach((b) => b.classList.toggle('active', +b.dataset.speed === state.speed));
  if (state.log[0]) $('#cb-ticker').textContent = state.log[0].text;
}

/* ------------------------------------------------------------- views */
function renderView(state) {
  const root = $('#view-root'); root.innerHTML = '';
  const fn = {
    dashboard: viewDashboard, parliament: viewParliament, elections: viewElections,
    legislation: viewLegislation, budget: viewBudget, parties: viewParties,
    career: viewCareer, history: viewHistory,
    economy: viewEconomy, courts: viewCourts, society: viewSociety, world: viewWorld,
  }[VIEW] || viewDashboard;
  root.appendChild(fn(state));
}

// --- Dashboard: national overview with KPIs, trends, objectives & 3D map ---
function viewDashboard(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, `National Dashboard · ${fmtDate(state.tick)}`));
  const pm = state.gov.pm ? polName(state, state.gov.pm) : '—';
  pad.appendChild(el('p', { class: 'muted' }, `${govLabel(state.gov)} government · Prime Minister ${pm} · ${state.difficulty} difficulty`));

  // KPI cards
  const e = state.economy, prev = state.trends?.[state.trends.length - 13];
  const kpis = el('div', { class: 'kpi-row' });
  kpis.appendChild(kpi('Approval', `${round(approval(state))}%`, delta(approval(state), prev?.approval)));
  kpis.appendChild(kpi('Happiness', round(state.metrics.happiness), delta(state.metrics.happiness, prev?.happiness)));
  kpis.appendChild(kpi('GDP', fmtMoney(e.gdp), `${fmtPct(e.growth)} growth`));
  kpis.appendChild(kpi('Unemployment', fmtPct(e.unemployment), delta(prev?.unemployment, e.unemployment)));
  kpis.appendChild(kpi('Inflation', fmtPct(e.inflation), ''));
  kpis.appendChild(kpi('Net debt', fmtMoney(e.debt), `${fmtPct(e.cashRate)} cash rate`));
  pad.appendChild(kpis);

  // trend chart
  if (state.trends && state.trends.length > 2) {
    const card = el('div', { class: 'chart-card' });
    card.appendChild(el('div', { class: 'muted', style: 'font-weight:700;margin-bottom:6px' }, 'Approval & Happiness over time'));
    const canvas = el('canvas');
    card.appendChild(canvas);
    pad.appendChild(card);
    // defer draw until in DOM
    queueChart(() => lineChart(canvas, [
      { label: 'Approval', color: '#3d6bf6', data: state.trends.map((p) => p.approval) },
      { label: 'Happiness', color: '#1fa463', data: state.trends.map((p) => p.happiness) },
    ], { min: 0, max: 100, width: chartWidth(canvas), height: 200 }));
  }

  // objectives
  if (state.objectives?.length) {
    pad.appendChild(el('h3', {}, 'Objectives'));
    const list = el('div', { class: 'obj-list' });
    for (const o of state.objectives) list.appendChild(el('div', { class: `obj ${o.done ? 'done' : ''}` },
      el('span', { class: 'ck' }, o.done ? '✓' : ''), el('span', { class: 'ot' }, o.text), o.progress ? el('span', { class: 'op' }, o.progress) : null));
    pad.appendChild(list);
  }

  // 3D Australia map coloured by each state's government
  pad.appendChild(el('h3', {}, 'States & Territories'));
  const mapBox = el('div', { class: 'dash-map' });
  const map = buildAusMap({
    colorOf: (code) => partyColour(state.stateGovs[code]?.party),
    labelOf: (code) => code,
    onClick: (code) => stateModal(state, STATES.find((s) => s.code === code)),
  });
  mapBox.appendChild(map.el);
  pad.appendChild(mapBox);
  pad.appendChild(partyLegend(state));
  return pad;
}
function partyLegend(state) {
  const leg = el('div', { class: 'map-legend' });
  for (const p of PARTIES.filter((x) => x.id !== 'ind' && x.id !== 'tea')) {
    leg.appendChild(el('div', { class: 'lg' }, el('span', { class: 'sw', style: `background:${p.colour}` }), p.short));
  }
  return leg;
}
function kpi(label, val, sub) {
  const cls = typeof sub === 'string' && sub.startsWith('▲') ? 'k-up' : typeof sub === 'string' && sub.startsWith('▼') ? 'k-down' : '';
  return el('div', { class: 'kpi' }, el('div', { class: 'k-label' }, label), el('div', { class: 'k-val' }, String(val)),
    el('div', { class: `k-sub ${cls}` }, String(sub || '')));
}
function delta(cur, prev) {
  if (prev == null) return '';
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return '▬ steady';
  return d > 0 ? `▲ ${Math.abs(d).toFixed(1)}` : `▼ ${Math.abs(d).toFixed(1)}`;
}
// charts must draw after insertion; run on next frame (skipped in headless envs)
function queueChart(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(fn));
}
function chartWidth(canvas) { const w = canvas.parentElement?.clientWidth || 520; return Math.max(280, w - 4); }
function stateTile3D(state, st) {
  const sg = state.stateGovs[st.code];
  const col = partyById(sg.party).colour;
  // local two-party-ish support to fill the bar
  const seats = state.electorates.filter((e) => e.state === st.code);
  const govSeats = seats.filter((e) => e.held === sg.party).length;
  const pct = clamp((govSeats / seats.length) * 100, 5, 100);
  return el('div', { class: 'tile3d', style: `border-top-color:${col}`, onclick: () => stateModal(state, st) },
    el('div', { class: 't-code' }, st.code),
    el('div', { class: 't-prem' }, `${sg.title}: ${sg.premier}`),
    el('div', { class: 't-prem' }, `${partyById(sg.party).short} govt · ${st.hor} fed seats`),
    el('div', { class: 't-bar' }, el('div', { class: 't-fill', style: `width:${pct}%;background:${col}` })),
  );
}
function stateModal(state, st) {
  const sg = state.stateGovs[st.code];
  const seats = state.electorates.filter((e) => e.state === st.code);
  const body = el('div', {},
    el('p', {}, el('b', {}, `${sg.title}: `), sg.premier, ' (', el('span', { class: 'tag', style: `background:${partyById(sg.party).colour}` }, partyById(sg.party).short), ' government)'),
    el('p', { class: 'muted' }, `Population ${st.pop}M · ${st.hor} House seats · ${st.senate} Senate seats · State approval ${sg.approval}%`),
    el('p', { class: 'muted' }, `Next state election: ${fmtDate(sg.nextElection)}`),
    el('h3', {}, `Federal seats held (${seats.length})`),
  );
  const counts = {};
  seats.forEach((e) => (counts[e.held] = (counts[e.held] || 0) + 1));
  const line = el('div', { class: 'gov-line' });
  [...PARTIES].filter((p) => counts[p.id]).sort((a, b) => counts[b.id] - counts[a.id]).forEach((p) =>
    line.appendChild(el('span', { class: 'tag', style: `background:${p.colour};margin-right:4px` }, `${p.short} ${counts[p.id]}`)));
  body.appendChild(line);
  // marginal seats in this state
  const marg = seats.filter((e) => e.margin < 6).sort((a, b) => a.margin - b.margin).slice(0, 8);
  body.appendChild(el('h3', {}, 'Most marginal seats'));
  marg.forEach((e) => body.appendChild(el('div', { class: 'pend-row' },
    el('span', {}, el('span', { class: 'pill', style: `background:${partyById(e.held).colour}` }), e.name),
    el('span', { class: 'mg' }, `${partyById(e.held).short} ${e.margin.toFixed(1)}%`))));
  modal(`${st.name}`, body, [{ label: 'Close', kind: 'secondary' }]);
}

// --- Parliament: 3D hemicycle chamber ---
let CHAMBER_KEY = 'hor';
function viewParliament(state) {
  const wrap = el('div', { class: 'chamber3d-wrap' });
  const pm = state.gov.pm ? polName(state, state.gov.pm) : '—';
  const head = el('div', { class: 'chamber3d-head' });
  head.appendChild(el('h2', {}, '🏛️ Parliament of Australia'));
  head.appendChild(el('div', {},
    el('span', { class: 'tag', style: `background:${partyById(state.gov.parties[0]).colour}` }, govLabel(state.gov)),
    ' government · Prime Minister ', el('b', { style: 'color:#fff' }, pm),
    state.gov.majority ? ' (majority)' : ' (minority)'));
  // chamber toggle
  const toggle = el('div', { style: 'margin-top:8px;display:flex;gap:6px' });
  ['hor', 'senate'].forEach((k) => toggle.appendChild(el('button', {
    class: `btn small ${CHAMBER_KEY === k ? '' : 'secondary'}`,
    onclick: () => { CHAMBER_KEY = k; render(state); },
  }, k === 'hor' ? 'House of Reps' : 'Senate')));
  head.appendChild(toggle);
  wrap.appendChild(head);

  const members = state.politicians.filter((p) => p.chamber === CHAMBER_KEY);
  const counts = {};
  members.forEach((m) => (counts[m.party] = (counts[m.party] || 0) + 1));
  const majNeeded = Math.floor(members.length / 2) + 1;
  const govSeats = state.gov.parties.reduce((a, p) => a + (counts[p] || 0), 0);
  wrap.appendChild(el('div', { class: 'majline' },
    `${members.length} seats · majority needs ${majNeeded} · government holds ${govSeats}`));

  wrap.appendChild(hemicycle(state, members));

  // legend
  const legend = el('div', { class: 'chamber-legend' });
  [...PARTIES].filter((p) => counts[p.id]).sort((a, b) => counts[b.id] - counts[a.id]).forEach((p) =>
    legend.appendChild(el('div', { class: 'lg' },
      el('span', { class: 'sw', style: `background:${p.colour}` }), `${p.short} ${counts[p.id]}`)));
  wrap.appendChild(legend);
  return wrap;
}

// Build a tilted hemicycle of seats, sorted left→right by ideology so the
// chamber reads like a real seating plan; the PM and the player are highlighted.
function hemicycle(state, members) {
  const stage = el('div', { class: 'chamber-stage' });
  const plane = el('div', { class: 'hemi-plane' });
  const W = 760, H = 420;

  // sort members by ideology (progressive→conservative)
  const sorted = [...members].sort((a, b) => (a.econ + a.soc) - (b.econ + b.soc));
  const N = sorted.length;

  // generate ring slots until we have >= N, then trim
  const rings = [];
  let total = 0, ring = 0;
  const innerR = 70, step = 30;
  while (total < N && ring < 14) {
    const r = innerR + ring * step;
    const circ = Math.PI * r;             // half-circumference
    const count = Math.max(6, Math.floor(circ / 22));
    rings.push({ r, count, z: ring * 9 });
    total += count; ring++;
  }
  // collect slots with angle, sort by angle (left to right), then assign members
  const slots = [];
  rings.forEach((rg) => {
    for (let i = 0; i < rg.count; i++) {
      const ang = Math.PI - (Math.PI * (i + 0.5)) / rg.count; // PI(left)..0(right)
      slots.push({ ang, r: rg.r, z: rg.z });
    }
  });
  slots.sort((a, b) => b.ang - a.ang);     // left (PI) first
  // keep N slots spread across the arc
  const stepKeep = slots.length / N;
  const chosen = [];
  for (let i = 0; i < N; i++) chosen.push(slots[Math.floor(i * stepKeep)]);

  chosen.forEach((s, i) => {
    const m = sorted[i];
    const p = partyById(m.party);
    const cx = W / 2 + s.r * Math.cos(s.ang);
    const cy = H - s.r * Math.sin(s.ang);
    const cls = 'hemi-seat' + (m.rank === 'pm' ? ' pm' : '') + (m.isPlayer ? ' player' : '');
    plane.appendChild(el('div', {
      class: cls,
      style: `left:${cx}px;top:${cy}px;background:${p.colour};transform:translateZ(${s.z}px)`,
      title: `${m.name} (${p.short})${m.rank === 'pm' ? ' — PM' : ''}${m.seat?.id ? ' · ' + m.seat.id : ''}`,
    }));
  });
  plane.appendChild(el('div', { class: 'speaker-dais' }, 'Speaker'));
  stage.appendChild(plane);
  return stage;
}

// --- Elections ---
let ELEC_TAB = 'intention';
function viewElections(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '🗳️ Elections'));
  const ticksTo = state.nextElection - state.tick;
  pad.appendChild(el('p', { class: 'muted' }, `Next federal election: ${fmtDate(state.nextElection)} (${ticksTo} months).`));

  // national 2PP headline
  const tppAlp = state.tpp ?? 50, tppCoal = 100 - tppAlp;
  pad.appendChild(el('h3', {}, 'Two-party-preferred (national)'));
  pad.appendChild(el('div', { class: 'tpp-bar' },
    el('div', { class: 'seg', style: `width:${tppAlp}%;background:${partyById('alp').colour}` }, `ALP ${tppAlp.toFixed(1)}%`),
    el('div', { class: 'seg', style: `width:${tppCoal}%;background:${partyById('lib').colour}` }, `L/NP ${tppCoal.toFixed(1)}%`)));

  // tabs
  const tabs = el('div', { style: 'margin:12px 0;display:flex;gap:6px;flex-wrap:wrap' });
  [['map', 'Results map'], ['intention', 'Voting intention'], ['pendulum', 'Pendulum'], ['results', 'Seat results'], ['referendums', 'Referendums']]
    .forEach(([k, lbl]) => tabs.appendChild(el('button', {
      class: `btn small ${ELEC_TAB === k ? '' : 'secondary'}`, onclick: () => { sfx('tab'); ELEC_TAB = k; render(state); },
    }, lbl)));
  pad.appendChild(tabs);

  if (ELEC_TAB === 'map') tabMap(state, pad);
  else if (ELEC_TAB === 'intention') tabIntention(state, pad);
  else if (ELEC_TAB === 'pendulum') tabPendulum(state, pad);
  else if (ELEC_TAB === 'results') tabResults(state, pad);
  else if (ELEC_TAB === 'referendums') tabReferendums(state, pad);

  pad.appendChild(el('div', { class: 'card', style: 'margin-top:14px' },
    el('div', { class: 'row-between' },
      el('div', {}, el('b', {}, 'Snap election'), el('div', { class: 'muted' }, 'Call an early election (resets the clock).')),
      el('button', { class: 'btn', onclick: () => API.callElection() }, 'Call Election'))));
  return pad;
}

function tabMap(state, pad) {
  pad.appendChild(el('p', { class: 'muted' }, 'States coloured by the party holding the most federal seats there. Click a state for detail.'));
  const box = el('div', { style: 'height:420px' });
  const map = buildAusMap({
    colorOf: (code) => partyColour(stateLeadParty(state, code)),
    onClick: (code) => stateModal(state, STATES.find((s) => s.code === code)),
  });
  box.appendChild(map.el);
  pad.appendChild(box);
  pad.appendChild(partyLegend(state));
}

function tabIntention(state, pad) {
  pad.appendChild(el('h3', {}, 'First preferences'));
  for (const p of [...PARTIES].sort((a, b) => state.support[b.id] - state.support[a.id])) {
    const v = state.support[p.id];
    pad.appendChild(el('div', { class: 'slider-row' },
      el('label', {}, el('span', {}, p.name), el('span', {}, fmtPct(v))),
      el('div', { class: 'm-bar' }, el('div', { class: 'm-fill', style: `width:${clamp(v * 2.2)}%;background:${p.colour}` }))));
  }
  const last = state._transient?.lastElection;
  if (last) {
    pad.appendChild(el('h3', {}, 'Last election — seats won'));
    const t = el('table', { class: 'data' });
    t.appendChild(el('tr', {}, el('th', {}, 'Party'), el('th', {}, 'House'), el('th', {}, 'Senate'), el('th', {}, 'FP %')));
    for (const p of [...PARTIES].sort((a, b) => last.seats[b.id].hor - last.seats[a.id].hor)) {
      t.appendChild(el('tr', {},
        el('td', {}, el('span', { class: 'tag', style: `background:${p.colour}` }, p.short)),
        el('td', {}, String(last.seats[p.id].hor)), el('td', {}, String(last.seats[p.id].senate)),
        el('td', {}, fmtPct(last.support[p.id]))));
    }
    pad.appendChild(t);
  }
}

function tabPendulum(state, pad) {
  const pen = buildPendulum(state);
  pad.appendChild(el('h3', {}, 'The electoral pendulum'));
  pad.appendChild(el('p', { class: 'muted' }, 'Seats ranked by margin — the ones at the top fall first on a swing.'));
  const grid = el('div', { class: 'pendulum' });
  grid.appendChild(pendCol('Government seats', pen.govSide, state));
  grid.appendChild(pendCol('Opposition & crossbench', pen.oppSide, state));
  pad.appendChild(grid);
}
function pendCol(title, rows, state) {
  const col = el('div', { class: 'col' });
  col.appendChild(el('h4', {}, title));
  rows.slice(0, 30).forEach((r) => {
    const p = partyById(r.held);
    col.appendChild(el('div', { class: `pend-row ${r.status === 'marginal' ? 'status-marginal' : ''}` },
      el('span', {}, el('span', { class: 'pill', style: `background:${p.colour}` }), `${r.name} (${r.state})`),
      el('span', { class: 'mg' }, `${p.short} ${r.margin.toFixed(1)}%`)));
  });
  return col;
}

let SEAT_FILTER = '';
function tabResults(state, pad) {
  pad.appendChild(el('h3', {}, `All 151 divisions`));
  const search = el('input', { class: 'seat-search', type: 'text', placeholder: 'Search a seat or state…', value: SEAT_FILTER });
  search.addEventListener('input', () => { SEAT_FILTER = search.value; renderResultsTable(); });
  pad.appendChild(search);
  const holder = el('div', {});
  pad.appendChild(holder);
  function renderResultsTable() {
    holder.innerHTML = '';
    const f = SEAT_FILTER.toLowerCase();
    const rows = state.electorates
      .filter((e) => !f || e.name.toLowerCase().includes(f) || e.state.toLowerCase().includes(f))
      .sort((a, b) => a.margin - b.margin);
    const t = el('table', { class: 'data' });
    t.appendChild(el('tr', {}, el('th', {}, 'Seat'), el('th', {}, 'State'), el('th', {}, 'Held by'), el('th', {}, 'Margin'), el('th', {}, 'Status'), el('th', {}, 'Member')));
    rows.slice(0, 200).forEach((e) => {
      const p = partyById(e.held);
      const mp = e.mpId ? polById(state, e.mpId) : null;
      t.appendChild(el('tr', {},
        el('td', {}, e.name), el('td', {}, e.state),
        el('td', {}, el('span', { class: 'tag', style: `background:${p.colour}` }, p.short)),
        el('td', {}, `${e.margin.toFixed(1)}%`), el('td', {}, seatStatus(e.margin)),
        el('td', {}, mp ? mp.name + (mp.isPlayer ? ' (you)' : '') : '—')));
    });
    holder.appendChild(t);
  }
  renderResultsTable();
}

function tabReferendums(state, pad) {
  pad.appendChild(el('h3', {}, 'Referendums'));
  pad.appendChild(el('p', { class: 'muted' }, 'Carried only by a double majority: a national majority AND a majority of states (4 of 6).'));
  const canCall = API.canLegislate();
  // active/past
  for (const r of [...state.referendums].reverse()) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'row-between' },
      el('div', {}, el('b', {}, r.title), el('div', { class: 'muted' }, r.desc)),
      el('span', { class: 'tag', style: `background:${r.status === 'passed' ? 'var(--good)' : r.status === 'failed' ? 'var(--bad)' : '#6b7780'}` }, r.status.toUpperCase())));
    if (r.status === 'pending') card.appendChild(el('div', { class: 'muted' }, `National vote: ${fmtDate(r.voteAt)}`));
    else card.appendChild(el('div', { class: 'muted' }, `${r.nationalYes.toFixed(1)}% Yes · ${r.statesCarried}/6 states`));
    pad.appendChild(card);
  }
  if (canCall) {
    pad.appendChild(el('h3', {}, 'Call a referendum'));
    const grid = el('div', { class: 'grid2' });
    for (const tpl of REFERENDUM_CATALOGUE) {
      const pending = state.referendums.some((r) => r.refId === tpl.id && r.status === 'pending');
      grid.appendChild(el('div', { class: 'card' },
        el('b', {}, tpl.title), el('div', { class: 'muted' }, tpl.desc),
        el('button', { class: 'btn small', disabled: pending || null, onclick: () => API.proposeReferendum(tpl.id) },
          pending ? 'Vote pending' : 'Call referendum')));
    }
    pad.appendChild(grid);
  } else {
    pad.appendChild(el('p', { class: 'muted' }, 'Only the government (Minister/PM) can call a referendum.'));
  }
}

/* ---------------------------------------------------- live election night */
export function showElectionNight(state, result, onDone) {
  const total = result.seatResults.length;
  const majority = Math.floor(total / 2) + 1;
  const body = el('div', { class: 'enight' });
  const tally = { num: el('div', {}), seg: el('div', { class: 'tpp-bar' }), counted: el('div', { class: 'counted' }), feed: el('div', { class: 'seat-feed' }) };

  const head = el('div', { class: 'tally-big' });
  const govBox = el('div', { class: 'side' });
  const oppBox = el('div', { class: 'side', style: 'text-align:right' });
  const govNum = el('div', { class: 'num', style: `color:${partyById('alp').colour}` }, '0');
  const oppNum = el('div', { class: 'num', style: `color:${partyById('lib').colour}` }, '0');
  govBox.appendChild(govNum); govBox.appendChild(el('div', { class: 'lbl' }, 'Labor + allies'));
  oppBox.appendChild(oppNum); oppBox.appendChild(el('div', { class: 'lbl' }, 'Coalition + others'));
  head.appendChild(govBox); head.appendChild(el('div', { style: 'align-self:center;opacity:.6' }, `${majority} for majority`)); head.appendChild(oppBox);
  body.appendChild(head);
  body.appendChild(tally.seg);
  body.appendChild(tally.counted);

  // live 3D results map (states colour in as seats are counted)
  const stateCounts = {}; STATES.forEach((s) => (stateCounts[s.code] = {}));
  const leadColour = (code) => {
    const t = stateCounts[code]; const coal = (t.lib || 0) + (t.nat || 0);
    let best = null, bestN = 0; for (const [p, n] of Object.entries(t)) if (n > bestN) { best = p; bestN = n; }
    if (!best) return '#cdd6e2';
    if (coal >= bestN) best = 'lib';
    return partyColour(best);
  };
  const mapBox = el('div', { class: 'enight-map' });
  const liveMap = buildAusMap({ colorOf: () => '#cdd6e2' });
  mapBox.appendChild(liveMap.el);
  body.appendChild(mapBox);
  body.appendChild(tally.feed);

  $('#modal-title').textContent = '🗳️ Election Night — Live Count';
  const mb = $('#modal-body'); mb.innerHTML = ''; mb.appendChild(body);
  const ma = $('#modal-actions'); ma.innerHTML = '';
  $('#modal-host').classList.remove('hidden');

  // reveal seats progressively in "report order"
  const order = [...result.seatResults].sort((a, b) => a.reportOrder - b.reportOrder);
  let i = 0;
  const counts = {}; PARTIES.forEach((p) => (counts[p.id] = 0));
  const isLeft = (id) => id === 'alp' || id === 'grn' || id === 'tea';
  const timer = setInterval(() => {
    const batch = Math.max(1, Math.round(total / 40));
    for (let b = 0; b < batch && i < order.length; b++, i++) {
      const s = order[i];
      counts[s.held]++;
      stateCounts[s.state][s.held] = (stateCounts[s.state][s.held] || 0) + 1;
      const p = partyById(s.held);
      sfx('count');
      const row = el('div', { class: 'fr' },
        el('span', {}, `${s.name} (${s.state})`),
        el('span', { class: s.gain ? 'gain' : '' }, `${p.short}${s.gain ? ' GAIN' : ''} · swing ${s.swing >= 0 ? '+' : ''}${s.swing.toFixed(1)}`));
      tally.feed.prepend(row);
    }
    liveMap.update(leadColour);
    const left = sum2(counts, isLeft), right = i - left;
    govNum.textContent = String(left); oppNum.textContent = String(right);
    const lp = (left / Math.max(1, i)) * 100;
    tally.seg.innerHTML = '';
    tally.seg.appendChild(el('div', { class: 'seg', style: `width:${lp}%;background:${partyById('alp').colour}` }, left));
    tally.seg.appendChild(el('div', { class: 'seg', style: `width:${100 - lp}%;background:${partyById('lib').colour}` }, right));
    tally.counted.textContent = `${i} of ${total} seats counted (${Math.round((i / total) * 100)}%)`;
    if (i >= order.length) {
      clearInterval(timer);
      const pm = state.gov.pm ? polName(state, state.gov.pm) : 'a hung parliament';
      tally.counted.textContent = `Count complete. ${govLabel(state.gov)} ${state.gov.majority ? 'wins majority government' : 'forms minority government'} — ${pm} to be PM.`;
      ma.appendChild(el('button', { class: 'btn', onclick: () => { closeModal(); onDone?.(); } }, 'Continue'));
    }
  }, 140);
}
function sum2(counts, pred) { let n = 0; for (const k in counts) if (pred(k)) n += counts[k]; return n; }

// --- Legislation ---
const STAGE_FLOW = ['house', 'senate', 'assent'];
function viewLegislation(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '⚖️ Legislation'));
  const inGov = API.canLegislate();
  const canIntro = API.canIntroduce();
  pad.appendChild(el('p', { class: 'muted' },
    inGov ? 'As a member of government you can introduce bills, set the budget and repeal laws.'
      : canIntro ? 'As a backbench MP you can introduce Private Member\'s Bills — harder to pass without the government\'s numbers.'
      : 'Win a seat in Parliament to introduce and shepherd your own bills.'));

  // bill builder
  if (canIntro) billBuilder(state, pad, inGov);

  // active bills with full process tracker
  pad.appendChild(el('h3', {}, `Bills before Parliament (${state.bills.length})`));
  if (!state.bills.length) pad.appendChild(el('p', { class: 'muted' }, 'No bills currently in progress.'));
  for (const b of state.bills) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'row-between' },
      el('div', {}, el('b', {}, b.title), el('div', { class: 'muted' }, b.desc + (b.privateMember ? ' · Private Member\'s Bill' : ''))),
      el('span', { class: 'tag', style: 'background:#6b7780' }, b.stage.toUpperCase())));
    card.appendChild(stageTracker(b));
    card.appendChild(el('div', { class: 'muted' }, effectSummary(effectOf(b))));
    if (b.votes.house) card.appendChild(el('div', { class: 'muted' }, `House vote: ${b.votes.house.yes}–${b.votes.house.no} ${b.votes.house.pass ? '✅' : '❌'}`));
    if (b.votes.senate) card.appendChild(el('div', { class: 'muted' }, `Senate vote: ${b.votes.senate.yes}–${b.votes.senate.no} ${b.votes.senate.pass ? '✅' : '❌'}`));
    if (canIntro && b.stage !== 'failed') {
      const lbl = b.stage === 'assent' ? 'Grant Royal Assent' : b.stage === 'senate' ? 'Put to the Senate' : 'Put to the House';
      card.appendChild(el('button', { class: 'btn small', onclick: () => API.advanceBill(b.id) }, lbl));
    }
    pad.appendChild(card);
  }

  // catalogue of ready-made reforms
  if (canIntro) {
    pad.appendChild(el('h3', {}, 'Ready-made reforms'));
    const grid = el('div', { class: 'grid2' });
    for (const pol of POLICY_CATALOGUE) {
      const already = state.laws.some((l) => l.policyId === pol.id);
      grid.appendChild(el('div', { class: 'card' },
        el('b', {}, pol.title),
        el('div', { class: 'muted' }, pol.desc),
        el('div', { class: 'muted' }, effectSummary(pol)),
        el('button', { class: 'btn small', disabled: already || null, onclick: () => API.proposePolicy(pol.id) },
          already ? 'Already law' : 'Introduce')));
    }
    pad.appendChild(grid);
  }

  // enacted laws
  pad.appendChild(el('h3', {}, `Laws in force (${state.laws.length})`));
  for (const law of [...state.laws].reverse()) {
    pad.appendChild(el('div', { class: 'card' },
      el('div', { class: 'row-between' },
        el('div', {}, el('b', {}, law.title), el('div', { class: 'muted' }, `Enacted ${fmtDate(law.enacted)}`)),
        inGov ? el('button', { class: 'btn small bad', onclick: () => API.repeal(law.id) }, 'Repeal') : el('span'))));
  }
  return pad;
}

// The interactive "draft your own law" builder.
let BILL_DRAFT = { title: '', category: 'health', intensity: 5 };
function billBuilder(state, pad, inGov) {
  pad.appendChild(el('h3', {}, '📝 Draft a Bill'));
  const card = el('div', { class: 'card' });
  const titleInput = el('input', { type: 'text', placeholder: 'Bill title, e.g. "Free TAFE Act"', value: BILL_DRAFT.title, style: 'width:100%;margin-bottom:10px' });
  titleInput.addEventListener('input', () => (BILL_DRAFT.title = titleInput.value));
  card.appendChild(titleInput);

  // category chooser
  const catGrid = el('div', { class: 'choice-grid', style: 'margin-bottom:10px' });
  BILL_CATEGORIES.forEach((c) => {
    const ch = el('div', { class: 'choice' + (BILL_DRAFT.category === c.id ? ' sel' : ''), style: 'color:var(--ink)', onclick: () => {
      sfx('hover'); BILL_DRAFT.category = c.id; render(state);
    } }, `${c.icon} ${c.name}`);
    catGrid.appendChild(ch);
  });
  card.appendChild(catGrid);

  // intensity slider with live projected effects
  const eff = customEffect(BILL_DRAFT.category, BILL_DRAFT.intensity);
  const out = el('span', {}, `Strength ${BILL_DRAFT.intensity}/10`);
  const slider = el('input', { type: 'range', min: '1', max: '10', value: String(BILL_DRAFT.intensity) });
  slider.addEventListener('input', () => { BILL_DRAFT.intensity = +slider.value; out.textContent = `Strength ${slider.value}/10`; updateProj(); });
  card.appendChild(el('div', { class: 'slider-row' }, el('label', {}, el('span', {}, 'Intensity & funding'), out), slider));
  const proj = el('div', { class: 'muted' });
  function updateProj() { proj.textContent = 'Projected: ' + effectSummary(customEffect(BILL_DRAFT.category, BILL_DRAFT.intensity)); }
  updateProj();
  card.appendChild(proj);

  card.appendChild(el('div', { style: 'margin-top:10px' },
    el('button', { class: 'btn', onclick: () => {
      API.proposeCustom({ title: BILL_DRAFT.title.trim(), category: BILL_DRAFT.category, intensity: BILL_DRAFT.intensity });
      BILL_DRAFT.title = '';
    } }, inGov ? 'Introduce Government Bill' : 'Introduce Private Member\'s Bill')));
  pad.appendChild(card);
}

function stageTracker(b) {
  const wrap = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0' });
  const names = { house: 'House', senate: 'Senate', assent: 'Assent' };
  const curIdx = STAGE_FLOW.indexOf(b.stage);
  STAGE_FLOW.forEach((st, i) => {
    const done = i < curIdx || b.stage === 'enacted';
    const cur = i === curIdx;
    const colour = done ? 'var(--good)' : cur ? 'var(--accent)' : '#c3cdda';
    wrap.appendChild(el('span', { class: 'tag', style: `background:${colour}` }, `${done ? '✓ ' : ''}${names[st]}`));
  });
  return wrap;
}

function effectSummary(pol) {
  if (!pol) return '';
  const parts = [];
  for (const [k, v] of Object.entries(pol.impact || {})) parts.push(`${k} ${v > 0 ? '+' : ''}${v}`);
  if (pol.cost) parts.push(`+$${pol.cost}B/yr ${pol.line}`);
  for (const [k, v] of Object.entries(pol.taxDelta || {})) parts.push(`${k} tax ${v > 0 ? '+' : ''}${round(v * 100)}pt`);
  return parts.join(' · ') || 'symbolic / no direct fiscal effect';
}

// --- Budget & Tax ---
function viewBudget(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '💵 Budget & Taxation'));
  const canEdit = API.canLegislate();
  const b = state.budget;
  pad.appendChild(el('p', {},
    `Revenue ${fmtMoney(b.revenue)} · Spending ${fmtMoney(totalSpend(state))} · `,
    el('b', { style: `color:${b.lastBalance >= 0 ? 'var(--good)' : 'var(--bad)'}` },
      `${b.lastBalance >= 0 ? 'Surplus' : 'Deficit'} ${fmtMoney(Math.abs(b.lastBalance))}`)));
  if (!canEdit) pad.appendChild(el('p', { class: 'muted' }, 'Only the Treasurer or PM can change the budget.'));

  pad.appendChild(el('h3', {}, 'Spending (A$ billions / year)'));
  for (const [cat, val] of Object.entries(b.spend)) {
    pad.appendChild(sliderRow(cat[0].toUpperCase() + cat.slice(1), val, 0, 320, 1,
      (nv) => API.setSpend(cat, nv), `$${round(val)}B`, !canEdit));
  }

  pad.appendChild(el('h3', {}, 'Tax rates'));
  const taxLabels = { income: 'Income (avg)', company: 'Company', gst: 'GST', capital: 'Capital Gains', carbon: 'Carbon', resource: 'Resources' };
  for (const [t, val] of Object.entries(b.tax)) {
    pad.appendChild(sliderRow(taxLabels[t] || t, val * 100, 0, 60, 1,
      (nv) => API.setTax(t, nv / 100), `${round(val * 100)}%`, !canEdit));
  }
  return pad;
}
function sliderRow(label, value, min, max, step, onInput, valText, disabled) {
  const row = el('div', { class: 'slider-row' });
  const out = el('span', {}, valText);
  row.appendChild(el('label', {}, el('span', {}, label), out));
  const input = el('input', { type: 'range', min, max, step, value });
  if (disabled) input.disabled = true;
  input.addEventListener('change', () => onInput(+input.value));
  input.addEventListener('input', () => { out.textContent = String(round(+input.value)); });
  row.appendChild(input);
  return row;
}

// --- Parties ---
function viewParties(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '👥 Parties & Politicians'));
  for (const p of [...PARTIES].sort((a, b) => state.support[b.id] - state.support[a.id])) {
    const members = state.politicians.filter((m) => m.party === p.id && m.chamber);
    const top = [...members].sort((a, b) => b.popularity - a.popularity).slice(0, 4);
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'row-between' },
      el('div', {}, el('span', { class: 'tag', style: `background:${p.colour}` }, p.short), ' ', el('b', {}, p.name)),
      el('div', { class: 'muted' }, `${fmtPct(state.support[p.id])} · ${members.length} parliamentarians`)));
    const ideo = `Economic ${p.econ < 0 ? 'left' : 'right'} (${round(p.econ, 2)}) · Social ${p.soc < 0 ? 'progressive' : 'conservative'} (${round(p.soc, 2)})`;
    card.appendChild(el('div', { class: 'muted' }, ideo));
    if (top.length) {
      const ul = el('div', {});
      top.forEach((m) => ul.appendChild(el('div', { class: 'pol-link', onclick: () => polModal(state, m) },
        `• ${m.name}${m.dynasty ? ' 👑' : ''} — ${m.traits.join(', ')} (pop ${m.popularity})${m.rank === 'pm' ? ' [PM]' : ''}`)));
      card.appendChild(ul);
    }
    pad.appendChild(card);
  }
  return pad;
}

// --- Career ---
function viewCareer(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '🎖️ Your Career'));
  const pl = state.player;
  if (!pl) { pad.appendChild(el('p', {}, 'You are observing the simulation.')); return pad; }

  // status card
  const pol = pl.polId ? polById(state, pl.polId) : null;
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'row-between' },
    el('div', {}, el('b', {}, pl.name), el('div', { class: 'muted' }, playerRoleLabel(state))),
    el('div', { class: 'muted' }, `Influence ${pl.influence}/10`)));
  card.appendChild(el('div', { class: 'grid3' },
    stat('Reputation', round(pl.reputation)),
    stat('War chest', fmtMoney(pl.money)),
    stat('Internal numbers', pl.numbers ? round(pl.numbers) : '—')));
  if (pl.partyId) card.appendChild(el('div', { class: 'muted', style: 'margin-top:6px' },
    `Member of `, el('span', { class: 'tag', style: `background:${partyById(pl.partyId).colour}` }, partyById(pl.partyId).short)));
  pad.appendChild(card);

  // ladder
  pad.appendChild(el('h3', {}, 'The ladder'));
  const ri = currentRankIndex(state);
  const ladder = el('div', {});
  RANKS.forEach((r, i) => ladder.appendChild(el('div', { class: 'muted' },
    `${i <= ri ? '✅' : '▫️'} ${r.name}`)));
  pad.appendChild(ladder);

  // actions
  pad.appendChild(el('h3', {}, 'Actions'));
  for (const a of availableActions(state)) {
    pad.appendChild(el('div', { class: 'card' },
      el('div', { class: 'row-between' },
        el('div', {}, el('b', {}, a.label), el('div', { class: 'muted' }, a.desc + (a.note ? ` (${a.note})` : ''))),
        el('button', { class: 'btn small', disabled: a.enabled ? null : true, onclick: () => onCareerAction(state, a.id) }, 'Do it'))));
  }

  // legacy score banner
  const ls = legacyScore(state);
  pad.appendChild(el('h3', {}, 'Legacy'));
  pad.appendChild(el('div', { class: 'score-banner' },
    el('div', { class: 'score-grade' }, ls.grade),
    el('div', {}, el('div', { style: 'font-size:26px;font-weight:900' }, ls.score.toLocaleString()),
      el('div', { class: 'muted', style: 'color:#b9c6d6' }, `Legacy score · ${ls.years} years · avg national index ${ls.avgMetric} · ${state.achievements.length}/${ACHIEVEMENTS.length} achievements`))));

  // achievements grid
  pad.appendChild(el('h3', {}, 'Achievements'));
  const grid = el('div', { class: 'ach-grid' });
  for (const a of ACHIEVEMENTS) {
    const got = state.achievements?.includes(a.id);
    grid.appendChild(el('div', { class: `ach ${got ? 'unlocked' : ''}` },
      el('div', { class: 'ai' }, a.icon), el('div', { class: 'an' }, a.name), el('div', { class: 'ad' }, got ? a.desc : '🔒 Locked')));
  }
  pad.appendChild(grid);
  return pad;
}
function stat(label, val) { return el('div', { class: 'card', style: 'margin:0' }, el('div', { class: 'muted' }, label), el('div', { style: 'font-size:18px;font-weight:700' }, String(val))); }

function onCareerAction(state, id) {
  if (id === 'join_party') {
    const body = el('div', {});
    body.appendChild(el('p', { class: 'muted' }, 'Choose a party and home state.'));
    let chosenParty = 'alp', chosenState = 'NSW';
    const psel = el('select', {}); PARTIES.filter((p) => p.id !== 'ind').forEach((p) => psel.appendChild(el('option', { value: p.id }, p.name)));
    psel.addEventListener('change', () => (chosenParty = psel.value));
    const ssel = el('select', {}); STATES.forEach((s) => ssel.appendChild(el('option', { value: s.code }, s.name)));
    ssel.addEventListener('change', () => (chosenState = ssel.value));
    body.appendChild(el('div', { class: 'slider-row' }, el('label', {}, 'Party'), psel));
    body.appendChild(el('div', { class: 'slider-row' }, el('label', {}, 'Home state'), ssel));
    modal('Join a Party', body, [
      { label: 'Cancel', kind: 'secondary' },
      { label: 'Join', run: () => API.careerAction('join_party', { partyId: chosenParty, homeState: chosenState }) },
    ]);
    return;
  }
  if (id === 'run') {
    const pl = state.player;
    const seats = state.electorates.filter((e) => e.state === (pl.homeState || 'NSW')).sort((a, b) => a.margin - b.margin);
    let chosen = seats[0]?.name;
    const body = el('div', {});
    body.appendChild(el('p', { class: 'muted' }, `Choose a seat to contest in ${pl.homeState || 'your state'}. Marginal seats are easier to flip; safe seats held by rivals are hard.`));
    const sel = el('select', { style: 'width:100%;padding:6px' });
    seats.forEach((e) => {
      const p = partyById(e.held);
      sel.appendChild(el('option', { value: e.name }, `${e.name} — ${p.short} ${e.margin.toFixed(1)}% (${seatStatus(e.margin)})`));
    });
    sel.addEventListener('change', () => (chosen = sel.value));
    body.appendChild(sel);
    modal('Stand for Election', body, [
      { label: 'Cancel', kind: 'secondary' },
      { label: 'Nominate', run: () => API.careerAction('run', { electorate: chosen }) },
    ]);
    return;
  }
  API.careerAction(id);
}

/* small reusable horizontal meter */
function meter(label, value, colour, suffix = '') {
  return el('div', { class: 'slider-row' },
    el('label', {}, el('span', {}, label), el('span', {}, `${round(value)}${suffix}`)),
    el('div', { class: 'm-bar' }, el('div', { class: 'm-fill', style: `width:${clamp(value)}%;background:${colour}` })));
}

// --- Economy, Industry & Energy ---
function viewEconomy(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '🏭 Economy, Industry & Energy'));
  const e = state.economy;
  pad.appendChild(el('div', { class: 'grid3' },
    stat('GDP', fmtMoney(e.gdp)), stat('Growth', fmtPct(e.growth)), stat('Inflation', fmtPct(e.inflation)),
    stat('Unemployment', fmtPct(e.unemployment)), stat('Cash rate', fmtPct(e.cashRate)), stat('Exports index', round(state._exports ?? 50))));

  pad.appendChild(el('h3', {}, 'Industries'));
  const grid = el('div', { class: 'grid2' });
  for (const ind of topIndustries(state)) {
    const col = ind.health >= 60 ? 'var(--good)' : ind.health >= 40 ? 'var(--warn)' : 'var(--bad)';
    grid.appendChild(el('div', { class: 'card', style: 'margin:0' },
      el('div', { class: 'row-between' },
        el('b', {}, `${ind.icon} ${ind.name}`),
        el('span', { class: 'muted' }, `${(ind.share * 100).toFixed(1)}% GDP · ${ind.growth >= 0 ? '+' : ''}${ind.growth.toFixed(1)}%`)),
      el('div', { class: 'm-bar', style: 'margin-top:6px' }, el('div', { class: 'm-fill', style: `width:${ind.health}%;background:${col}` }))));
  }
  pad.appendChild(grid);

  pad.appendChild(el('h3', {}, 'Energy grid'));
  const en = state.energy;
  pad.appendChild(el('div', { class: 'grid3' },
    stat('Renewables', renewableShare(state).toFixed(0) + '%'),
    stat('Reliability', round(en.reliability) + '%'),
    stat('Emissions', round(en.emissions)),
    stat('Price index', round(en.price)),
    stat('Nuclear', en.nuclearLegal ? 'Legal' : 'Banned'),
    stat('Mix', '')));
  const ENERGY_COL = { coal: '#4a3b30', gas: '#d68a3a', hydro: '#3a78c2', solar: '#f2c12e', wind: '#5fb88f', battery: '#8a6fd4', nuclear: '#cf4ec0' };
  const mixSorted = Object.entries(en.mix).sort((a, b) => b[1] - a[1]);
  const split = el('div', { style: 'display:flex;gap:18px;align-items:center;flex-wrap:wrap' });
  const dcanvas = el('canvas');
  split.appendChild(dcanvas);
  const bars = el('div', { style: 'flex:1;min-width:240px' });
  for (const [id, share] of mixSorted) bars.appendChild(meter(id[0].toUpperCase() + id.slice(1), share * 100, ENERGY_COL[id] || '#888', '%'));
  split.appendChild(bars);
  pad.appendChild(split);
  queueChart(() => donut(dcanvas, mixSorted.map(([id, v]) => ({ label: id, value: v, color: ENERGY_COL[id] || '#888' })), { size: 160 }));
  return pad;
}

// --- High Court & Judiciary ---
function viewCourts(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '👨‍⚖️ The High Court of Australia'));
  const bal = courtBalance(state);
  pad.appendChild(el('p', { class: 'muted' },
    `Bench balance: ${bal < -0.15 ? 'literalist / conservative' : bal > 0.15 ? 'progressive / expansive' : 'finely balanced'} (${bal.toFixed(2)}). ` +
    `${state.courts.strikes} laws struck down to date.`));

  pad.appendChild(el('h3', {}, 'The seven Justices'));
  const grid = el('div', { class: 'grid2' });
  for (const j of state.courts.justices) {
    const lean = j.interpretation < -0.15 ? 'Literalist' : j.interpretation > 0.15 ? 'Progressive' : 'Centrist';
    grid.appendChild(el('div', { class: 'card', style: 'margin:0' },
      el('div', { class: 'row-between' },
        el('b', {}, `${j.name}${j.chief ? ' (Chief Justice)' : ''}`),
        el('span', { class: 'muted' }, `age ${Math.floor(j.age)}`)),
      el('div', { class: 'muted' }, `${lean} · appointed by ${j.appointedBy === 'historic' ? 'former govt' : (partyById(j.appointedBy)?.short || j.appointedBy)}`)));
  }
  pad.appendChild(grid);

  pad.appendChild(el('h3', {}, 'Constitutional cases'));
  const cases = [...state.courts.cases].reverse().slice(0, 20);
  if (!cases.length) pad.appendChild(el('p', { class: 'muted' }, 'No cases before the Court.'));
  for (const c of cases) {
    const colour = c.status === 'struck' ? 'var(--bad)' : c.status === 'upheld' ? 'var(--good)' : '#6b7780';
    pad.appendChild(el('div', { class: 'card' },
      el('div', { class: 'row-between' },
        el('div', {}, el('b', {}, c.title), el('div', { class: 'muted' }, c.vote ? `Decided ${c.vote}` : `Hearing ${fmtDate(c.hearAt)}`)),
        el('span', { class: 'tag', style: `background:${colour}` }, c.status.toUpperCase()))));
  }
  return pad;
}

// --- Media, Lobbying & Society ---
function viewSociety(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '📰 Media, Lobbying & Society'));
  const s = state.society;

  pad.appendChild(el('div', { class: 'grid3' },
    stat('Media mood', mediaMood(state).toFixed(0)),
    stat('Social sentiment', s.social.sentiment.toFixed(0)),
    stat('Civil unrest', round(s.unrest))));
  pad.appendChild(meter('Civil unrest', s.unrest, s.unrest > 55 ? 'var(--bad)' : s.unrest > 35 ? 'var(--warn)' : 'var(--good)'));

  pad.appendChild(el('h3', {}, 'Media organisations'));
  const t = el('table', { class: 'data' });
  t.appendChild(el('tr', {}, el('th', {}, 'Outlet'), el('th', {}, 'Type'), el('th', {}, 'Lean'), el('th', {}, 'Reach'), el('th', {}, 'Coverage')));
  for (const o of [...s.media].sort((a, b) => b.reach - a.reach)) {
    const lean = o.lean < -0.2 ? 'Left' : o.lean > 0.2 ? 'Right' : 'Centre';
    const cov = o.narrative > 4 ? '👍 Friendly' : o.narrative < -4 ? '👎 Hostile' : '➖ Neutral';
    t.appendChild(el('tr', {}, el('td', {}, o.name), el('td', {}, o.type), el('td', {}, lean), el('td', {}, `${o.reach}%`), el('td', {}, cov)));
  }
  pad.appendChild(t);

  pad.appendChild(el('h3', {}, 'Social media'));
  pad.appendChild(el('div', { class: 'grid3' },
    stat('Followers', (s.social.followers / 1000).toFixed(1) + 'M'),
    stat('Virality', round(s.social.virality)),
    stat('Disinformation', round(s.social.disinfo))));

  pad.appendChild(el('h3', {}, 'Lobby groups'));
  const grid = el('div', { class: 'grid2' });
  for (const g of [...s.lobby].sort((a, b) => b.influence - a.influence)) {
    grid.appendChild(el('div', { class: 'card', style: 'margin:0' },
      el('div', { class: 'row-between' }, el('b', {}, `${g.icon} ${g.name}`), el('span', { class: 'muted' }, `influence ${g.influence}`)),
      meter('Favour toward government', g.favour, partyById(state.gov.parties[0]).colour)));
  }
  pad.appendChild(grid);
  return pad;
}

// --- Foreign Affairs & Defence ---
function viewWorld(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '🌏 Foreign Affairs, Defence & Intelligence'));
  const w = state.world;
  const canAct = API.canLegislate();
  pad.appendChild(el('p', { class: 'muted' }, `Average diplomatic relations: ${w.avgRelation.toFixed(0)}. ${canAct ? 'You may conduct diplomacy below.' : 'Only the government can conduct foreign policy.'}`));

  pad.appendChild(el('h3', {}, 'Nations'));
  for (const n of [...w.nations].sort((a, b) => b.relation - a.relation)) {
    const col = n.relation > 40 ? 'var(--good)' : n.relation < 0 ? 'var(--bad)' : 'var(--warn)';
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'row-between' },
      el('div', {}, el('b', {}, `${n.flag} ${n.name}`), el('div', { class: 'muted' }, `${n.leader} · ${n.gov} · GDP ${fmtMoney(n.gdp)} · ${n.stance}${n.sanctioned ? ' · SANCTIONED' : ''}`)),
      el('span', { class: 'tag', style: `background:${col}` }, `Rel ${n.relation.toFixed(0)}`)));
    if (canAct) {
      const acts = el('div', { style: 'margin-top:6px;display:flex;gap:6px;flex-wrap:wrap' });
      [['trade', 'Trade deal'], ['treaty', 'Treaty'], ['aid', 'Foreign aid'], ['sanction', 'Sanction']].forEach(([a, lbl]) =>
        acts.appendChild(el('button', { class: `btn small ${a === 'sanction' ? 'bad' : 'secondary'}`, onclick: () => API.foreignAction(n.id, a) }, lbl)));
      card.appendChild(acts);
    }
    pad.appendChild(card);
  }

  pad.appendChild(el('h3', {}, 'Defence forces'));
  const d = w.defence;
  pad.appendChild(meter('Army', d.army, '#5a6b3a'));
  pad.appendChild(meter('Navy', d.navy, '#2f5a8a'));
  pad.appendChild(meter('Air Force', d.airforce, '#3a7a9a'));
  pad.appendChild(meter('Cyber Command', d.cyber, '#8a6fd4'));
  pad.appendChild(meter('Readiness', d.readiness, 'var(--accent)'));

  pad.appendChild(el('h3', {}, 'Intelligence threats'));
  const it = w.intel;
  pad.appendChild(meter('Overall threat', it.threat, 'var(--bad)'));
  pad.appendChild(meter('Foreign interference', it.foreignInterference, 'var(--warn)'));
  pad.appendChild(meter('Cyber threat', it.cyberThreat, 'var(--warn)'));
  pad.appendChild(meter('Terror threat', it.terror, 'var(--warn)'));
  return pad;
}

// Politician detail incl. dynasty/family tree
function polModal(state, pol) {
  const body = el('div', {});
  body.appendChild(el('p', {}, el('span', { class: 'tag', style: `background:${partyById(pol.party).colour}` }, partyById(pol.party).short),
    ` ${pol.seat?.id ? pol.seat.id + ' · ' : ''}${pol.state} · age ${pol.age}${pol.dynasty ? ' · of the ' + pol.dynasty.split(' ').slice(-1)[0] + ' dynasty' : ''}`));
  body.appendChild(el('div', { class: 'grid3' },
    stat('Popularity', pol.popularity), stat('Competence', pol.competence), stat('Scandal risk', pol.scandalRisk)));
  body.appendChild(el('p', { class: 'muted', style: 'margin-top:8px' }, 'Traits: ' + pol.traits.join(', ')));
  body.appendChild(el('p', { class: 'muted' }, `Hidden — ego ${pol.hidden.ego}, greed ${pol.hidden.greed}, loyalty ${pol.hidden.loyalty}, risk ${pol.hidden.risk}`));
  if (pol.family) {
    body.appendChild(el('h3', {}, '👑 Family'));
    if (pol.family.spouse) body.appendChild(el('div', { class: 'muted' }, `Spouse: ${pol.family.spouse}`));
    (pol.family.children || []).forEach((c) => body.appendChild(el('div', { class: 'muted' }, `Child: ${c.name} (age ${Math.floor(c.age)})${c.path && c.path !== 'undecided' ? ' — ' + c.path : ''}`)));
  }
  const dyn = dynastyMembers(state, pol).filter((p) => p.id !== pol.id);
  if (dyn.length) {
    body.appendChild(el('h3', {}, 'Dynasty in parliament'));
    dyn.forEach((p) => body.appendChild(el('div', { class: 'muted' }, `${p.name} — ${partyById(p.party).short}${p.chamber ? ' (' + (p.chamber === 'hor' ? 'House' : 'Senate') + ')' : ''}`)));
  }
  modal(pol.name, body, [{ label: 'Close', kind: 'secondary' }]);
}

// --- History ---
function viewHistory(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '📜 Historical Archive'));
  pad.appendChild(el('p', { class: 'muted' }, `${state.history.length} recorded events since 2026.`));
  const t = el('table', { class: 'data' });
  t.appendChild(el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Event')));
  [...state.history].reverse().slice(0, 200).forEach((h) =>
    t.appendChild(el('tr', {}, el('td', {}, fmtDate(h.tick)), el('td', {}, h.text))));
  pad.appendChild(t);
  return pad;
}

/* --------------------------------------------------------- context panel */
function renderContext(state) {
  $('#ctx-title').textContent = 'Overview';
  const body = $('#ctx-body'); body.innerHTML = '';
  const mood = nationalMood(state);

  // pending crisis takes priority
  if (state.events.length) {
    $('#ctx-title').textContent = '⚠️ Crisis — Your Call';
    const ev = state.events[0];
    body.appendChild(el('div', { class: 'card' }, el('b', {}, `${ev.icon} ${ev.title}`), el('p', { class: 'muted' }, ev.text)));
    ev.choices.forEach((c, i) => body.appendChild(
      el('button', { class: 'btn', style: 'width:100%;margin-bottom:6px', onclick: () => API.resolveEvent(ev.instanceId, i) }, c.label)));
    return;
  }

  body.appendChild(el('div', { class: 'card' },
    el('b', {}, 'National mood'),
    el('div', { class: 'muted' }, `Citizen happiness ${round(mood.happiness)} · Trust in govt ${round(mood.trust)}`)));

  const e = state.economy;
  body.appendChild(el('div', { class: 'card' },
    el('b', {}, 'Economy'),
    el('div', { class: 'muted' }, `Growth ${fmtPct(e.growth)} · Inflation ${fmtPct(e.inflation)}`),
    el('div', { class: 'muted' }, `Cash rate ${fmtPct(e.cashRate)} · Confidence ${round(e.confidence)}`)));

  body.appendChild(el('div', { class: 'card' },
    el('b', {}, 'Government'),
    el('div', { class: 'muted' }, `${govLabel(state.gov)} · PM ${state.gov.pm ? polName(state, state.gov.pm) : '—'}`),
    el('div', { class: 'muted' }, `Approval ${round(approval(state))}%`)));

  // recent ticker
  body.appendChild(el('b', {}, 'Latest news'));
  state.log.slice(0, 8).forEach((h) => body.appendChild(el('div', { class: 'muted', style: 'margin:3px 0' }, `${fmtDate(h.tick)} — ${h.text}`)));
}

/* ============================================================
   Title screen / main menu / character creation / settings
   ============================================================ */
const $menu = () => document.getElementById('menu-host');
export function hideMenu() { const m = $menu(); m.classList.add('hidden'); m.innerHTML = ''; }

export function showMainMenu({ onStart, onResume, hasSave }) {
  const m = $menu();
  const card = el('div', { class: 'menu-card' },
    el('span', { class: 'menu-flag' }, '🇦🇺'),
    el('div', { class: 'menu-logo' }, 'COMMONWEALTH OF AUSTRALIA'),
    el('h1', { class: 'menu-title' }, 'POLITICAL SIMULATOR'),
    el('div', { class: 'menu-sub' }, 'Govern a living nation across decades. Every law, election and crisis echoes for generations.'),
  );
  const actions = el('div', { class: 'menu-actions' });
  actions.appendChild(el('button', { class: 'menu-btn primary', onclick: () => { sfx('click'); startMusic(); showCharacterCreation(onStart); } }, '▶  New Game'));
  if (hasSave) actions.appendChild(el('button', { class: 'menu-btn', onclick: () => { sfx('click'); startMusic(); onResume(); } }, '⮌  Continue'));
  actions.appendChild(el('button', { class: 'menu-btn', onclick: () => { sfx('click'); showSettings(); } }, '⚙  Settings'));
  actions.appendChild(el('button', { class: 'menu-btn', onclick: () => { sfx('click'); showAbout(); } }, 'ℹ  About'));
  card.appendChild(actions);
  card.appendChild(el('div', { class: 'menu-foot' }, 'v0.4 · A simulation by an AI assistant · Built with vanilla JS, no engine'));
  m.innerHTML = ''; m.appendChild(card); m.classList.remove('hidden');
}

function showCharacterCreation(onStart) {
  const m = $menu();
  let name = '', career = 'student', party = '', diff = 'normal';
  const form = el('div', { class: 'menu-form' });

  const nin = el('input', { type: 'text', placeholder: 'e.g. Alex Citizen', maxlength: '28' });
  nin.addEventListener('input', () => (name = nin.value));
  form.appendChild(el('div', { class: 'fld' }, el('label', {}, 'Your name'), nin));

  // career choices
  const careerGrid = el('div', { class: 'choice-grid' });
  CAREERS.forEach((c, i) => {
    const ch = el('div', { class: 'choice' + (i === 0 ? ' sel' : ''), onclick: () => {
      sfx('hover'); career = c.id; careerGrid.querySelectorAll('.choice').forEach((x) => x.classList.remove('sel')); ch.classList.add('sel');
    } }, c.name);
    careerGrid.appendChild(ch);
  });
  form.appendChild(el('div', { class: 'fld' }, el('label', {}, 'Starting career'), careerGrid));

  // party (optional)
  const partyGrid = el('div', { class: 'choice-grid' });
  const partyOpts = [{ id: '', short: 'Decide later' }, ...PARTIES.filter((p) => p.id !== 'ind')];
  partyOpts.forEach((p, i) => {
    const ch = el('div', { class: 'choice' + (i === 0 ? ' sel' : ''), style: p.colour ? `border-left:4px solid ${p.colour}` : '', onclick: () => {
      sfx('hover'); party = p.id; partyGrid.querySelectorAll('.choice').forEach((x) => x.classList.remove('sel')); ch.classList.add('sel');
    } }, p.short || p.name);
    partyGrid.appendChild(ch);
  });
  form.appendChild(el('div', { class: 'fld' }, el('label', {}, 'Party allegiance (optional)'), partyGrid));

  // difficulty
  const diffGrid = el('div', { class: 'choice-grid' });
  DIFFICULTIES.forEach((d) => {
    const ch = el('div', { class: 'choice' + (d.id === 'normal' ? ' sel' : ''), onclick: () => {
      sfx('hover'); diff = d.id; diffGrid.querySelectorAll('.choice').forEach((x) => x.classList.remove('sel')); ch.classList.add('sel');
    } }, d.name, el('span', { class: 'ch-sub' }, d.desc));
    diffGrid.appendChild(ch);
  });
  form.appendChild(el('div', { class: 'fld' }, el('label', {}, 'Difficulty'), diffGrid));

  const card = el('div', { class: 'menu-card' },
    el('h1', { class: 'menu-title', style: 'font-size:34px' }, 'Begin Your Career'),
    el('div', { class: 'menu-sub' }, 'Forge a political life from 2026 onward.'),
    form);
  const actions = el('div', { class: 'menu-actions' });
  actions.appendChild(el('button', { class: 'menu-btn primary', onclick: () => { sfx('election'); onStart({ career, playerName: name || 'Alex Citizen', partyId: party || null, difficulty: diff }); } }, '🏛  Enter Politics'));
  actions.appendChild(el('button', { class: 'menu-btn', onclick: () => { sfx('click'); onStart({ career: null, difficulty: diff }); } }, '👁  Observe Only (sandbox)'));
  actions.appendChild(el('button', { class: 'menu-btn', onclick: () => { sfx('click'); showMainMenu({ onStart, onResume: () => {}, hasSave: false }); } }, '←  Back'));
  card.appendChild(actions);
  m.innerHTML = ''; m.appendChild(card);
}

function showAbout() {
  const body = el('div', {});
  body.appendChild(el('p', {}, el('b', {}, 'Australia: The Ultimate Political Simulator')));
  body.appendChild(el('p', { class: 'muted' }, 'A deep political/government/economic grand-strategy simulation: 151 real electorates with preferential voting, a living economy and energy grid, the High Court, foreign affairs, media, dynasties and more — all interacting. Rise from citizen to Prime Minister and shape the nation for generations.'));
  body.appendChild(el('p', { class: 'muted' }, 'Built with vanilla JavaScript and the Web Audio API — no game engine, no external assets. Runs entirely offline in your browser.'));
  modal('About', body, [{ label: 'Close', kind: 'secondary' }]);
}

export function showSettings() {
  const s = getAudioSettings();
  const body = el('div', {});
  const enable = el('input', { type: 'checkbox' }); enable.checked = s.enabled;
  const music = el('input', { type: 'checkbox' }); music.checked = s.music;
  const vol = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(s.volume * 100)) });
  const apply = () => { configureAudio({ enabled: enable.checked, music: music.checked, volume: +vol.value / 100 }); persistSettings(); };
  enable.addEventListener('change', apply); music.addEventListener('change', apply); vol.addEventListener('input', apply);
  body.appendChild(el('div', { class: 'slider-row' }, el('label', {}, el('span', {}, '🔊 Sound effects'), enable)));
  body.appendChild(el('div', { class: 'slider-row' }, el('label', {}, el('span', {}, '🎵 Ambient music'), music)));
  body.appendChild(el('div', { class: 'slider-row' }, el('label', {}, el('span', {}, 'Master volume'), el('span', {})), vol));
  body.appendChild(el('p', { class: 'muted' }, 'All audio is generated procedurally — there are no sound files to download.'));
  modal('⚙️ Settings', body, [{ label: 'Done', run: () => sfx('click') }]);
}

function persistSettings() {
  try { localStorage.setItem('yourpol_settings', JSON.stringify(getAudioSettings())); } catch {}
}
export function loadSettings() {
  try {
    const raw = localStorage.getItem('yourpol_settings');
    if (raw) configureAudio(JSON.parse(raw));
  } catch {}
}

// achievement unlock toast (called from main loop)
export function announceAchievements(list) {
  for (const a of list) { sfx('achieve'); toast(`🏆 ${a.name}`, a.desc, 'achieve'); }
}
