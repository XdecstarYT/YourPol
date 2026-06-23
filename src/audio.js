// audio.js — a fully procedural sound & music engine built on the Web Audio API.
// Zero external assets: every sound is synthesised at runtime, so the game ships
// with audio that works completely offline. Respects an enabled/volume setting
// and only starts after a user gesture (browser autoplay policy).

let ctx = null;
let master = null;
let musicGain = null;
let musicTimer = null;
const settings = { enabled: true, volume: 0.6, music: true };

function ensure() {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;        // headless / SSR
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = settings.volume;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.18;
    musicGain.connect(master);
  } catch (e) { console.warn('Audio unavailable', e); }
  return ctx;
}

export function configureAudio(opts = {}) {
  Object.assign(settings, opts);
  if (master) master.gain.value = settings.enabled ? settings.volume : 0;
  if (!settings.music) stopMusic(); else if (settings.enabled) startMusic();
}
export function getAudioSettings() { return { ...settings }; }

function tone({ freq = 440, dur = 0.12, type = 'sine', gain = 0.3, attack = 0.005, decay = null, slideTo = null, delay = 0 }) {
  if (!settings.enabled) return;
  if (!ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + (decay ?? dur));
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + (decay ?? dur) + 0.02);
}

function noise({ dur = 0.3, gain = 0.2, filter = 1000, delay = 0 }) {
  if (!settings.enabled || !ensure()) return;
  const t0 = ctx.currentTime + delay;
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0);
}

// Named sound effects.
const SFX = {
  click:   () => tone({ freq: 420, dur: 0.06, type: 'triangle', gain: 0.18 }),
  hover:   () => tone({ freq: 600, dur: 0.03, type: 'sine', gain: 0.06 }),
  tab:     () => tone({ freq: 520, dur: 0.05, type: 'square', gain: 0.10 }),
  success: () => { tone({ freq: 523, dur: 0.1, type: 'sine', gain: 0.22 }); tone({ freq: 784, dur: 0.16, type: 'sine', gain: 0.22, delay: 0.09 }); },
  fail:    () => { tone({ freq: 200, dur: 0.18, type: 'sawtooth', gain: 0.2, slideTo: 110 }); },
  alert:   () => { tone({ freq: 880, dur: 0.12, type: 'square', gain: 0.18 }); tone({ freq: 880, dur: 0.12, type: 'square', gain: 0.18, delay: 0.18 }); },
  law:     () => { tone({ freq: 392, dur: 0.1, gain: 0.2 }); tone({ freq: 523, dur: 0.1, gain: 0.2, delay: 0.08 }); tone({ freq: 659, dur: 0.2, gain: 0.2, delay: 0.16 }); },
  gavel:   () => { noise({ dur: 0.08, gain: 0.4, filter: 1800 }); tone({ freq: 180, dur: 0.1, type: 'square', gain: 0.2 }); },
  election:() => { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.22, gain: 0.22, delay: i * 0.12 })); },
  achieve: () => { [659, 880, 1318].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'triangle', gain: 0.25, delay: i * 0.1 })); },
  count:   () => tone({ freq: 700, dur: 0.03, type: 'sine', gain: 0.08 }),
};
export function sfx(name) { (SFX[name] || (() => {}))(); }

// Ambient generative "music": a slow, calm chord pad cycle — statesmanlike.
const CHORDS = [
  [220, 277, 330], [196, 247, 294], [247, 311, 370], [165, 220, 262],
];
let chordIdx = 0;
export function startMusic() {
  if (!settings.enabled || !settings.music || musicTimer) return;
  if (!ensure()) return;
  const playChord = () => {
    const chord = CHORDS[chordIdx % CHORDS.length]; chordIdx++;
    chord.forEach((f) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 1.5);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 5.5);
      osc.connect(g); g.connect(musicGain);
      osc.start(); osc.stop(ctx.currentTime + 6);
    });
  };
  playChord();
  musicTimer = setInterval(playChord, 6000);
}
export function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

// Unlock audio on first interaction.
export function unlockAudio() { if (ensure() && ctx.state === 'suspended') ctx.resume(); }
