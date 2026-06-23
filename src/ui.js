// ui.js — all rendering and DOM interaction. The UI is a pure function of
// game state plus an `api` object of actions; after any action we re-render.

import { fmtDate, fmtMoney, fmtPct, round, clamp } from './engine.js';
import { METRICS, STATES, PARTIES, CAREERS, RANKS, partyById } from './data.js';
import {
  approval, totalSpend, polById, polName, govLabel, nationalMood,
  availableActions, currentRankIndex,
} from './sim/index.js';
import { POLICY_CATALOGUE } from './sim/legislation.js';

let API = null;
let VIEW = 'dashboard';

export function initUI(api) {
  API = api;
  wireChrome();
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
  document.querySelectorAll('.rail-btn').forEach((b) =>
    b.addEventListener('click', () => { setView(b.dataset.view); }));
  $('#btn-play').addEventListener('click', () => API.setPaused(false));
  $('#btn-pause').addEventListener('click', () => API.setPaused(true));
  document.querySelectorAll('.speed-btn').forEach((b) =>
    b.addEventListener('click', () => API.setSpeed(+b.dataset.speed)));
  $('#btn-save').addEventListener('click', () => { API.save(); toast('Game saved.'); });
  $('#btn-load').addEventListener('click', () => API.load());
  $('#modal-backdrop').addEventListener('click', closeModal);
}
function setView(v) {
  VIEW = v;
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  render(API.state());
}
function toast(msg) { $('#cb-ticker').textContent = msg; }

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
  $('#cb-date').textContent = fmtDate(state.tick);
  $('#btn-play').classList.toggle('active', !state.paused);
  $('#btn-pause').classList.toggle('active', state.paused);
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
  }[VIEW] || viewDashboard;
  root.appendChild(fn(state));
}

// --- Dashboard: interactive state map ---
function viewDashboard(state) {
  const wrap = el('div', { class: 'map-wrap' });
  const grid = el('div', { class: 'map-grid' });
  // crude geographic-ish ordering
  const order = ['NT', 'QLD', 'WA', 'SA', 'NSW', '', 'VIC', 'ACT', 'TAS'];
  for (const code of order) {
    if (!code) { grid.appendChild(el('div')); continue; }
    const st = STATES.find((s) => s.code === code);
    const seats = state.gov.seats;
    grid.appendChild(stateTile(state, st));
  }
  wrap.appendChild(grid);
  return wrap;
}
function stateTile(state, st) {
  // colour by leading party support locally (approx via national support × lean)
  const lead = [...PARTIES].sort((a, b) =>
    (state.support[b.id] * (1 + st.lean * (b.econ + b.soc) * 0.4)) -
    (state.support[a.id] * (1 + st.lean * (a.econ + a.soc) * 0.4)))[0];
  return el('div', { class: 'state-tile', style: `border-color:${lead.colour}`,
    onclick: () => stateModal(state, st) },
    el('div', { class: 'st-name' }, st.code),
    el('div', { class: 'st-sub' }, `${st.name}`),
    el('div', { class: 'st-sub' }, `Pop ${st.pop}M · ${st.hor} seats`),
    el('div', { class: 'st-bar' }, el('div', { class: 'st-fill', style: `width:80%;background:${lead.colour}` })),
    el('div', { class: 'st-sub' }, `Leaning: ${lead.short}`),
  );
}
function stateModal(state, st) {
  const body = el('div', {},
    el('p', { class: 'muted' }, `Population ${st.pop}M · ${st.hor} House seats · ${st.senate} Senate seats`),
    el('h3', {}, 'Estimated party support'),
  );
  const sorted = [...PARTIES].sort((a, b) => state.support[b.id] - state.support[a.id]);
  for (const p of sorted) {
    const v = state.support[p.id] * (1 + st.lean * (p.econ + p.soc) * 0.4);
    body.appendChild(el('div', { class: 'slider-row' },
      el('label', {}, el('span', {}, p.short), el('span', {}, fmtPct(v))),
      el('div', { class: 'm-bar' }, el('div', { class: 'm-fill', style: `width:${clamp(v * 2.5)}%;background:${p.colour}` })),
    ));
  }
  modal(`${st.name}`, body, [{ label: 'Close', kind: 'secondary' }]);
}

