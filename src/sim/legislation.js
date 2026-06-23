// sim/legislation.js — bill lifecycle, chamber voting and enacted-law effects.
// Bills carry an ideological position and a bundle of effects. AI MPs vote by
// matching the bill to their own ideology, weighted by party loyalty.

import { RNG, uid, clamp } from '../engine.js';
import { PARTIES, partyById } from '../data.js';
import { archive } from './state.js';

// Catalogue of proposable policies. impact = immediate metric changes,
// ongoing = per-year drift while law is active, cost = A$bn/yr added to a line.
export const POLICY_CATALOGUE = [
  { id: 'medicare_boost', title: 'Medicare Expansion Act', econ: -0.3, soc: -0.2,
    desc: 'Bulk-billing incentives and new urgent-care clinics.',
    impact: { health: +6, happiness: +2 }, ongoing: { health: +2 }, line: 'health', cost: 9 },
  { id: 'public_housing', title: 'National Housing Construction Act', econ: -0.4, soc: -0.3,
    desc: 'Commonwealth builds 150,000 social and affordable homes.',
    impact: { housing: +7 }, ongoing: { housing: +2 }, line: 'housing', cost: 11 },
  { id: 'school_funding', title: 'Schools Resourcing Act', econ: -0.3, soc: -0.2,
    desc: 'Lift every school to 100% of the funding standard.',
    impact: { education: +6 }, ongoing: { education: +2 }, line: 'education', cost: 8 },
  { id: 'renewables', title: 'Clean Energy Transition Act', econ: -0.2, soc: -0.5,
    desc: 'Underwrite renewables, storage and transmission.',
    impact: { environment: +8, economy: -1 }, ongoing: { environment: +2 }, line: 'climate', cost: 10 },
  { id: 'tax_cut', title: 'Income Tax Relief Act', econ: +0.6, soc: +0.1,
    desc: 'Across-the-board income tax cuts.',
    impact: { economy: +4, freedom: +2 }, taxDelta: { income: -0.02 } },
  { id: 'corp_cut', title: 'Business Investment Act', econ: +0.7, soc: +0.2,
    desc: 'Cut the company tax rate to spur investment.',
    impact: { economy: +5 }, taxDelta: { company: -0.03 } },
  { id: 'law_order', title: 'Community Safety Act', econ: +0.2, soc: +0.6,
    desc: 'More police, tougher sentencing.',
    impact: { safety: +6, freedom: -3 }, ongoing: { safety: +1 }, line: 'policing', cost: 5 },
  { id: 'defence_up', title: 'National Defence Build-up Act', econ: +0.3, soc: +0.5,
    desc: 'Acquire submarines, missiles and cyber capability.',
    impact: { safety: +4, institutions: +2 }, line: 'defence', cost: 14 },
  { id: 'carbon_price', title: 'Carbon Pricing Act', econ: -0.3, soc: -0.6,
    desc: 'Put a price on carbon emissions.',
    impact: { environment: +6, economy: -3 }, taxDelta: { carbon: +0.04 } },
  { id: 'welfare_raise', title: 'Income Support Increase Act', econ: -0.6, soc: -0.4,
    desc: 'Raise JobSeeker and pensions above the poverty line.',
    impact: { happiness: +4 }, line: 'welfare', cost: 13 },
  { id: 'infra_build', title: 'Nation-Building Infrastructure Act', econ: 0.0, soc: -0.1,
    desc: 'Fast rail, highways and ports.',
    impact: { transport: +7, economy: +2 }, ongoing: { transport: +1 }, line: 'infrastructure', cost: 12 },
  { id: 'integrity', title: 'Federal Integrity Commission Act', econ: 0.0, soc: -0.2,
    desc: 'A powerful anti-corruption watchdog.',
    impact: { institutions: +8 }, ongoing: { institutions: +1 } },
  { id: 'nuclear', title: 'Nuclear Energy Legalisation Act', econ: 0.4, soc: 0.3,
    desc: 'Lift the ban on nuclear power generation.',
    impact: { economy: +1 }, flag: 'nuclearLegal' },
];

export function makeBill(state, policyId, sponsorPolId) {
  const pol = POLICY_CATALOGUE.find((p) => p.id === policyId);
  if (!pol) return null;
  const bill = {
    id: uid('bill'),
    policyId,
    title: pol.title,
    desc: pol.desc,
    econ: pol.econ, soc: pol.soc,
    sponsor: sponsorPolId,
    stage: 'house',     // house → senate → assent → enacted/failed
    introduced: state.tick,
    votes: {},
  };
  state.bills.push(bill);
  archive(state, `Bill introduced: ${bill.title}.`, 'bill');
  return bill;
}

// A single MP's probability of voting Yes on a bill.
function mpVote(rng, mp, bill, govParties) {
  const dist = Math.hypot(mp.econ - bill.econ, mp.soc - bill.soc);
  let yes = clamp(1 - dist / 1.6, 0, 1);   // ideological agreement
  // Party discipline: align with whether the party (by leader ideology) backs it.
  const party = partyById(mp.party);
  const partyDist = Math.hypot(party.econ - bill.econ, party.soc - bill.soc);
  const partyYes = partyDist < 0.8;
  const loyalty = mp.hidden.loyalty / 100;
  yes = yes * (1 - loyalty) + (partyYes ? 0.9 : 0.1) * loyalty;
  // Government members rally behind government bills.
  if (govParties.includes(mp.party) && bill.sponsoredByGov) yes = Math.min(1, yes + 0.25);
  return rng.chance(yes);
}

