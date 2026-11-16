// Reproducible visual review of the jaw/neck clearance, including combined extremes.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:5173/';
const output = 'dist/qa/jaw';
mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
  defaultViewport: { width: 1440, height: 1000 },
});
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}?nointro=1&still=1&fixed=1`);
  await page.waitForFunction('window.__ready || window.__error');
  await page.addStyleTag({ content: '#hud, #vignette, #loading { display:none!important; }' });
  for (const pose of [
    { name: 'rest', jaw: 0.035, pitch: 0, yaw: 0, roll: 0 },
    { name: 'open-down', jaw: 0.42, pitch: 0.18, yaw: 0.3, roll: 0 },
    { name: 'limit-right', jaw: 0.68, pitch: 0.45, yaw: 0.6, roll: 0.12 },
    { name: 'limit-left', jaw: 0.68, pitch: 0.45, yaw: -0.6, roll: -0.12 },
  ]) {
    await page.evaluate(pose => {
      const g = window.__game;
      for (const key of ['jaw', 'pitch', 'yaw', 'roll']) {
        const spring = g.head.pose[key]; spring.x = spring.target = pose[key]; spring.v = 0;
      }
      g.head.update(0);
      g.stage.controls.minDistance = 1;
      g.stage.camera.position.set(pose.yaw < 0 ? -2.2 : 2.2, -0.55, 2.8);
      g.stage.controls.target.set(0, -0.95, 0.1); g.stage.controls.update();
    }, pose);
    await new Promise(r => setTimeout(r, 250));
    await page.screenshot({ path: `${output}/${pose.name}.png` });
  }
  console.log(JSON.stringify({ screenshots: 4, errors }));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