// --- Parliament: chambers + government ---
function viewParliament(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '🏛️ Parliament of Australia'));
  const pm = state.gov.pm ? polName(state, state.gov.pm) : '—';
  pad.appendChild(el('p', {},
    el('span', { class: 'tag', style: `background:${partyById(state.gov.parties[0]).colour}` }, govLabel(state.gov)),
    ` government · Prime Minister: `, el('b', {}, pm),
    state.gov.majority ? ' (majority)' : ' (minority)'));

  pad.appendChild(chamber(state, 'House of Representatives', 'hor'));
  pad.appendChild(chamber(state, 'Senate', 'senate'));
  return pad;
}
function chamber(state, title, key) {
  const members = state.politicians.filter((p) => p.chamber === key);
  const counts = {};
  members.forEach((m) => (counts[m.party] = (counts[m.party] || 0) + 1));
  const wrap = el('div', { class: 'chamber card' });
  wrap.appendChild(el('h3', {}, `${title} — ${members.length} seats`));
  // composition line
  const line = el('div', { class: 'gov-line' });
  [...PARTIES].filter((p) => counts[p.id]).sort((a, b) => counts[b.id] - counts[a.id]).forEach((p) => {
    line.appendChild(el('span', { class: 'tag', style: `background:${p.colour};margin-right:4px` }, `${p.short} ${counts[p.id]}`));
  });
  wrap.appendChild(line);
  // seat dots
  const seats = el('div', { class: 'seats' });
  for (const p of [...PARTIES].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))) {
    for (let i = 0; i < (counts[p.id] || 0); i++) seats.appendChild(el('div', { class: 'seat', style: `background:${p.colour}`, title: p.short }));
  }
  wrap.appendChild(seats);
  return wrap;
}

// --- Elections ---
function viewElections(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '🗳️ Elections'));
  const ticksTo = state.nextElection - state.tick;
  pad.appendChild(el('p', { class: 'muted' }, `Next federal election: ${fmtDate(state.nextElection)} (${ticksTo} months).`));

  pad.appendChild(el('h3', {}, 'Current voting intention (first preferences)'));
  const sorted = [...PARTIES].sort((a, b) => state.support[b.id] - state.support[a.id]);
  for (const p of sorted) {
    const v = state.support[p.id];
    pad.appendChild(el('div', { class: 'slider-row' },
      el('label', {}, el('span', {}, p.name), el('span', {}, fmtPct(v))),
      el('div', { class: 'm-bar' }, el('div', { class: 'm-fill', style: `width:${clamp(v * 2.2)}%;background:${p.colour}` })),
    ));
  }

  const last = state._transient?.lastElection;
  if (last) {
    pad.appendChild(el('h3', {}, 'Last election result'));
    pad.appendChild(seatTable(state, last));
  }

  pad.appendChild(el('div', { class: 'card' },
    el('div', { class: 'row-between' },
      el('div', {}, el('b', {}, 'Snap election'), el('div', { class: 'muted' }, 'Call an early election (resets the 3-year clock).')),
      el('button', { class: 'btn', onclick: () => API.callElection() }, 'Call Election'))));
  return pad;
}
function seatTable(state, result) {
  const t = el('table', { class: 'data' });
  t.appendChild(el('tr', {}, el('th', {}, 'Party'), el('th', {}, 'House'), el('th', {}, 'Senate'), el('th', {}, 'Vote %')));
  for (const p of [...PARTIES].sort((a, b) => (result.seats[b.id].hor) - (result.seats[a.id].hor))) {
    t.appendChild(el('tr', {},
      el('td', {}, el('span', { class: 'tag', style: `background:${p.colour}` }, p.short)),
      el('td', {}, String(result.seats[p.id].hor)),
      el('td', {}, String(result.seats[p.id].senate)),
      el('td', {}, fmtPct(result.support[p.id]))));
  }
  return t;
}

