// End-to-end smoke test: plays every target on the head once (fast-forwarded)
// and checks the money adds up and nothing throws.
//   npm run dev   (in another terminal)
//   node tools/smoke.mjs
import puppeteer from 'puppeteer-core';

const base = process.argv[2] || 'http://127.0.0.1:5173/';
const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: chrome, headless: true, protocolTimeout: 600000,
  args: ['--window-size=1280,720', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
await page.goto(`${base}?nointro=1&fixed=1`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready || window.__error', { timeout: 30000 });

// ---- real pointer input: hover shows the card, a click starts the play
const spot = await page.evaluate(() => {
  const g = window.__game;
  g.head.idle = false;
  const p = g.head.targets.get('UL1').hit.getWorldPosition(new g.THREE.Vector3()).project(g.stage.camera);
  return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
});
await page.mouse.move(spot.x, spot.y);
await new Promise((r) => setTimeout(r, 300));
const tipText = await page.evaluate(() => document.querySelector('.tip.show')?.textContent || '');
await page.mouse.click(spot.x, spot.y);
await new Promise((r) => setTimeout(r, 200));
const input = await page.evaluate(() => ({ busy: window.__game.game.state.busy, placed: window.__game.game.state.results.has('UL1') }));
console.log('pointer:', JSON.stringify({ spot, tipText, ...input }));
if (!tipText.includes('門牙') || !input.placed) { console.log('SMOKE TEST FAILED (pointer input)'); await browser.close(); process.exit(1); }
await page.evaluate(() => new Promise((res) => { const t = setInterval(() => { if (!window.__game.game.state.busy) { clearInterval(t); res(); } }, 100); }));
await page.evaluate(() => window.__game.newHead());

const report = await page.evaluate(async () => {
  const g = window.__game;
  localStorage.clear();
  g.game.refill();
  g.time.turbo = 5;
  const start = g.game.state.balance;
  const mults = [0, 0.5, 1, 2, 5, 25, 100];
  const ids = [...g.head.targets.keys()];
  // shuffle so teeth and eyes interleave
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  let expected = start, played = 0;
  const log = [];
  const t0 = performance.now();
  for (const id of ids.slice(0, ids.length - 1)) {
    const m = mults[played % mults.length];
    const bet = g.game.bet;
    const r = await g.play(id, m);
    if (r !== 'played') { log.push(`${id}: ${r}`); continue; }
    expected += bet * m - bet;
    played++;
    if (Math.abs(g.game.state.balance - expected) > 0.001) log.push(`${id}: balance ${g.game.state.balance} != ${expected}`);
    if (g.head.targets.get(id).alive) log.push(`${id}: still alive`);
  }
  const before = { remaining: g.game.remaining, round: g.game.state.round };
  // the last target triggers the automatic rebuild
  const last = ids[ids.length - 1];
  await g.play(last, 1);
  played++;
  const alive = [...g.head.targets.values()].filter((t) => t.alive).length;
  return {
    played, seconds: ((performance.now() - t0) / 1000).toFixed(1), log, before,
    after: { remaining: g.game.remaining, round: g.game.state.round, alive, busy: g.game.state.busy },
    balanceOk: Math.abs(g.game.state.balance - expected) < 0.001,
    debrisLeft: g.debris.bodies.length,
  };
});
console.log(JSON.stringify(report, null, 2));
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
const ok = !errors.length && !report.log.length && report.balanceOk && report.after.alive === 30 && report.after.remaining === 30 && !report.after.busy;
console.log(ok ? 'SMOKE TEST PASSED' : 'SMOKE TEST FAILED');
process.exit(ok ? 0 : 1);
