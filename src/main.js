// main.js — application controller. Owns the game state, the real-time loop,
// and the `api` object the UI calls. Keeps UI and simulation fully decoupled.

import { saveGame, loadGame, hasSave, clamp } from './engine.js';
import { newGame, tick, polById } from './sim/index.js';
import { makeBill, advanceBill, repealLaw } from './sim/legislation.js';
import { runElection } from './sim/elections.js';
import { resolveEvent, playerGoverns } from './sim/events.js';
import { runAction } from './sim/career.js';
import { proposeReferendum } from './sim/referendum.js';
import { foreignAction } from './sim/world.js';
import { initUI, render, closeModal, modal, showElectionNight,
  showMainMenu, hideMenu, announceAchievements, toast } from './ui.js';
import { sfx } from './audio.js';

let state = null;
let timer = null;

// Real-time mapping: speed 1/2/4 → milliseconds per simulated month.
const SPEED_MS = { 1: 2000, 2: 1000, 4: 450 };

/* ----------------------------------------------------------------- loop */
function startLoop() {
  stopLoop();
  if (state.paused) return;
  timer = setInterval(stepOnce, SPEED_MS[state.speed] || 1000);
}
function stopLoop() { if (timer) { clearInterval(timer); timer = null; } }

function stepOnce() {
  const out = tick(state);
  if (out.achievements?.length) announceAchievements(out.achievements);
  if (out.election) onElection(out.election);
  // pause for player crisis decisions
  if (state.events.length) {
    state.paused = true; stopLoop();
    sfx('alert');
    const ev = state.events[0];
    toast(`${ev.icon} ${ev.title}`, 'A crisis demands your decision.', 'bad');
  }
  render(state);
}

function onElection(result) {
  state.paused = true; stopLoop();
  sfx('election');
  showElectionNight(state, result, () => render(state));
}

/* ------------------------------------------------------------------ api */
const api = {
  state: () => state,
  setPaused(p) { state.paused = p; p ? stopLoop() : startLoop(); render(state); },
  setSpeed(s) { state.speed = s; if (!state.paused) startLoop(); render(state); },

  save() { state.paused = true; stopLoop(); saveGame(state); render(state); },
  load() {
    const loaded = loadGame();
    if (loaded) { state = loaded; state.paused = true; stopLoop(); render(state); }
  },

  callElection() {
    const result = runElection(state);
    state._transient = state._transient || {};
    state._transient.lastElection = result;
    onElection(result);
    render(state);
  },

  // legislation -----------------------------------------------------------
  canLegislate() {
    const pl = state.player;
    if (!pl || !pl.polId) return false;
    const pol = polById(state, pl.polId);
    return pol && ['minister', 'treasurer', 'leader', 'pm'].includes(pol.rank)
      && state.gov.parties.includes(pol.party);
  },
  proposePolicy(policyId) {
    if (!api.canLegislate()) return;
    const bill = makeBill(state, policyId, state.player.polId);
    if (bill) bill.sponsoredByGov = true;
    sfx('click'); render(state);
  },
  advanceBill(billId) {
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
  openMenu() { state.paused = true; stopLoop(); render(state); openMainMenu(); },
};

/* -------------------------------------------------------------- bootstrap */
function openMainMenu() {
  showMainMenu({
    hasSave: hasSave(),
    onStart: (opts) => { hideMenu(); state = newGame({ ...opts }); state.paused = true; render(state); },
    onResume: () => { const l = loadGame(); if (l) { state = l; } hideMenu(); state.paused = true; render(state); },
  });
}
function boot() {
  initUI(api);
  openMainMenu();
}

window.addEventListener('DOMContentLoaded', boot);
