// sim/voting.js — pure preferential-voting maths shared by world init and the
// live election system. No state, no DOM: just votes in, results out.

import { PARTIES, COALITION, partyById } from '../data.js';

// Ideological proximity of a party to a point (electorate or voter) in 2-D space.
// Returns a positive affinity that falls with distance and rises with brand.
export function ideologyAffinity(party, point) {
  const d = Math.hypot(party.econ - point.econ, party.soc - point.soc);
  return Math.max(0.01, (1.5 - d)) * (party.base * 3 + 0.3);
}

// First-preference vote shares (%) for a single electorate, blending national
// party support with how well each party matches the seat, plus optional jitter.
export function firstPreferences(point, nationalSupport, jitter = () => 1) {
  const raw = {};
  let tot = 0;
  for (const p of PARTIES) {
    const aff = ideologyAffinity(p, point);
    const nat = (nationalSupport?.[p.id] ?? p.base * 100);
    const v = Math.max(0.1, aff * nat * jitter(p));
    raw[p.id] = v; tot += v;
  }
  const fp = {};
  for (const id of Object.keys(raw)) fp[id] = (raw[id] / tot) * 100;
  return fp;
}

// Instant-runoff count. Preferences flow to the nearest ideological neighbour
// still in the count. Returns the winner, the final two (two-candidate-preferred)
// and their shares — exactly the figures an AEC-style result reports.
export function preferentialCount(firstPrefs) {
  const live = { ...firstPrefs };
  const eliminated = [];
  while (true) {
    const entries = Object.entries(live).filter(([, v]) => v > 0);
    const total = entries.reduce((a, [, v]) => a + v, 0);
    entries.sort((a, b) => b[1] - a[1]);
    if (entries.length <= 2 || entries[0][1] > total / 2) {
      const two = entries.slice(0, 2);
      const tt = two.reduce((a, [, v]) => a + v, 0) || 1;
      return {
        winner: entries[0][0],
        two: two.map(([id]) => id),
        twoShares: { [two[0][0]]: (two[0][1] / tt) * 100, [two[1]?.[0]]: ((two[1]?.[1] || 0) / tt) * 100 },
        margin: ((two[0][1] - (two[1]?.[1] || 0)) / tt) * 100 / 2 + 0,
        eliminated,
      };
    }
    const [loserId, loserVotes] = entries[entries.length - 1];
    eliminated.push(loserId);
    delete live[loserId];
    const loser = partyById(loserId);
    const rem = Object.keys(live);
    const w = rem.map((id) => {
      const p = partyById(id);
      return [id, 1 / (0.12 + Math.hypot(p.econ - loser.econ, p.soc - loser.soc))];
    });
    const wt = w.reduce((a, [, x]) => a + x, 0);
    for (const [id, x] of w) live[id] += loserVotes * (x / wt);
  }
}

// Classic two-party-preferred: distribute every vote to Labor or the Coalition.
// Returns { alp, coalition } percentages summing to 100.
export function twoPartyPreferred(firstPrefs) {
  let alp = firstPrefs.alp || 0;
  let coal = (firstPrefs.lib || 0) + (firstPrefs.nat || 0);
  for (const [id, v] of Object.entries(firstPrefs)) {
    if (id === 'alp' || COALITION.includes(id)) continue;
    const p = partyById(id);
    const dAlp = Math.hypot(p.econ - (-0.45), p.soc - (-0.25));
    const dCoal = Math.hypot(p.econ - 0.48, p.soc - 0.33);
    // softer split: minor-party voters split by relative proximity
    const toAlp = dCoal / (dAlp + dCoal);
    alp += v * toAlp; coal += v * (1 - toAlp);
  }
  const t = alp + coal || 1;
  return { alp: (alp / t) * 100, coalition: (coal / t) * 100 };
}
