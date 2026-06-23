// ui.js — all rendering and DOM interaction. The UI is a pure function of
// game state plus an `api` object of actions; after any action we re-render.

import { fmtDate, fmtMoney, fmtPct, round, clamp } from './engine.js';
import { METRICS, STATES, PARTIES, CAREERS, RANKS, partyById } from './data.js';
import {
  approval, totalSpend, polById, polName, govLabel, nationalMood,
  availableActions, currentRankIndex, buildPendulum, seatStatus,
  REFERENDUM_CATALOGUE,
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

// --- Dashboard: 3D tilted state map with state governments ---
function viewDashboard(state) {
  const wrap = el('div', { class: 'map-wrap' });
  const stage = el('div', { class: 'map3d-stage' });
  const plane = el('div', { class: 'map3d-plane' });
  // crude geographic-ish ordering
  const order = ['NT', 'QLD', 'WA', 'SA', 'NSW', '', 'VIC', 'ACT', 'TAS'];
  for (const code of order) {
    if (!code) { plane.appendChild(el('div')); continue; }
    plane.appendChild(stateTile3D(state, STATES.find((s) => s.code === code)));
  }
  stage.appendChild(plane);
  wrap.appendChild(stage);
  return wrap;
}
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
  [['intention', 'Voting intention'], ['pendulum', 'Pendulum'], ['results', 'Seat results'], ['referendums', 'Referendums']]
    .forEach(([k, lbl]) => tabs.appendChild(el('button', {
      class: `btn small ${ELEC_TAB === k ? '' : 'secondary'}`, onclick: () => { ELEC_TAB = k; render(state); },
    }, lbl)));
  pad.appendChild(tabs);

  if (ELEC_TAB === 'intention') tabIntention(state, pad);
  else if (ELEC_TAB === 'pendulum') tabPendulum(state, pad);
  else if (ELEC_TAB === 'results') tabResults(state, pad);
  else if (ELEC_TAB === 'referendums') tabReferendums(state, pad);

  pad.appendChild(el('div', { class: 'card', style: 'margin-top:14px' },
    el('div', { class: 'row-between' },
      el('div', {}, el('b', {}, 'Snap election'), el('div', { class: 'muted' }, 'Call an early election (resets the clock).')),
      el('button', { class: 'btn', onclick: () => API.callElection() }, 'Call Election'))));
  return pad;
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
      const p = partyById(s.held);
      const row = el('div', { class: 'fr' },
        el('span', {}, `${s.name} (${s.state})`),
        el('span', { class: s.gain ? 'gain' : '' }, `${p.short}${s.gain ? ' GAIN' : ''} · swing ${s.swing >= 0 ? '+' : ''}${s.swing.toFixed(1)}`));
      tally.feed.prepend(row);
    }
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