// Run a chamber vote. Returns {yes,no,pass}.
function chamberVote(state, bill, chamber) {
  const rng = RNG.fromJSON(state.rng);
  const members = state.politicians.filter((p) => p.chamber === chamber);
  let yes = 0;
  for (const mp of members) if (mpVote(rng, mp, bill, state.gov.parties)) yes++;
  state.rng = rng.toJSON();
  const no = members.length - yes;
  return { yes, no, pass: yes > no };
}

// Advance a bill one stage (called periodically or on player action).
export function advanceBill(state, bill) {
  if (bill.stage === 'house') {
    const r = chamberVote(state, bill, 'hor');
    bill.votes.house = r;
    if (r.pass) { bill.stage = 'senate'; archive(state, `${bill.title} passes the House ${r.yes}–${r.no}.`, 'bill'); }
    else { failBill(state, bill, `defeated in the House ${r.yes}–${r.no}`); }
  } else if (bill.stage === 'senate') {
    const r = chamberVote(state, bill, 'senate');
    bill.votes.senate = r;
    if (r.pass) { bill.stage = 'assent'; archive(state, `${bill.title} passes the Senate ${r.yes}–${r.no}.`, 'bill'); }
    else { failBill(state, bill, `blocked in the Senate ${r.yes}–${r.no}`); }
  } else if (bill.stage === 'assent') {
    enactBill(state, bill);
  }
}

function failBill(state, bill, reason) {
  bill.stage = 'failed';
  archive(state, `${bill.title} ${reason}.`, 'bill');
  state.bills = state.bills.filter((b) => b.id !== bill.id);
}

function enactBill(state, bill) {
  const pol = POLICY_CATALOGUE.find((p) => p.id === bill.policyId);
  // immediate metric impacts
  for (const [k, v] of Object.entries(pol.impact || {})) {
    if (k in state.metrics) state.metrics[k] = clamp(state.metrics[k] + v);
  }
  // budget line changes
  if (pol.line && pol.cost) state.budget.spend[pol.line] += pol.cost;
  // tax changes
  for (const [k, v] of Object.entries(pol.taxDelta || {})) {
    state.budget.tax[k] = clamp(state.budget.tax[k] + v, 0, 0.9);
  }
  // special flags (e.g. legalising nuclear power)
  if (pol.flag === 'nuclearLegal' && state.energy) state.energy.nuclearLegal = true;
  const law = {
    id: uid('law'), title: bill.title, policyId: bill.policyId,
    enacted: state.tick, ongoing: pol.ongoing || null, repealable: true,
  };
  state.laws.push(law);
  state.bills = state.bills.filter((b) => b.id !== bill.id);
  archive(state, `✅ ROYAL ASSENT: ${bill.title} is now law.`, 'law');
}

// Repeal an enacted law (reverses ongoing effects; partial reversal of impacts).
export function repealLaw(state, lawId) {
  const law = state.laws.find((l) => l.id === lawId);
  if (!law) return;
  const pol = POLICY_CATALOGUE.find((p) => p.id === law.policyId);
  if (pol) {
    if (pol.line && pol.cost) state.budget.spend[pol.line] = Math.max(0, state.budget.spend[pol.line] - pol.cost);
    for (const [k, v] of Object.entries(pol.taxDelta || {})) {
      state.budget.tax[k] = clamp(state.budget.tax[k] - v, 0, 0.9);
    }
    for (const [k, v] of Object.entries(pol.impact || {})) {
      if (k in state.metrics) state.metrics[k] = clamp(state.metrics[k] - v * 0.5);
    }
  }
  state.laws = state.laws.filter((l) => l.id !== lawId);
  archive(state, `🗑️ ${law.title} has been REPEALED.`, 'law');
}

// AI government periodically introduces & progresses bills aligned with its agenda.
export function aiLegislate(state) {
  const rng = RNG.fromJSON(state.rng);
  // progress existing bills
  for (const bill of [...state.bills]) {
    if (rng.chance(0.5)) advanceBill(state, bill);
  }
  // government introduces a new bill occasionally
  if (state.bills.length < 3 && rng.chance(0.25) && state.gov.pm) {
    const govParty = partyById(state.gov.parties[0]);
    // choose a catalogue item closest to the government's ideology
    const ranked = [...POLICY_CATALOGUE].sort((a, b) =>
      Math.hypot(a.econ - govParty.econ, a.soc - govParty.soc) -
      Math.hypot(b.econ - govParty.econ, b.soc - govParty.soc));
    const pick = ranked[rng.int(0, 2)];
    // don't duplicate an existing law
    if (!state.laws.some((l) => l.policyId === pick.id)) {
      const bill = makeBill(state, pick.id, state.gov.pm);
      bill.sponsoredByGov = true;
    }
  }
  state.rng = rng.toJSON();
}
