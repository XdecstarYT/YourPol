// main.js — application controller. Owns the game state, the real-time loop,
// and the `api` object the UI calls. Keeps UI and simulation fully decoupled.

import { saveGame, loadGame, hasSave, clamp } from './engine.js';
import { newGame, tick, polById } from './sim/index.js';
import { makeBill, advanceBill, repealLaw, customEffect } from './sim/legislation.js';
import { runElection } from './sim/elections.js';
import { resolveEvent, playerGoverns } from './sim/events.js';
import { runAction } from './sim/career.js';
import { proposeReferendum } from './sim/referendum.js';
import { foreignAction } from './sim/world.js';
import { initUI, render, closeModal, modal, showElectionNight,
  showMainMenu, hideMenu, announceAchievements, toast } from './ui.js';
import { sfx } from './audio.js';

let state = null;
let autoTimer = null;

// The game is TURN-BASED: one turn = one month. The player advances time with
// "End Turn" / "End Year". An optional Auto mode advances turns on a timer.
const SPEED_MS = { 1: 1400, 2: 800, 4: 380 };

function startAuto() {
  stopAuto();
  if (!state.auto) return;
  autoTimer = setInterval(advanceTurn, SPEED_MS[state.speed] || 800);
}
function stopAuto() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } }

// Advance a single turn. Returns a status; halts auto-play on anything notable.
function stepTurn() {
  if (state.events.length) return 'blocked';     // unresolved crisis
  const out = tick(state);
  if (out.achievements?.length) announceAchievements(out.achievements);
  if (out.election) { onElection(out.election); return 'election'; }
  if (state.events.length) {
    sfx('alert');
    const ev = state.events[0];
    toast(`${ev.icon} ${ev.title}`, 'A crisis needs your decision.', 'bad');
    return 'crisis';
  }
  return 'ok';
}
function advanceTurn() {
  const s = stepTurn();
  if (s !== 'ok') { stopAuto(); state.auto = false; }
  render(state);
  return s;
}

function onElection(result) {
  stopAuto(); state.auto = false;
  sfx('election');
  showElectionNight(state, result, () => render(state));
}

/* ------------------------------------------------------------------ api */
const api = {
  state: () => state,
  // turn controls
  endTurn() { sfx('click'); advanceTurn(); },
  endYear() {
    sfx('click');
    for (let i = 0; i < 12; i++) { if (stepTurn() !== 'ok') break; }
    stopAuto(); state.auto = false; render(state);
  },
  toggleAuto() { state.auto = !state.auto; sfx('click'); state.auto ? startAuto() : stopAuto(); render(state); },
  setSpeed(s) { state.speed = s; if (state.auto) startAuto(); render(state); },

  save() { stopAuto(); state.auto = false; saveGame(state); render(state); },
  load() {
    const loaded = loadGame();
    if (loaded) { state = loaded; state.auto = false; stopAuto(); render(state); }
  },

  callElection() {
    const result = runElection(state);
    state._transient = state._transient || {};
    state._transient.lastElection = result;
    onElection(result);
    render(state);
  },

  // legislation -----------------------------------------------------------
  canLegislate() {        // member of government: budget, repeal, referendums
    const pl = state.player;
    if (!pl || !pl.polId) return false;
    const pol = polById(state, pl.polId);
    return pol && ['minister', 'treasurer', 'leader', 'pm'].includes(pol.rank)
      && state.gov.parties.includes(pol.party);
  },
  canIntroduce() {        // any sitting MP can introduce a bill
    return !!(state.player && state.player.polId);
  },
  proposePolicy(policyId) {
    if (!api.canIntroduce()) return;
    const bill = makeBill(state, policyId, state.player.polId);
    if (bill) bill.sponsoredByGov = api.canLegislate();
    sfx('click'); render(state);
  },
  proposeCustom({ title, category, intensity }) {
    if (!api.canIntroduce()) return;
    const eff = customEffect(category, intensity);
    const bill = makeBill(state, null, state.player.polId, {
      custom: eff, title: title || 'Private Member\'s Bill',
      desc: `A bill in the area of ${category} (strength ${intensity}/10).`,
      privateMember: !api.canLegislate(),
    });
    if (bill) bill.sponsoredByGov = api.canLegislate();
    sfx('success'); render(state);
  },
  advanceBill(billId) {
    if (!api.canIntroduce()) return;
    const b = state.bills.find((x) => x.id === billId);
    if (b) { const was = state.laws.length; advanceBill(state, b); sfx(state.laws.length > was ? 'law' : 'gavel'); }
    render(state);
  },
  repeal(lawId) { if (api.canLegislate()) { repealLaw(state, lawId); sfx('gavel'); } render(state); },
  proposeReferendum(refId) { if (api.canLegislate()) { proposeReferendum(state, refId); sfx('success'); } render(state); },
  foreignAction(nationId, action) { if (api.canLegislate()) { foreignAction(state, nationId, action); sfx('click'); } render(state); },

  // budget ----------------------------------------------------------------
  setSpend(cat, val) { if (api.canLegislate()) state.budget.spend[cat] = clamp(val, 0, 1000); render(state); },
  setTax(t, val) { if (api.canLegislate()) state.budget.tax[t] = clamp(val, 0, 0.9); render(state); },

  // events & career -------------------------------------------------------
  resolveEvent(instanceId, idx) { sfx('click'); resolveEvent(state, instanceId, idx); render(state); },
  careerAction(id, payload) {
    const before = state.player?.reputation ?? 0;
    runAction(state, id, payload);
    sfx((state.player?.reputation ?? 0) >= before ? 'success' : 'fail');
    render(state);
  },
  openMenu() { state.auto = false; stopAuto(); render(state); openMainMenu(); },
};

/* -------------------------------------------------------------- bootstrap */
function openMainMenu() {
  showMainMenu({
    hasSave: hasSave(),
    onStart: (opts) => { hideMenu(); state = newGame({ ...opts }); state.auto = false; render(state); },
    onResume: () => { const l = loadGame(); if (l) { state = l; } hideMenu(); state.auto = false; render(state); },
  });
}
function boot() {
  initUI(api);
  openMainMenu();
}

window.addEventListener('DOMContentLoaded', boot);
