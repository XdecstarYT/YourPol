// engine.js — low-level engine services shared by all systems.
// Deliberately dependency-free so the whole game runs from a static server.

/* ----------------------------------------------------------------------------
 * Seeded RNG (Mulberry32). Deterministic given a seed → reproducible playthroughs,
 * essential for a simulation where saves/replays must be stable.
 * ------------------------------------------------------------------------- */
export class RNG {
  constructor(seed = Date.now()) {
    this.seed = seed >>> 0;
    this._s = this.seed;
  }
  next() {
    let t = (this._s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min, max) { return min + this.next() * (max - min); }
  int(min, max) { return Math.floor(this.range(min, max + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  // Approx normal via central limit; clamped helper for trait rolls.
  normal(mean = 0, sd = 1) {
    let s = 0; for (let i = 0; i < 6; i++) s += this.next();
    return mean + (s - 3) / 3 * sd * 3 / Math.sqrt(3);
  }
  weighted(pairs) { // pairs: [[item, weight], ...]
    const total = pairs.reduce((a, [, w]) => a + w, 0);
    let r = this.next() * total;
    for (const [item, w] of pairs) { if ((r -= w) <= 0) return item; }
    return pairs[pairs.length - 1][0];
  }
  toJSON() { return { seed: this.seed, s: this._s }; }
  static fromJSON(j) { const r = new RNG(j.seed); r._s = j.s; return r; }
}

/* ----------------------------------------------------------------------------
 * Tiny synchronous event bus. Systems emit; UI and other systems subscribe.
 * Keeps simulation decoupled from rendering.
 * ------------------------------------------------------------------------- */
export class EventBus {
  constructor() { this._h = new Map(); }
  on(type, fn) {
    if (!this._h.has(type)) this._h.set(type, new Set());
    this._h.get(type).add(fn);
    return () => this._h.get(type)?.delete(fn);
  }
  emit(type, payload) {
    this._h.get(type)?.forEach((fn) => fn(payload));
    this._h.get('*')?.forEach((fn) => fn({ type, payload }));
  }
}

/* ----------------------------------------------------------------------------
 * Game clock. The world runs in monthly ticks from Jan 2026.
 * ------------------------------------------------------------------------- */
export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function fmtDate(tick) {           // tick 0 = Jan 2026
  const y = 2026 + Math.floor(tick / 12);
  const m = MONTHS[tick % 12];
  return `${m} ${y}`;
}
export function year(tick) { return 2026 + Math.floor(tick / 12); }

/* ----------------------------------------------------------------------------
 * Utility helpers.
 * ------------------------------------------------------------------------- */
export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
export const round = (v, d = 0) => { const p = 10 ** d; return Math.round(v * p) / p; };
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
export function fmtMoney(billions) {       // input in A$ billions
  if (Math.abs(billions) >= 1000) return `$${round(billions / 1000, 2)}T`;
  if (Math.abs(billions) >= 1) return `$${round(billions, 1)}B`;
  return `$${round(billions * 1000)}M`;
}
export function fmtPct(v, d = 1) { return `${round(v, d)}%`; }
export const uid = (() => { let n = 1; return (p = 'id') => `${p}_${n++}`; })();

/* ----------------------------------------------------------------------------
 * Save / load to localStorage. The whole game state is a plain serialisable
 * object tree, so persistence is just JSON with a small amount of RNG fixup.
 * ------------------------------------------------------------------------- */
const SAVE_KEY = 'yourpol_save_v1';
export function saveGame(state) {
  try {
    const data = JSON.stringify(state, (k, v) => (k === '_transient' ? undefined : v));
    localStorage.setItem(SAVE_KEY, data);
    return true;
  } catch (e) { console.error('Save failed', e); return false; }
}
export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { console.error('Load failed', e); return null; }
}
export function hasSave() { return !!localStorage.getItem(SAVE_KEY); }
