// Every sound in the game is synthesised with WebAudio: no audio files.

export function createSfx() {
  let ctx = null, master = null, noise = null;
  let muted = false;
  let lastTinkle = 0;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  const now = () => ctx.currentTime;

  function tone({ type = 'sine', f0, f1 = f0, dur = 0.2, gain = 0.3, at = 0, attack = 0.002, curve = 'exp' }) {
    const t = now() + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function burst({ dur = 0.1, gain = 0.3, at = 0, type = 'bandpass', f0 = 2000, f1 = f0, q = 1, attack = 0.001 }) {
    const t = now() + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(master);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.02);
  }

  const ping = (f, gain = 0.12, at = 0, dur = 0.25) => {
    tone({ type: 'sine', f0: f, dur, gain, at });
    tone({ type: 'sine', f0: f * 2.76, dur: dur * 0.5, gain: gain * 0.35, at });
  };

  const guard = (fn) => (...args) => { if (!muted && ensure()) { try { fn(...args); } catch { /* audio is best-effort */ } } };

  const sfx = {
    unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.8; },
    get muted() { return muted; },

    ui: guard(() => { tone({ type: 'triangle', f0: 1400, f1: 900, dur: 0.05, gain: 0.08 }); }),
    deny: guard(() => { tone({ type: 'square', f0: 160, f1: 110, dur: 0.16, gain: 0.08 }); }),
    hover: guard(() => { tone({ type: 'sine', f0: 2200, dur: 0.03, gain: 0.025 }); }),
    bet: guard(() => { ping(1900, 0.07, 0, 0.12); ping(2500, 0.05, 0.05, 0.14); }),

    servo: guard((dur = 0.3) => {
      tone({ type: 'sawtooth', f0: 170, f1: 260, dur, gain: 0.035, curve: 'lin', attack: 0.03 });
      burst({ dur, gain: 0.02, f0: 2600, f1: 3400, q: 6 });
    }),
    whoosh: guard((power = 1) => {
      burst({ dur: 0.2, gain: 0.16 * power, f0: 380, f1: 1900, q: 1.2, attack: 0.09 });
    }),
    hammerHit: guard((power = 1) => {
      tone({ f0: 190, f1: 48, dur: 0.22, gain: 0.55 * power });
      burst({ dur: 0.05, gain: 0.4 * power, type: 'highpass', f0: 1800 });
      tone({ type: 'triangle', f0: 2900, f1: 2300, dur: 0.3, gain: 0.07 * power }); // ring of the steel head
    }),
    glassCrack: guard((power = 1) => {
      const n = 4 + Math.floor(power * 5);
      for (let i = 0; i < n; i++) {
        const at = Math.random() * 0.16;
        burst({ dur: 0.012 + Math.random() * 0.02, gain: 0.3 * power, f0: 3500 + Math.random() * 4500, q: 4, at });
      }
      ping(4200 + Math.random() * 1500, 0.07 * power, 0.02, 0.18);
    }),
    glassShatter: guard(() => {
      burst({ dur: 0.5, gain: 0.5, type: 'highpass', f0: 2600, f1: 5200 });
      burst({ dur: 0.12, gain: 0.35, f0: 900, q: 0.8 });
      for (let i = 0; i < 22; i++) ping(2400 + Math.random() * 6800, 0.05 + Math.random() * 0.06, Math.random() * 0.75, 0.1 + Math.random() * 0.3);
    }),
    tinkle: guard((power = 1) => {
      const t = performance.now();
      if (t - lastTinkle < 28) return;
      lastTinkle = t;
      ping(2800 + Math.random() * 6000, Math.min(0.09, 0.03 * power), 0, 0.08 + Math.random() * 0.16);
    }),

    click: guard(() => {
      burst({ dur: 0.012, gain: 0.3, f0: 4200, q: 3 });
      tone({ type: 'triangle', f0: 1900, f1: 1500, dur: 0.05, gain: 0.12 });
    }),
    creak: guard((power = 1) => {
      const dur = 0.24;
      const t = now();
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(62 + power * 22, t);
      o.frequency.linearRampToValueAtTime(96 + power * 44, t + dur * 0.6);
      o.frequency.linearRampToValueAtTime(70 + power * 20, t + dur);
      f.type = 'bandpass'; f.Q.value = 7;
      f.frequency.setValueAtTime(520, t);
      f.frequency.linearRampToValueAtTime(1150 + power * 500, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.28 * power, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f).connect(g).connect(master);
      o.start(t); o.stop(t + dur + 0.02);
      burst({ dur: dur * 0.8, gain: 0.05 * power, f0: 1700, q: 5 });
    }),
    strain: guard(() => {
      tone({ type: 'sawtooth', f0: 85, f1: 190, dur: 0.34, gain: 0.07, curve: 'lin', attack: 0.2 });
      burst({ dur: 0.34, gain: 0.05, f0: 900, f1: 2600, q: 6, attack: 0.25 });
    }),
    pop: guard(() => {
      tone({ f0: 260, f1: 62, dur: 0.16, gain: 0.6 });
      burst({ dur: 0.07, gain: 0.4, type: 'lowpass', f0: 1500 });
      burst({ dur: 0.2, gain: 0.2, type: 'highpass', f0: 3000 });
      tone({ type: 'triangle', f0: 760, f1: 500, dur: 0.12, gain: 0.14 });
    }),
    snap: guard(() => {
      tone({ type: 'triangle', f0: 1250, f1: 280, dur: 0.11, gain: 0.2 });
      burst({ dur: 0.03, gain: 0.25, f0: 5200, q: 2 });
    }),
    zap: guard((gain = 0.12) => {
      for (let i = 0; i < 3; i++) burst({ dur: 0.02 + Math.random() * 0.03, gain, f0: 2000 + Math.random() * 5000, q: 2, at: i * 0.035 });
      tone({ type: 'square', f0: 110, f1: 60, dur: 0.1, gain: gain * 0.5 });
    }),
    toothDrop: guard((power = 1) => {
      const g = Math.min(0.2, 0.07 * power);
      tone({ type: 'triangle', f0: 1700 + Math.random() * 500, f1: 1200, dur: 0.05, gain: g });
      burst({ dur: 0.02, gain: g, f0: 3000, q: 2 });
    }),
    powerDown: guard(() => {
      tone({ type: 'sawtooth', f0: 320, f1: 40, dur: 0.55, gain: 0.09, curve: 'lin' });
    }),

    coin: guard((n = 6) => {
      for (let i = 0; i < n; i++) ping(3000 + Math.random() * 2600, 0.045, 0.1 + i * 0.045 + Math.random() * 0.03, 0.09);
    }),
    win: guard((tier) => {
      const scale = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093];
      const notes = { small: [0, 1], win: [0, 1, 2, 3], big: [0, 2, 3, 4, 5], mega: [0, 2, 3, 4, 5, 6, 5, 6] }[tier] || [];
      notes.forEach((n, i) => {
        tone({ type: 'triangle', f0: scale[n], dur: 0.32, gain: 0.16, at: i * 0.075 });
        tone({ type: 'sine', f0: scale[n] * 2, dur: 0.22, gain: 0.05, at: i * 0.075 });
      });
      if (tier === 'big' || tier === 'mega') {
        tone({ type: 'sine', f0: 130.8, dur: 0.9, gain: 0.2, at: 0 });
        tone({ type: 'triangle', f0: 261.6, dur: 1.1, gain: 0.1, at: 0.3 });
      }
    }),
    lose: guard(() => {
      tone({ type: 'triangle', f0: 220, f1: 196, dur: 0.22, gain: 0.12 });
      tone({ type: 'triangle', f0: 164.8, f1: 146.8, dur: 0.34, gain: 0.12, at: 0.14 });
    }),

    // ---- the struggle: every time the tooth holds, the prize climbs a step
    /** Bell for step `i` of the ladder; each step rings a note higher. */
    step: guard((i = 0) => {
      const f = 587.33 * Math.pow(2, [0, 2, 4, 7, 9, 12, 14, 16, 19][Math.min(i, 8)] / 12);
      tone({ type: 'triangle', f0: f, dur: 0.5, gain: 0.2 });
      tone({ type: 'sine', f0: f * 2, dur: 0.38, gain: 0.09 });
      tone({ type: 'sine', f0: f * 3.01, dur: 0.22, gain: 0.04 });
      burst({ dur: 0.02, gain: 0.2, f0: 5200, q: 2 });
      tone({ f0: 150, f1: 60, dur: 0.14, gain: 0.25 + Math.min(i, 6) * 0.03 });
    }),
    /** Rising whine while the forceps hauls; `level` 0..1 lifts the pitch. */
    tension: guard((dur = 0.6, level = 0) => {
      const f = 90 + level * 160;
      tone({ type: 'sawtooth', f0: f, f1: f * 2.1, dur, gain: 0.06 + level * 0.04, curve: 'lin', attack: dur * 0.7 });
      tone({ type: 'sine', f0: f * 3, f1: f * 6.5, dur, gain: 0.03 + level * 0.03, curve: 'lin', attack: dur * 0.8 });
      burst({ dur, gain: 0.04 + level * 0.05, f0: 700 + level * 900, f1: 2600 + level * 3000, q: 5, attack: dur * 0.8 });
    }),
    /** The forceps loses its grip. */
    slip: guard(() => {
      burst({ dur: 0.09, gain: 0.3, f0: 6200, f1: 2400, q: 3 });
      tone({ type: 'triangle', f0: 2400, f1: 1300, dur: 0.16, gain: 0.14 });
      tone({ f0: 210, f1: 70, dur: 0.16, gain: 0.4, at: 0.07 });
      burst({ dur: 0.04, gain: 0.3, type: 'highpass', f0: 2200, at: 0.07 });
    }),
    heartbeat: guard(() => {
      tone({ f0: 74, f1: 40, dur: 0.16, gain: 0.5 });
      tone({ f0: 66, f1: 36, dur: 0.2, gain: 0.4, at: 0.2 });
    }),
    /** Deep boom with a tail, for the moment a prize tooth lets go. */
    boom: guard((power = 1) => {
      tone({ f0: 120, f1: 28, dur: 0.9, gain: 0.6 * power });
      burst({ dur: 0.5, gain: 0.3 * power, type: 'lowpass', f0: 900, f1: 120 });
      burst({ dur: 0.9, gain: 0.12 * power, type: 'highpass', f0: 5000, f1: 9000, attack: 0.02 });
    }),
    shimmer: guard((n = 10, dur = 1.2) => {
      for (let i = 0; i < n; i++) ping(3200 + Math.random() * 5200, 0.035, Math.random() * dur, 0.2 + Math.random() * 0.2);
    }),
    /** Fanfare for the big ones. tier: 'big' | 'mega' | 'jackpot' */
    fanfare: guard((tier = 'big') => {
      const root = 261.63;
      const run = { big: [0, 4, 7, 12, 16], mega: [0, 4, 7, 12, 16, 19, 24], jackpot: [0, 4, 7, 12, 16, 19, 24, 28, 31] }[tier] || [0, 4, 7];
      run.forEach((n, i) => {
        const f = root * Math.pow(2, n / 12);
        tone({ type: 'triangle', f0: f, dur: 0.36, gain: 0.17, at: i * 0.085 });
        tone({ type: 'sawtooth', f0: f, dur: 0.2, gain: 0.035, at: i * 0.085 });
      });
      // the chord it lands on, held
      const end = run.length * 0.085;
      const top = run[run.length - 1];
      for (const n of [top - 12, top - 8, top - 5, top]) {
        tone({ type: 'triangle', f0: root * Math.pow(2, n / 12), dur: tier === 'big' ? 1.1 : 1.9, gain: 0.11, at: end });
      }
      tone({ type: 'sine', f0: root / 2, dur: tier === 'big' ? 1.2 : 2.0, gain: 0.24, at: end });
      const shower = tier === 'big' ? 18 : tier === 'mega' ? 36 : 60;
      for (let i = 0; i < shower; i++) ping(2800 + Math.random() * 3600, 0.04, end + Math.random() * (tier === 'big' ? 1.2 : 2.4), 0.1);
    }),
    rebuild: guard(() => {
      tone({ type: 'sawtooth', f0: 90, f1: 420, dur: 0.9, gain: 0.05, curve: 'lin', attack: 0.3 });
      for (let i = 0; i < 16; i++) {
        burst({ dur: 0.012, gain: 0.16, f0: 3600 + Math.random() * 1600, q: 3, at: 0.55 + i * 0.05 });
        tone({ type: 'triangle', f0: 1500 + i * 45, dur: 0.04, gain: 0.05, at: 0.55 + i * 0.05 });
      }
    }),
  };
  return sfx;
}