// --- Legislation ---
function viewLegislation(state) {
  const pad = el('div', { class: 'view-pad' });
  pad.appendChild(el('h2', {}, '⚖️ Legislation'));
  const canPropose = API.canLegislate();
  pad.appendChild(el('p', { class: 'muted' },
    canPropose ? 'You hold a government office — propose bills below.'
      : 'You need to be a Minister, Treasurer or PM to introduce government bills. You can still watch bills progress.'));

  // active bills
  pad.appendChild(el('h3', {}, `Bills before Parliament (${state.bills.length})`));
  if (!state.bills.length) pad.appendChild(el('p', { class: 'muted' }, 'No bills currently in progress.'));
  for (const b of state.bills) {
    const card = el('div', { class: 'card' },
      el('div', { class: 'row-between' },
        el('div', {}, el('b', {}, b.title), el('div', { class: 'muted' }, b.desc)),
        el('span', { class: 'tag', style: 'background:#6b7780' }, b.stage.toUpperCase())));
    if (b.votes.house) card.appendChild(el('div', { class: 'muted' }, `House: ${b.votes.house.yes}–${b.votes.house.no}`));
    if (b.votes.senate) card.appendChild(el('div', { class: 'muted' }, `Senate: ${b.votes.senate.yes}–${b.votes.senate.no}`));
    if (canPropose && b.stage !== 'failed') card.appendChild(el('button', { class: 'btn small', onclick: () => API.advanceBill(b.id) }, 'Advance stage'));
    pad.appendChild(card);
  }

  // propose new
  if (canPropose) {
    pad.appendChild(el('h3', {}, 'Propose a bill'));
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
  for (const law of state.laws) {
    pad.appendChild(el('div', { class: 'card' },
      el('div', { class: 'row-between' },
        el('div', {}, el('b', {}, law.title), el('div', { class: 'muted' }, `Enacted ${fmtDate(law.enacted)}`)),
        canPropose ? el('button', { class: 'btn small bad', onclick: () => API.repeal(law.id) }, 'Repeal') : el('span'))));
  }
  return pad;
}
function effectSummary(pol) {
  const parts = [];
  for (const [k, v] of Object.entries(pol.impact || {})) parts.push(`${k} ${v > 0 ? '+' : ''}${v}`);
  if (pol.cost) parts.push(`+$${pol.cost}B/yr ${pol.line}`);
  for (const [k, v] of Object.entries(pol.taxDelta || {})) parts.push(`${k} tax ${v > 0 ? '+' : ''}${round(v * 100)}pt`);
  return parts.join(' · ');
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
      top.forEach((m) => ul.appendChild(el('div', { class: 'muted' },
        `• ${m.name} — ${m.traits.join(', ')} (pop ${m.popularity}, comp ${m.competence})${m.rank === 'pm' ? ' [PM]' : ''}`)));
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
  API.careerAction(id);
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

/* ----------------------------------------------------- start-up new-game */
export function showNewGameDialog(onStart) {
  const body = el('div', {});
  body.appendChild(el('p', {}, el('b', {}, 'Australia: The Ultimate Political Simulator')));
  body.appendChild(el('p', { class: 'muted' }, 'Begin a career and shape the nation from 2026 onward. Choose who you are.'));
  let name = '', career = 'student';
  const nin = el('input', { type: 'text', placeholder: 'Your name', style: 'width:100%;padding:6px;margin-bottom:8px' });
  nin.addEventListener('input', () => (name = nin.value));
  body.appendChild(nin);
  const csel = el('select', { style: 'width:100%;padding:6px' });
  CAREERS.forEach((c) => csel.appendChild(el('option', { value: c.id }, c.name)));
  csel.addEventListener('change', () => (career = csel.value));
  body.appendChild(el('div', { class: 'slider-row' }, el('label', {}, 'Starting career'), csel));

  modal('New Game', body, [
    { label: 'Observe only', kind: 'secondary', run: () => onStart({ career: null }) },
    { label: 'Begin career', run: () => onStart({ career, playerName: name || 'Alex Citizen' }) },
  ]);
}
