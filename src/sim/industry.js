// sim/industry.js — per-industry economic modelling and the national energy grid.
// Industries each respond to different policy/economic levers and together feed
// back into GDP growth, unemployment and exports. The energy grid trades off
// reliability, price and emissions, and drives the environment metric.

import { clamp, sum } from '../engine.js';

const INDUSTRY_DEFS = [
  { id: 'mining',        name: 'Mining & Resources', icon: '⛏️', share: 0.11 },
  { id: 'agriculture',   name: 'Agriculture',        icon: '🌾', share: 0.03 },
  { id: 'tourism',       name: 'Tourism',            icon: '🏖️', share: 0.04 },
  { id: 'manufacturing', name: 'Manufacturing',      icon: '🏭', share: 0.06 },
  { id: 'construction',  name: 'Construction',       icon: '🏗️', share: 0.08 },
  { id: 'finance',       name: 'Finance',            icon: '🏦', share: 0.10 },
  { id: 'technology',    name: 'Technology',         icon: '💻', share: 0.07 },
  { id: 'defence',       name: 'Defence Industry',   icon: '🛡️', share: 0.02 },
  { id: 'healthcare',    name: 'Healthcare',         icon: '🏥', share: 0.09 },
  { id: 'education',     name: 'Education',          icon: '🎓', share: 0.06 },
];

const ENERGY_DEFS = [
  { id: 'coal',    name: 'Coal',    icon: '🪨', share: 0.42, dispatchable: true,  emit: 1.0 },
  { id: 'gas',     name: 'Gas',     icon: '🔥', share: 0.18, dispatchable: true,  emit: 0.5 },
  { id: 'hydro',   name: 'Hydro',   icon: '💧', share: 0.06, dispatchable: true,  emit: 0.0 },
  { id: 'solar',   name: 'Solar',   icon: '☀️', share: 0.18, dispatchable: false, emit: 0.0 },
  { id: 'wind',    name: 'Wind',    icon: '🌬️', share: 0.12, dispatchable: false, emit: 0.0 },
  { id: 'battery', name: 'Storage', icon: '🔋', share: 0.04, dispatchable: true,  emit: 0.0 },
  { id: 'nuclear', name: 'Nuclear', icon: '⚛️', share: 0.00, dispatchable: true,  emit: 0.0 },
];

export function initIndustry(rng) {
  const industries = INDUSTRY_DEFS.map((d) => ({
    ...d, health: Math.round(rng.range(50, 70)), growth: rng.range(-1, 3),
  }));
  const energy = {
    mix: Object.fromEntries(ENERGY_DEFS.map((d) => [d.id, d.share])),
    nuclearLegal: false,
    reliability: 88, price: 100, emissions: 100, // indices (100 = baseline)
  };
  return { industries, energy };
}

export function tickIndustry(state) {
  const e = state.economy, m = state.metrics, b = state.budget;
  const { industries, energy } = state;
  const china = state.world?.nations.find((n) => n.id === 'chn');
  const chinaRel = china ? china.relation : 0;

  // --- per-industry growth, each with its own drivers --------------------
  for (const ind of industries) {
    let g = (e.growth - 2) * 0.4;          // base macro pull
    switch (ind.id) {
      case 'mining':        g += (chinaRel / 100) * 2 - b.tax.resource * 4 + (energy.price - 100) * 0.01; break;
      case 'agriculture':   g += (m.environment - 50) * 0.04 - (state._droughtPenalty || 0); break;
      case 'tourism':       g += (state.world?.avgRelation || 0) * 0.02 - (e.cashRate - 3) * 0.1; break;
      case 'manufacturing': g += -(energy.price - 100) * 0.03 - (b.tax.company - 0.3) * 4 + 0.3; break;
      case 'construction':  g += (b.spend.infrastructure - 28) * 0.05 - (e.cashRate - 3) * 0.3; break;
      case 'finance':       g += (e.cashRate - 3) * 0.2 + (e.confidence - 55) * 0.03; break;
      case 'technology':    g += (m.education - 50) * 0.04 + (b.spend.science - 14) * 0.08; break;
      case 'defence':       g += (b.spend.defence - 52) * 0.04; break;
      case 'healthcare':    g += (b.spend.health - 110) * 0.02 + 0.3; break;
      case 'education':     g += (b.spend.education - 48) * 0.03; break;
    }
    ind.growth += (clamp(g, -6, 8) - ind.growth) * 0.1;
    // health follows growth but mean-reverts toward a healthy baseline so no
    // sector pegs permanently at 0 or 100
    ind.health = clamp(ind.health + ind.growth * 0.12 + (55 - ind.health) * 0.02);
  }

  // sector composite nudges national growth & unemployment
  const sectorAvg = sum(industries, (i) => i.growth) / industries.length;
  e.growth += (sectorAvg - (e.growth - 2)) * 0.02;
  state._exports = clamp(50 + (industries.find((i) => i.id === 'mining').health - 55) * 0.6
    + (chinaRel / 100) * 20, 0, 100);

  // --- energy transition --------------------------------------------------
  const pushClean = (b.spend.climate - 12) * 0.0006 + b.tax.carbon * 0.01 + 0.0008;
  const mix = energy.mix;
  const grow = (id, amt) => { mix[id] = clamp(mix[id] + amt, 0, 1); };
  grow('solar', pushClean * 0.5); grow('wind', pushClean * 0.4); grow('battery', pushClean * 0.2);
  grow('coal', -pushClean * 0.9);
  if (energy.nuclearLegal) grow('nuclear', 0.0015);
  if (mix.coal < 0.02) mix.coal = Math.max(0, mix.coal);
  // renormalise
  const tot = sum(Object.values(mix));
  for (const k of Object.keys(mix)) mix[k] /= tot;

  const dispatch = sum(ENERGY_DEFS.filter((d) => d.dispatchable), (d) => mix[d.id]);
  energy.reliability = clamp(60 + dispatch * 45);
  energy.emissions = clamp(sum(ENERGY_DEFS, (d) => mix[d.id] * d.emit) * 100, 0, 120);
  energy.price = clamp(80 + (1 - dispatch) * 50 + b.tax.carbon * 60 - mix.solar * 20, 50, 200);

  // energy feeds environment + economy metrics
  m.environment = clamp(m.environment + ((120 - energy.emissions) / 120 * 60 - m.environment) * 0.01);
  if (energy.reliability < 70) m.economy = clamp(m.economy - (70 - energy.reliability) * 0.02);
}

export function topIndustries(state) {
  return [...state.industries].sort((a, b) => b.share - a.share);
}
export function renewableShare(state) {
  const mix = state.energy.mix;
  return (mix.solar + mix.wind + mix.hydro + mix.battery + mix.nuclear) * 100;
}
