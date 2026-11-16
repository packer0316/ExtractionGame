// Game audio. Recorded sound effects (public/sfx, built by tools/sfx_build.py
// from CC0 sources) are used whenever they have loaded; until then, or if a
// file fails, every cue falls back to a sound synthesised with WebAudio.
//
// Routing:  sfx bus ──┐
//           amb bus ──┴─> master -> compressor -> speakers
// The ambience bus carries the machine's idle hum and ticking (the platform's
// "music" switch); everything else is on the sfx bus (its "sound effects" switch).

const ONE_SHOTS = [
  'whoosh', 'hammer_hit', 'glass_crack', 'glass_break', 'glass_shatter', 'glass_slowmo',
  'shard_1', 'shard_2', 'shard_3', 'shard_4', 'spark_1', 'spark_2', 'spark_3', 'power_down',
  'forceps_clamp', 'creak_1', 'creak_2', 'creak_3', 'bone_crack', 'bone_crack_small', 'grind',
  'tooth_pop', 'nerve_snap', 'tooth_drop_1', 'tooth_drop_2', 'tooth_drop_3', 'slip', 'heartbeat',
  'servo_move', 'servo_spin_1', 'servo_spin_2', 'servo_spin_3', 'servo_whine', 'hydraulic', 'air_release',
  'jaw_clunk', 'gear_burst', 'rebuild', 'ratchet',
  'ping', 'chips_1', 'chips_2', 'chips_3', 'coins_1', 'coins_2', 'coins_shower', 'slot_bells',
  'jingle_small', 'jingle_win', 'fanfare_big', 'fanfare_mega', 'fanfare_angel', 'boom', 'bell_heavy', 'lose',
  'ui_click', 'ui_hover', 'bet_1', 'bet_2', 'deny',
];
const LOOPS = ['idle_drone', 'idle_tick', 'servo_loop', 'payout_loop'];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (base, n) => `${base}_${1 + Math.floor(Math.random() * n)}`;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createSfx() {
  let ctx = null, master = null, sfxBus = null, ambBus = null, noise = null;
  let muted = false;
  let unlocked = false;
  let lastTinkle = 0, lastDrop = 0;
  const buffers = new Map();
  const channels = { music: true, sfx: true };
  let preloading = null;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    // a hard limiter after it, so stacked impacts (hammer + shatter + boom) never clip
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.12;
    master.connect(comp).connect(limiter).connect(ctx.destination);
    sfxBus = ctx.createGain();
    ambBus = ctx.createGain();
    sfxBus.connect(master);
    ambBus.connect(master);
    applyChannels();
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  function applyChannels() {
    if (!sfxBus) return;
    const t = ctx.currentTime;
    sfxBus.gain.setTargetAtTime(channels.sfx ? 1 : 0, t, 0.03);
    ambBus.gain.setTargetAtTime(channels.music ? 1 : 0, t, 0.08);
  }

  const now = () => ctx.currentTime;

  // ------------------------------------------------------------------ samples
  async function loadOne(name, ext) {
    try {
      const res = await fetch(`sfx/${name}.${ext}`);
      if (!res.ok) return;
      const data = await res.arrayBuffer();
      buffers.set(name, await ctx.decodeAudioData(data));
    } catch { /* this cue keeps its synthesised fallback */ }
  }

  const has = (name) => buffers.has(name);

  /** Play a recorded sound. Returns false if it is not loaded (caller falls back). */
  function sample(name, { gain = 1, rate = 1, at = 0, bus = 'sfx', offset = 0 } = {}) {
    const b = buffers.get(name);
    if (!b) return false;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus === 'amb' ? ambBus : sfxBus);
    src.start(now() + at, offset);
    return true;
  }

  /** A looping recorded sound whose level and speed can be steered. */
  function loop(name, { gain = 0, rate = 1, bus = 'sfx' } = {}) {
    const b = buffers.get(name);
    if (!b) return null;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus === 'amb' ? ambBus : sfxBus);
    src.start(now(), Math.random() * b.duration);
    return {
      setGain(v, tc = 0.08) { g.gain.setTargetAtTime(v, now(), tc); },
      setRate(r, tc = 0.1) { src.playbackRate.setTargetAtTime(r, now(), tc); },
      stop(fade = 0.2) { g.gain.setTargetAtTime(0, now(), fade / 3); src.stop(now() + fade + 0.05); },
    };
  }

  // ------------------------------------------------------------------ synth
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
    o.connect(g).connect(sfxBus);
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
    src.connect(filt).connect(g).connect(sfxBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.02);
  }

  const ping = (f, gain = 0.12, at = 0, dur = 0.25) => {
    tone({ type: 'sine', f0: f, dur, gain, at });
    tone({ type: 'sine', f0: f * 2.76, dur: dur * 0.5, gain: gain * 0.35, at });
  };
  const thump = (gain = 0.4, f0 = 160, f1 = 50, dur = 0.16) => tone({ f0, f1, dur, gain });

  const guard = (fn) => (...args) => { if (!muted && ensure()) { try { fn(...args); } catch { /* audio is best-effort */ } } };

  // ------------------------------------------------------------------ the machine
  // Running loops: idle hum and ticking, and a servo whose level follows the head.
  const run = { drone: null, tick: null, servo: null, payout: null };
  const motion = { opening: false, closedHit: true, eyeBusy: false, eyeAt: 0, spinAt: 0 };

  function startAmbience() {
    if (!unlocked || run.drone || !has('idle_drone')) return;
    run.drone = loop('idle_drone', { gain: 0, bus: 'amb' });
    run.tick = loop('idle_tick', { gain: 0, bus: 'amb' });
    run.servo = loop('servo_loop', { gain: 0 });
    run.drone?.setGain(0.11, 1.2);
    run.tick?.setGain(0.2, 1.2);
  }

  const sfx = {
    /** Create the audio graph and start fetching the recordings (no sound yet). */
    preload() {
      if (preloading || !ensure()) return preloading;
      preloading = Promise.all([
        ...ONE_SHOTS.map((n) => loadOne(n, 'mp3')),
        ...LOOPS.map((n) => loadOne(n, 'wav')),
      ]).then(() => { startAmbience(); return buffers.size; });
      return preloading;
    },
    get loaded() { return buffers.size; },
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      unlocked = true;
      startAmbience();
    },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.8; },
    get muted() { return muted; },
    /** Platform audio preferences: { musicEnabled, sfxEnabled }. */
    setChannels(s) {
      if (!s) return;
      channels.music = s.musicEnabled !== false;
      channels.sfx = s.sfxEnabled !== false;
      if (ctx) applyChannels();
    },

    /**
     * Called every frame with how the head is moving, so the servos, the jaw
     * pistons and the gears are heard in step with what is seen.
     *   headSpeed  rad/s of the neck joint   jawOpen/jawVel  jaw angle and speed
     *   gearSpeed  extra spin of the gears   eyeMove  how far the irises still have to travel
     */
    motion({ headSpeed = 0, jawOpen = 0, jawVel = 0, gearSpeed = 0, eyeMove = 0 }) {
      if (!ctx || muted || !unlocked) return;
      if (run.servo) {
        const level = clamp((headSpeed - 0.06) * 0.5 + Math.abs(jawVel) * 0.12, 0, 0.5);
        run.servo.setGain(level, 0.05);
        run.servo.setRate(0.85 + Math.min(headSpeed + Math.abs(jawVel) * 0.3, 2.2) * 0.22, 0.06);
      }
      if (run.tick) run.tick.setRate(1 + clamp(gearSpeed, 0, 8) * 0.14, 0.2);
      const t = now();
      // jaw: a puff of air as the pistons drive it open, a clunk as it shuts
      if (!motion.opening && jawVel > 0.9) {
        motion.opening = true;
        if (!sample('air_release', { gain: 0.38, rate: rnd(0.9, 1.1) })) burst({ dur: 0.3, gain: 0.08, f0: 3000, q: 0.8 });
        if (jawVel > 2) sample('hydraulic', { gain: 0.3, rate: rnd(1.0, 1.2) });
      } else if (motion.opening && jawVel < 0.15) motion.opening = false;
      if (jawOpen > 0.12) motion.closedHit = false;
      if (!motion.closedHit && jawOpen < 0.07 && jawVel < -0.6) {
        motion.closedHit = true;
        if (!sample('jaw_clunk', { gain: clamp(Math.abs(jawVel) * 0.22, 0.15, 0.8), rate: rnd(0.85, 1.0) })) thump(0.2, 220, 80, 0.1);
      }
      // the eyes refocus with a short servo whine
      if (eyeMove > 0.14 && !motion.eyeBusy && t - motion.eyeAt > 0.7) {
        motion.eyeBusy = true;
        motion.eyeAt = t;
        sample('servo_whine', { gain: 0.09, rate: rnd(1.3, 1.7) });
      } else if (eyeMove < 0.05) motion.eyeBusy = false;
      // a hard knock sets the gears whirring
      if (gearSpeed > 3 && t - motion.spinAt > 1.2) {
        motion.spinAt = t;
        sample('gear_burst', { gain: clamp(gearSpeed * 0.05, 0.12, 0.4), rate: rnd(0.95, 1.15) });
      }
    },

    // ---- interface
    ui: guard(() => { if (!sample('ui_click', { gain: 0.5 })) tone({ type: 'triangle', f0: 1400, f1: 900, dur: 0.05, gain: 0.08 }); }),
    deny: guard(() => { if (!sample('deny', { gain: 0.35 })) tone({ type: 'square', f0: 160, f1: 110, dur: 0.16, gain: 0.08 }); }),
    hover: guard(() => { if (!sample('ui_hover', { gain: 0.14, rate: rnd(0.95, 1.1) })) tone({ type: 'sine', f0: 2200, dur: 0.03, gain: 0.025 }); }),
    bet: guard(() => { if (!sample(pick('bet', 2), { gain: 0.6, rate: rnd(0.95, 1.08) })) { ping(1900, 0.07, 0, 0.12); ping(2500, 0.05, 0.05, 0.14); } }),

    // ---- movement
    servo: guard((dur = 0.3) => {
      const name = Math.random() < 0.5 ? 'servo_move' : pick('servo_spin', 3);
      if (!sample(name, { gain: 0.32, rate: rnd(0.95, 1.12) })) {
        tone({ type: 'sawtooth', f0: 170, f1: 260, dur, gain: 0.035, curve: 'lin', attack: 0.03 });
        burst({ dur, gain: 0.02, f0: 2600, f1: 3400, q: 6 });
      }
    }),
    whoosh: guard((power = 1) => {
      if (!sample('whoosh', { gain: 0.35 + 0.5 * power, rate: rnd(0.85, 1.1) / (0.8 + 0.2 * power) })) {
        burst({ dur: 0.2, gain: 0.16 * power, f0: 380, f1: 1900, q: 1.2, attack: 0.09 });
      }
    }),

    // ---- hammer on glass
    hammerHit: guard((power = 1) => {
      if (sample('hammer_hit', { gain: 0.5 + 0.5 * power, rate: 1.08 - 0.12 * power })) {
        thump(0.35 * power, 150, 45, 0.2); // the weight behind it
        return;
      }
      tone({ f0: 190, f1: 48, dur: 0.22, gain: 0.55 * power });
      burst({ dur: 0.05, gain: 0.4 * power, type: 'highpass', f0: 1800 });
      tone({ type: 'triangle', f0: 2900, f1: 2300, dur: 0.3, gain: 0.07 * power });
    }),
    glassCrack: guard((power = 1) => {
      if (sample(power < 0.8 ? 'glass_crack' : 'glass_break', { gain: 0.55 + 0.45 * power, rate: rnd(0.95, 1.08) })) return;
      const n = 4 + Math.floor(power * 5);
      for (let i = 0; i < n; i++) burst({ dur: 0.012 + Math.random() * 0.02, gain: 0.3 * power, f0: 3500 + Math.random() * 4500, q: 4, at: Math.random() * 0.16 });
      ping(4200 + Math.random() * 1500, 0.07 * power, 0.02, 0.18);
    }),
    glassShatter: guard(() => {
      if (sample('glass_shatter', { gain: 0.85 })) {
        sample('glass_slowmo', { gain: 0.45, rate: 0.82, at: 0.05 }); // the long glittering tail of the slow motion
        sample('boom', { gain: 0.25, rate: 1.3 });
        return;
      }
      burst({ dur: 0.5, gain: 0.5, type: 'highpass', f0: 2600, f1: 5200 });
      burst({ dur: 0.12, gain: 0.35, f0: 900, q: 0.8 });
      for (let i = 0; i < 22; i++) ping(2400 + Math.random() * 6800, 0.05 + Math.random() * 0.06, Math.random() * 0.75, 0.1 + Math.random() * 0.3);
    }),
    tinkle: guard((power = 1) => {
      const t = performance.now();
      if (t - lastTinkle < 28) return;
      lastTinkle = t;
      if (sample(pick('shard', 4), { gain: Math.min(0.5, 0.12 * power), rate: rnd(0.9, 1.6) })) return;
      ping(2800 + Math.random() * 6000, Math.min(0.09, 0.03 * power), 0, 0.08 + Math.random() * 0.16);
    }),
    zap: guard((gain = 0.12) => {
      if (sample(pick('spark', 3), { gain: clamp(gain * 4, 0.1, 0.6), rate: rnd(0.8, 1.3) })) {
        if (Math.random() < 0.5) sample(pick('spark', 3), { gain: clamp(gain * 3, 0.08, 0.5), rate: rnd(0.8, 1.3), at: rnd(0.03, 0.09) });
        return;
      }
      for (let i = 0; i < 3; i++) burst({ dur: 0.02 + Math.random() * 0.03, gain, f0: 2000 + Math.random() * 5000, q: 2, at: i * 0.035 });
      tone({ type: 'square', f0: 110, f1: 60, dur: 0.1, gain: gain * 0.5 });
    }),
    powerDown: guard(() => {
      if (!sample('power_down', { gain: 0.55 })) tone({ type: 'sawtooth', f0: 320, f1: 40, dur: 0.55, gain: 0.09, curve: 'lin' });
    }),

    // ---- forceps on a tooth
    click: guard(() => {
      if (sample('forceps_clamp', { gain: 0.65, rate: rnd(1.0, 1.15) })) return;
      burst({ dur: 0.012, gain: 0.3, f0: 4200, q: 3 });
      tone({ type: 'triangle', f0: 1900, f1: 1500, dur: 0.05, gain: 0.12 });
    }),
    creak: guard((power = 1) => {
      if (sample(pick('creak', 3), { gain: 0.3 + 0.35 * power, rate: rnd(1.25, 1.7) })) {
        if (power > 0.75 && Math.random() < 0.6) sample('bone_crack_small', { gain: 0.35 * power, rate: rnd(1.1, 1.4), at: rnd(0.02, 0.12) });
        return;
      }
      const dur = 0.24, t = now();
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
      o.connect(f).connect(g).connect(sfxBus);
      o.start(t); o.stop(t + dur + 0.02);
      burst({ dur: dur * 0.8, gain: 0.05 * power, f0: 1700, q: 5 });
    }),
    strain: guard(() => {
      tone({ type: 'sawtooth', f0: 85, f1: 190, dur: 0.34, gain: 0.07, curve: 'lin', attack: 0.2 });
      burst({ dur: 0.34, gain: 0.05, f0: 900, f1: 2600, q: 6, attack: 0.25 });
      sample('grind', { gain: 0.4, rate: rnd(0.9, 1.1) });
    }),
    /** Rising whine while the forceps hauls; `level` 0..1 lifts the pitch. */
    tension: guard((dur = 0.6, level = 0) => {
      const f = 90 + level * 160;
      tone({ type: 'sawtooth', f0: f, f1: f * 2.1, dur, gain: 0.05 + level * 0.035, curve: 'lin', attack: dur * 0.7 });
      tone({ type: 'sine', f0: f * 3, f1: f * 6.5, dur, gain: 0.025 + level * 0.025, curve: 'lin', attack: dur * 0.8 });
      burst({ dur, gain: 0.03 + level * 0.04, f0: 700 + level * 900, f1: 2600 + level * 3000, q: 5, attack: dur * 0.8 });
      // the root grinding in its socket, more of it the harder the pull
      if (has('grind')) {
        const n = 1 + Math.round(level * 3);
        for (let i = 0; i < n; i++) sample('grind', { gain: 0.18 + 0.3 * level, rate: rnd(0.75, 1.15), at: dur * (0.25 + 0.7 * (i / n)) });
        sample(pick('creak', 3), { gain: 0.2 + 0.3 * level, rate: rnd(0.9, 1.2), at: dur * 0.55 });
      }
    }),
    /** The tooth held: the prize climbs a step. */
    step: guard((i = 0) => {
      const semis = [0, 2, 4, 7, 9, 12, 14, 16, 19][Math.min(i, 8)];
      if (has('ping')) {
        sample('bone_crack', { gain: 0.55 + Math.min(i, 6) * 0.06, rate: rnd(0.95, 1.15) }); // it held, with a crack
        sample('ping', { gain: 0.5, rate: 1.0 * Math.pow(2, semis / 12) });
        sample('ping', { gain: 0.22, rate: 2.0 * Math.pow(2, semis / 12), at: 0.04 });
        sample(pick('chips', 3), { gain: 0.45, rate: rnd(0.95, 1.1), at: 0.03 });
        thump(0.25 + Math.min(i, 6) * 0.03, 150, 55, 0.14);
        return;
      }
      const f = 587.33 * Math.pow(2, semis / 12);
      tone({ type: 'triangle', f0: f, dur: 0.5, gain: 0.2 });
      tone({ type: 'sine', f0: f * 2, dur: 0.38, gain: 0.09 });
      tone({ type: 'sine', f0: f * 3.01, dur: 0.22, gain: 0.04 });
      burst({ dur: 0.02, gain: 0.2, f0: 5200, q: 2 });
      thump(0.25 + Math.min(i, 6) * 0.03, 150, 60, 0.14);
    }),
    /** The forceps loses its grip. */
    slip: guard(() => {
      if (sample('slip', { gain: 0.75, rate: rnd(1.0, 1.15) })) { thump(0.35, 210, 70, 0.16); return; }
      burst({ dur: 0.09, gain: 0.3, f0: 6200, f1: 2400, q: 3 });
      tone({ type: 'triangle', f0: 2400, f1: 1300, dur: 0.16, gain: 0.14 });
      tone({ f0: 210, f1: 70, dur: 0.16, gain: 0.4, at: 0.07 });
      burst({ dur: 0.04, gain: 0.3, type: 'highpass', f0: 2200, at: 0.07 });
    }),
    heartbeat: guard(() => {
      if (sample('heartbeat', { gain: 1 })) return;
      tone({ f0: 74, f1: 40, dur: 0.16, gain: 0.5 });
      tone({ f0: 66, f1: 36, dur: 0.2, gain: 0.4, at: 0.2 });
    }),
    pop: guard(() => {
      if (sample('tooth_pop', { gain: 1, rate: rnd(0.95, 1.05) })) {
        thump(0.5, 240, 60, 0.15);
        return;
      }
      tone({ f0: 260, f1: 62, dur: 0.16, gain: 0.6 });
      burst({ dur: 0.07, gain: 0.4, type: 'lowpass', f0: 1500 });
      burst({ dur: 0.2, gain: 0.2, type: 'highpass', f0: 3000 });
      tone({ type: 'triangle', f0: 760, f1: 500, dur: 0.12, gain: 0.14 });
    }),
    snap: guard(() => {
      if (sample('nerve_snap', { gain: 0.8, rate: rnd(1.1, 1.3) })) { sample(pick('spark', 3), { gain: 0.3, at: 0.02 }); return; }
      tone({ type: 'triangle', f0: 1250, f1: 280, dur: 0.11, gain: 0.2 });
      burst({ dur: 0.03, gain: 0.25, f0: 5200, q: 2 });
    }),
    toothDrop: guard((power = 1) => {
      const t = performance.now();
      if (t - lastDrop < 40) return;
      lastDrop = t;
      if (sample(pick('tooth_drop', 3), { gain: Math.min(0.6, 0.18 * power), rate: rnd(1.3, 1.7) })) return;
      const g = Math.min(0.2, 0.07 * power);
      tone({ type: 'triangle', f0: 1700 + Math.random() * 500, f1: 1200, dur: 0.05, gain: g });
      burst({ dur: 0.02, gain: g, f0: 3000, q: 2 });
    }),

    // ---- results
    coin: guard((n = 6) => {
      if (has('coins_1')) {
        const k = Math.min(n, 6);
        for (let i = 0; i < k; i++) {
          const name = i % 3 === 2 ? pick('chips', 3) : pick('coins', 2);
          sample(name, { gain: 0.35, rate: rnd(0.9, 1.2), at: 0.08 + i * 0.07 + Math.random() * 0.03 });
        }
        return;
      }
      for (let i = 0; i < n; i++) ping(3000 + Math.random() * 2600, 0.045, 0.1 + i * 0.045 + Math.random() * 0.03, 0.09);
    }),
    win: guard((tier) => {
      if (tier === 'small' && sample('jingle_small', { gain: 0.45 })) return;
      if (tier === 'win' && sample('jingle_win', { gain: 0.55 })) { sample('coins_1', { gain: 0.4, at: 0.1 }); return; }
      const scale = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093];
      const notes = { small: [0, 1], win: [0, 1, 2, 3], big: [0, 2, 3, 4, 5], mega: [0, 2, 3, 4, 5, 6, 5, 6] }[tier] || [];
      notes.forEach((nn, i) => {
        tone({ type: 'triangle', f0: scale[nn], dur: 0.32, gain: 0.16, at: i * 0.075 });
        tone({ type: 'sine', f0: scale[nn] * 2, dur: 0.22, gain: 0.05, at: i * 0.075 });
      });
    }),
    lose: guard(() => {
      if (sample('lose', { gain: 0.4 })) return;
      tone({ type: 'triangle', f0: 220, f1: 196, dur: 0.22, gain: 0.12 });
      tone({ type: 'triangle', f0: 164.8, f1: 146.8, dur: 0.34, gain: 0.12, at: 0.14 });
    }),
    /** Deep boom with a tail, for the moment a prize tooth lets go. */
    boom: guard((power = 1) => {
      if (sample('boom', { gain: clamp(0.65 * power, 0.2, 1) })) return;
      tone({ f0: 120, f1: 28, dur: 0.9, gain: 0.6 * power });
      burst({ dur: 0.5, gain: 0.3 * power, type: 'lowpass', f0: 900, f1: 120 });
      burst({ dur: 0.9, gain: 0.12 * power, type: 'highpass', f0: 5000, f1: 9000, attack: 0.02 });
    }),
    shimmer: guard((n = 10, dur = 1.2) => {
      if (has('ping')) {
        for (let i = 0; i < n; i++) sample('ping', { gain: rnd(0.08, 0.18), rate: rnd(1.8, 3.2), at: Math.random() * dur });
        return;
      }
      for (let i = 0; i < n; i++) ping(3200 + Math.random() * 5200, 0.035, Math.random() * dur, 0.2 + Math.random() * 0.2);
    }),
    /** Fanfare for the big ones. tier: 'big' | 'mega' | 'jackpot' */
    fanfare: guard((tier = 'big') => {
      if (has('fanfare_big')) {
        if (tier === 'big') {
          sample('fanfare_big', { gain: 0.85 });
          sample('coins_2', { gain: 0.35, at: 0.25 });
        } else {
          sample('fanfare_mega', { gain: 0.85 });
          sample('slot_bells', { gain: 0.5, at: 0.15 });
          sample('coins_shower', { gain: tier === 'jackpot' ? 0.55 : 0.4, at: 0.3 });
          if (tier === 'jackpot') {
            sample('fanfare_angel', { gain: 0.6, at: 0.5 });
            sample('slot_bells', { gain: 0.4, rate: 1.12, at: 1.6 });
          }
        }
        return;
      }
      const root = 261.63;
      const runN = { big: [0, 4, 7, 12, 16], mega: [0, 4, 7, 12, 16, 19, 24], jackpot: [0, 4, 7, 12, 16, 19, 24, 28, 31] }[tier] || [0, 4, 7];
      runN.forEach((nn, i) => {
        const f = root * Math.pow(2, nn / 12);
        tone({ type: 'triangle', f0: f, dur: 0.36, gain: 0.17, at: i * 0.085 });
        tone({ type: 'sawtooth', f0: f, dur: 0.2, gain: 0.035, at: i * 0.085 });
      });
      const end = runN.length * 0.085, top = runN[runN.length - 1];
      for (const nn of [top - 12, top - 8, top - 5, top]) tone({ type: 'triangle', f0: root * Math.pow(2, nn / 12), dur: tier === 'big' ? 1.1 : 1.9, gain: 0.11, at: end });
      tone({ type: 'sine', f0: root / 2, dur: tier === 'big' ? 1.2 : 2.0, gain: 0.24, at: end });
      const shower = tier === 'big' ? 18 : tier === 'mega' ? 36 : 60;
      for (let i = 0; i < shower; i++) ping(2800 + Math.random() * 3600, 0.04, end + Math.random() * (tier === 'big' ? 1.2 : 2.4), 0.1);
    }),
    /** The win counting up on screen: the slot machine pays out, then a bell. */
    countUp: guard((seconds = 1.2, tier = 'big') => {
      const pay = loop('payout_loop', { gain: 0, rate: tier === 'big' ? 1 : 1.08 });
      if (!pay) {
        const n = Math.round(seconds / 0.06);
        for (let i = 0; i < n; i++) ping(2600 + i * 18, 0.03, i * 0.06, 0.05);
        ping(1568, 0.12, seconds, 0.6);
        return;
      }
      pay.setGain(tier === 'big' ? 0.45 : 0.55, 0.04);
      setTimeout(() => {
        pay.stop(0.25);
        sample('bell_heavy', { gain: tier === 'big' ? 0.55 : 0.75, rate: tier === 'jackpot' ? 0.9 : 1 });
        sample('ping', { gain: 0.45, rate: 2 });
      }, seconds * 1000);
    }),
    /** A tooth clicking back into its socket during the rebuild (many in a row, so quiet). */
    seat: guard(() => {
      if (sample(pick('tooth_drop', 3), { gain: 0.16, rate: rnd(1.8, 2.3) })) return;
      burst({ dur: 0.012, gain: 0.12, f0: 4200, q: 3 });
    }),
    rebuild: guard(() => {
      if (sample('rebuild', { gain: 0.6 })) {
        sample('ratchet', { gain: 0.45, at: 0.6 });
        sample(pick('servo_spin', 3), { gain: 0.3, at: 0.1 });
        return;
      }
      tone({ type: 'sawtooth', f0: 90, f1: 420, dur: 0.9, gain: 0.05, curve: 'lin', attack: 0.3 });
      for (let i = 0; i < 16; i++) {
        burst({ dur: 0.012, gain: 0.16, f0: 3600 + Math.random() * 1600, q: 3, at: 0.55 + i * 0.05 });
        tone({ type: 'triangle', f0: 1500 + i * 45, dur: 0.04, gain: 0.05, at: 0.55 + i * 0.05 });
      }
    }),
  };
  return sfx;
}
