// sim/events.js — dynamic crises and scandals. Crises queue up and wait for a
// player decision (if the player governs) or resolve automatically otherwise.

import { RNG, clamp } from '../engine.js';
import { EVENT_TEMPLATES, SCANDAL_TEMPLATES } from '../data.js';
import { archive, polById } from './state.js';

export function tickEvents(state) {
  const rng = RNG.fromJSON(state.rng);

  // ~6% chance of a crisis per month, scaled by instability and difficulty.
  const diffMult = { easy: 0.6, normal: 1, hard: 1.6 }[state.difficulty] ?? 1;
  const instability = ((60 - state.metrics.happiness) / 200 + 0.05) * diffMult;
  if (state.events.length === 0 && rng.chance(clamp(instability, 0.03, 0.28))) {
    const tpl = rng.weighted(EVENT_TEMPLATES.map((e) => [e, e.weight]));
    const ev = { ...tpl, instanceId: `${tpl.id}_${state.tick}`, raised: state.tick };
    // apply the unavoidable shock immediately
    for (const [k, v] of Object.entries(ev.effects)) {
      if (k in state.metrics) state.metrics[k] = clamp(state.metrics[k] + v);
    }
    archive(state, `${ev.icon} CRISIS: ${ev.title}.`, 'crisis');
    // If the player governs, queue for a decision; otherwise AI handles it.
    if (playerGoverns(state)) state.events.push(ev);
    else autoResolve(state, ev, rng);
  }

  // Scandals: any politician can be caught; risk scales with scandalRisk.
  if (rng.chance(0.05)) {
    const candidates = state.politicians.filter((p) => p.chamber && p.scandalRisk > 40);
    if (candidates.length) {
      const target = rng.weighted(candidates.map((p) => [p, p.scandalRisk]));
      const sc = rng.pick(SCANDAL_TEMPLATES);
      target.popularity = clamp(target.popularity - sc.severity * 40);
      target.scandal = sc.id;
      const isPM = state.gov.pm === target.id;
      if (isPM || target.isPlayer) state.metrics.institutions = clamp(state.metrics.institutions - sc.severity * 6);
      archive(state,
        `🗞️ SCANDAL: ${target.name} accused of ${sc.label}.${isPM ? ' Pressure mounts on the PM.' : ''}`,
        'scandal');
      // severe scandal can topple a leader
      if (sc.severity > 0.75 && (isPM) && rng.chance(0.5)) {
        archive(state, `${target.name} resigns amid the scandal. A leadership spill looms.`, 'scandal');
        target.rank = 'backbench';
        target.popularity = clamp(target.popularity - 20);
      }
    }
  }

  state.rng = rng.toJSON();
}

export function playerGoverns(state) {
  const pl = state.player;
  if (!pl || !pl.polId) return false;
  const pol = polById(state, pl.polId);
  return pol && (pol.rank === 'pm' || pol.rank === 'treasurer' || pol.rank === 'minister');
}

// Resolve a crisis with a chosen option index (player path).
export function resolveEvent(state, instanceId, choiceIdx) {
  const idx = state.events.findIndex((e) => e.instanceId === instanceId);
  if (idx < 0) return;
  const ev = state.events[idx];
  const choice = ev.choices[choiceIdx];
  applyChoice(state, ev, choice);
  state.events.splice(idx, 1);
  state.stats = state.stats || { monthsAsPM: 0, crisesHandled: 0 };
  state.stats.crisesHandled++;
}

function applyChoice(state, ev, choice) {
  for (const [k, v] of Object.entries(choice.eff || {})) {
    if (k in state.metrics) state.metrics[k] = clamp(state.metrics[k] + v);
  }
  if (choice.spend) {
    // emergency spending adds to debt directly
    state.economy.debt += choice.spend;
  }
  archive(state, `Response to ${ev.title}: "${choice.label}".`, 'crisis');
}

function autoResolve(state, ev, rng) {
  // AI government picks a middle-of-the-road option.
  const choice = ev.choices[Math.min(1, ev.choices.length - 1)];
  applyChoice(state, ev, choice);
}
