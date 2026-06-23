// sim/economy.js — monthly economic, budget and national-metrics simulation.
// Everything here interacts: tax rates → revenue & confidence → growth →
// unemployment → metrics → citizen happiness → party support.

import { clamp, sum } from '../engine.js';

// Total annual spend across all budget line items (A$ billions).
export function totalSpend(state) { return sum(Object.values(state.budget.spend)); }

// Recompute government revenue from tax settings and the size of the economy.
export function computeRevenue(state) {
  const e = state.economy, t = state.budget.tax;
  const gdp = e.gdp;
  // Crude tax-base model: each tax draws from a slice of GDP at its rate,
  // with a Laffer-style penalty when rates get very high.
  const eff = (rate, base, peak = 0.5) => {
    const draw = rate * base * gdp;
    const penalty = rate > peak ? 1 - (rate - peak) * 0.6 : 1;
    return draw * Math.max(0.3, penalty);
  };
  const income   = eff(t.income,  0.42);
  const company  = eff(t.company, 0.13);
  const gst      = eff(t.gst,     0.30, 0.20);
  const capital  = eff(t.capital, 0.03, 0.6) * t.income; // CGT taxed at income rate
  const carbon   = eff(t.carbon,  0.06, 0.3);
  const resource = eff(t.resource,0.08, 0.4);
  return income + company + gst + capital + carbon + resource;
}

// One monthly economic tick.
export function tickEconomy(state) {
  const e = state.economy, b = state.budget;
  b.revenue = computeRevenue(state);

  const spend = totalSpend(state);
  const annualBalance = b.revenue - spend;       // surplus(+)/deficit(-)
  b.lastBalance = annualBalance;

  // Debt accrues monthly from deficit plus interest.
  const monthlyDeficit = -annualBalance / 12;
  const interest = (e.debt * (e.cashRate / 100)) / 12;
  e.debt = Math.max(0, e.debt + monthlyDeficit + interest);

  // --- Growth model -------------------------------------------------------
  // Fiscal impulse (deficit spending stimulates short-term),
  // tax drag, confidence, and global noise drive growth.
  const fiscalImpulse = clamp(-annualBalance / state.economy.gdp * 100, -3, 3);
  const taxDrag = (state.budget.tax.income + state.budget.tax.company) * 2.0;
  const ratePressure = (e.cashRate - 3) * 0.15;
  let targetGrowth = 2.4 + fiscalImpulse * 0.4 - taxDrag * 0.3 - ratePressure
    + (e.confidence - 55) * 0.03;
  // investment from infrastructure & science spending lifts trend growth
  targetGrowth += (b.spend.infrastructure + b.spend.science) / 100;
  e.growth += (targetGrowth - e.growth) * 0.15;   // smooth toward target

  // GDP compounds monthly.
  e.gdp *= 1 + e.growth / 100 / 12;

  // --- Inflation & cash rate (toy RBA) ------------------------------------
  let targetInfl = 2.5 + fiscalImpulse * 0.3 + (e.growth - 2.5) * 0.2 - state.budget.tax.gst * 1;
  e.inflation += (targetInfl - e.inflation) * 0.12;
  // RBA leans against inflation away from 2.5% midpoint.
  const rateTarget = clamp(3.0 + (e.inflation - 2.5) * 0.9, 0.1, 12);
  e.cashRate += (rateTarget - e.cashRate) * 0.1;

  // --- Unemployment (Okun-ish) -------------------------------------------
  const uTarget = clamp(4.5 - (e.growth - 2.5) * 0.6 + (e.inflation > 6 ? 1 : 0), 2.5, 14);
  e.unemployment += (uTarget - e.unemployment) * 0.1;

  // --- Confidence ---------------------------------------------------------
  let cTarget = 55 + (e.growth - 2.5) * 6 - (e.unemployment - 4.5) * 4 - (e.inflation - 2.5) * 3;
  e.confidence = clamp(e.confidence + (cTarget - e.confidence) * 0.1);
}

// Push national metrics toward levels implied by spending, economy and laws.
export function tickMetrics(state) {
  const m = state.metrics, b = state.budget, e = state.economy;
  const perCapita = (cat) => b.spend[cat] / (state.economy.gdp / 100); // spend intensity

  // Each metric has a target driven by relevant spending + economy + law effects.
  // Multipliers are calibrated so baseline 2026 spending yields the starting
  // metric values; as GDP grows, holding spending flat lets metrics drift down
  // (a built-in fiscal pressure the player must manage).
  const targets = {
    health:        45 + perCapita('health') * 4.5 + (e.growth - 2) * 1,
    education:     42 + perCapita('education') * 8.7,
    safety:        44 + perCapita('policing') * 23,
    housing:       30 + perCapita('housing') * 31 - (e.inflation - 2.5) * 2,
    transport:     38 + perCapita('infrastructure') * 13,
    environment:   40 + perCapita('climate') * 22,
    economy:       clamp(40 + (e.growth - 2.5) * 8 + (55 - e.unemployment * 6) * 0.4 + e.confidence * 0.2),
    institutions:  m.institutions,   // mostly moved by scandals/laws/events
    freedom:       m.freedom,        // moved by laws/events
    entertainment: 48 + (e.confidence - 55) * 0.2,
  };
  // welfare lifts happiness floor and reduces inequality pain
  const welfareLift = perCapita('welfare') * 0.8;

  for (const k of Object.keys(targets)) {
    m[k] = clamp(m[k] + (targets[k] - m[k]) * 0.08);
  }
  // Happiness is a weighted blend of the other metrics + welfare + jobs.
  const blend =
    m.economy * 0.20 + m.health * 0.14 + m.housing * 0.14 + m.safety * 0.10 +
    m.education * 0.08 + m.environment * 0.08 + m.freedom * 0.08 +
    m.transport * 0.06 + m.entertainment * 0.06 + m.institutions * 0.06;
  const happyTarget = clamp(blend + welfareLift - (e.unemployment - 4.5) * 1.5);
  m.happiness = clamp(m.happiness + (happyTarget - m.happiness) * 0.1);

  applyLawEffects(state);
}

// Enacted laws apply small ongoing nudges every tick.
function applyLawEffects(state) {
  for (const law of state.laws) {
    if (!law.ongoing) continue;
    for (const [k, v] of Object.entries(law.ongoing)) {
      if (k in state.metrics) state.metrics[k] = clamp(state.metrics[k] + v / 24);
    }
  }
}

// Government approval derives from happiness + economy + scandal drag.
export function approval(state) {
  const m = state.metrics, e = state.economy;
  let a = m.happiness * 0.5 + m.economy * 0.2 + m.institutions * 0.15
        - (e.inflation - 2.5) * 1.5 - (e.unemployment - 4.5) * 1.2;
  return clamp(a);
}
