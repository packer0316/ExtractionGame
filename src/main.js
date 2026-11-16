import * as THREE from 'three';
import { createStage } from './scene/stage.js';
import { createHead } from './model/head.js';
import { Animator } from './util/anim.js';
import { Debris } from './fx/debris.js';
import { createParticles } from './fx/particles.js';
import { createAwardFx } from './fx/award.js';
import { createSfx } from './audio/sfx.js';
import { createHammer, createForceps } from './tools/tools.js';
import { createActions } from './game/actions.js';
import { createGame } from './game/game.js';
import { ZONES } from './game/paytable.js';
import { createHud, targetLabel } from './ui/hud.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('cam') || params.has('fixed'); // deterministic mode for screenshots

async function boot() {
  const canvas = document.getElementById('stage');
  const stage = createStage(canvas);
  const anim = new Animator(); // world time (slows in slow motion)
  const real = new Animator(); // wall-clock time
  const time = { warp: 1, turbo: 1 };
  const head = await createHead();
  stage.scene.add(head.root);

  const sfx = createSfx();
  const debris = new Debris(stage.scene);
  const fx = createParticles(stage.scene);
  const hammer = createHammer(head.mats);
  const forceps = createForceps(head.mats);
  const award = createAwardFx(stage.scene, stage.camera);
  const actions = createActions({ stage, head, anim, real, time, debris, fx, award, sfx, hammer, forceps });
  const game = createGame([...head.targets.keys()]);

  // ------------------------------------------------------------ debug switches
  if (params.get('clay')) {
    const clay = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    head.root.traverse((o) => { if (o.isMesh && o.material.visible !== false) o.material = clay; });
  }
  if (params.get('cam')) {
    const v = params.get('cam').split(',').map(Number);
    stage.camera.position.set(v[0], v[1], v[2]);
    stage.controls.target.set(v[3], v[4], v[5]);
    stage.controls.update();
  }
  if (params.get('jaw')) head.setJaw(Number(params.get('jaw')));
  if (params.get('still')) head.idle = false;

  // ------------------------------------------------------------ picking
  const pickables = [];
  for (const t of head.targets.values()) {
    if (t.kind === 'eye') { pickables.push(t.eye.hit); continue; }
    // a generous invisible box around each crown is easier to hit than the tooth itself
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(t.info.width * 1.02, t.info.crown + 0.05, 0.13),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.y = t.info.crown * 0.5;
    hit.userData.targetId = t.id;
    t.seat.add(hit);
    t.hit = hit;
    pickables.push(hit);
  }
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (ev) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
    for (const h of raycaster.intersectObjects(pickables, false)) {
      const id = h.object.userData.targetId;
      if (!game.state.results.has(id)) return id;
    }
    return null;
  };

  // ------------------------------------------------------------ hover feedback
  let hovered = null;
  const pointer = { x: 0, y: 0 };
  function setHover(id, source) {
    if (game.state.busy) id = null;
    if (id !== hovered) {
      const prev = hovered && head.targets.get(hovered);
      if (prev) highlight(prev, false);
      hovered = id;
      const cur = id && head.targets.get(id);
      if (cur && !game.state.results.has(id)) { highlight(cur, true); sfx.hover(); }
    }
    canvas.classList.toggle('pointing', !!id && source !== 'chart');
    if (id) {
      const reason = game.check(id);
      if (source === 'chart') hud.hover(id, window.innerWidth - 470, pointer.y, reason);
      else hud.hover(id, pointer.x, pointer.y, reason);
    } else hud.hover(null);
  }
  function highlight(t, on) {
    if (t.kind === 'eye') { t.eye.hover = on; return; }
    const mat = t.mesh.material;
    mat.emissive.set(on ? 0x39c6ee : 0x000000);
    mat.emissiveIntensity = on ? 0.55 : 0;
  }

  // ------------------------------------------------------------ play
  const screenPos = new THREE.Vector3();
  async function play(id, force) {
    sfx.unlock();
    const reason = game.check(id);
    if (reason !== 'ok') {
      if (reason === 'funds') { sfx.deny(); hud.setMessage('籌碼不足 — 請降低下注或補充籌碼', 'warn'); }
      return reason;
    }
    const t = head.targets.get(id);
    setHover(null);
    const outcome = game.place(id, t.zone, force);
    sfx.bet();
    hud.setMessage(`${targetLabel(id)} — 下注 ${outcome.bet}`, 'good');
    const toScreen = (worldPos) => {
      screenPos.copy(worldPos).project(stage.camera);
      return [(screenPos.x * 0.5 + 0.5) * window.innerWidth, (-screenPos.y * 0.5 + 0.5) * window.innerHeight];
    };
    // what the action reports back while it plays
    const ui = {
      onLadder: (zone, bet) => hud.ladder.show(zone, bet),
      onTease: (i) => hud.ladder.tease(i),
      onStep: (i, mult, worldPos) => {
        hud.ladder.step(i, mult);
        const [x, y] = toScreen(worldPos);
        hud.tick(x, y, mult);
        hud.setMessage(`撐住了！獎金升到 ×${mult}`, 'good');
      },
      onSlip: () => { hud.ladder.slip(); hud.setMessage('鉗子打滑！重新夾緊…', 'warn'); },
      onLock: (mult) => hud.ladder.lock(mult),
      onReveal: (worldPos) => {
        const [x, y] = toScreen(worldPos);
        outcome.shown = true;
        game.settle(outcome);
        if (outcome.tier === 'big' || outcome.tier === 'mega') {
          // a big win gets the headline instead of the small floating label
          hud.ladder.hide();
          const jackpot = outcome.mult >= 50;
          hud.banner(jackpot ? 'JACKPOT' : outcome.tier === 'mega' ? 'MEGA WIN' : 'BIG WIN', outcome.win, jackpot ? 'jackpot' : outcome.tier, outcome.mult);
        } else {
          hud.pop(x, Math.max(y - 86, 170), outcome); // sit above the target, not on it
        }
        hud.setMessage(
          outcome.mult > 0 ? `${targetLabel(id)} 返還 ×${outcome.mult} — 贏得 ${outcome.win}` : `${targetLabel(id)} 落空`,
          outcome.mult >= 1 ? 'good' : '',
        );
      },
      onDone: () => hud.ladder.hide(),
    };
    try {
      if (t.kind === 'eye') await actions.smashEye(t, outcome, ui);
      else await actions.extractTooth(t, outcome, ui);
    } catch (err) {
      console.error(err);
      if (!outcome.shown) ui.onReveal(head.worldPos(id)); // never leave a stake unsettled
      // and never leave the show running
      time.warp = 1;
      stage.calm();
      award.clear();
    }
    hud.ladder.hide();
    t.alive = false;
    game.setBusy(false);
    if (game.remaining === 0) {
      hud.setMessage('頭顱已全數破壞 — 正在更換新頭顱', 'good');
      await real.wait(1.1);
      await newHead();
    } else {
      hud.setMessage('');
    }
    return 'played';
  }

  async function newHead(intro = false) {
    if (game.state.busy) return;
    sfx.unlock();
    game.setBusy(true);
    hud.setMessage(intro ? '組裝中…' : '更換新頭顱…', 'good');
    await actions.rebuild({ all: intro });
    if (!intro) game.newRound();
    for (const t of head.targets.values()) highlight(t, false);
    game.setBusy(false);
    hud.setMessage('');
  }

  const hud = createHud(document.getElementById('hud'), {
    game, sfx,
    onPlay: (id) => play(id),
    onHover: (id, source) => setHover(id, source),
    onNewHead: () => newHead(false),
    onTurbo: (on) => { time.turbo = on ? 1.7 : 1; },
    onMute: (m) => sfx.setMuted(m),
    onRefill: () => { game.refill(); hud.setMessage('籌碼已補充', 'good'); },
  });
  game.onChange((state) => hud.sync(state));

  // ------------------------------------------------------------ pointer input
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; sfx.unlock(); });
  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY;
    if (e.buttons) { if (hovered) setHover(null); return; }
    setHover(pick(e), 'stage');
  });
  canvas.addEventListener('pointerleave', () => setHover(null));
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return; // that was a camera drag
    const id = pick(e);
    if (id) play(id);
  });

  // ------------------------------------------------------------ frame loop
  const clock = new THREE.Clock();
  let frames = 0;
  // keep the frame rate up on integrated graphics by trading resolution
  const quality = { ratio: Math.min(window.devicePixelRatio, 1.5), acc: 0, n: 0 };
  const applyRatio = () => {
    stage.renderer.setPixelRatio(quality.ratio);
    stage.composer.setPixelRatio(quality.ratio);
    stage.composer.setSize(canvas.clientWidth, canvas.clientHeight);
  };
  if (!TEST) applyRatio();

  function frame() {
    const raw = Math.min(clock.getDelta(), 0.05);
    const realDt = raw * time.turbo;
    const dt = realDt * time.warp;
    real.update(realDt);
    anim.update(dt);
    if (head.idle) head.gaze.copy(stage.camera.position);
    head.update(dt);
    debris.update(dt);
    fx.update(dt);
    award.update(dt);
    actions.update(dt);
    stage.update(raw);
    stage.render();

    if (!TEST) {
      quality.acc += raw; quality.n++;
      if (quality.acc > 1.5) {
        const fps = quality.n / quality.acc;
        const max = Math.min(window.devicePixelRatio, 1.5);
        if (fps < 40 && quality.ratio > 0.6) { quality.ratio = Math.max(0.6, quality.ratio * 0.86); applyRatio(); }
        else if (fps > 57 && quality.ratio < max) { quality.ratio = Math.min(max, quality.ratio * 1.07); applyRatio(); }
        quality.acc = 0; quality.n = 0;
      }
    }
    if (++frames === 3) {
      document.getElementById('loading').classList.add('done');
      window.__ready = true;
      if (!TEST && !params.has('nointro')) newHead(true);
    }
    requestAnimationFrame(frame);
  }
  window.__game = { stage, head, anim, real, time, game, actions, play, newHead, hud, fx, award, debris, THREE, ZONES };
  frame();
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('.loading-text').textContent = String(err.message || err);
  window.__error = String(err.stack || err);
});
