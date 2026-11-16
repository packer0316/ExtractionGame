// Renders the store cover (public/cover.jpg, 1600x1000 = 16:10) from the game itself.
//   npm run dev            (or vite preview of a build)
//   node tools/cover.mjs [base-url]
import puppeteer from 'puppeteer-core';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] || 'http://127.0.0.1:5173/';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'cover.jpg');
const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: chrome, headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--hide-scrollbars'],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
// the head sits right of centre, leaving the left side for the title
await page.goto(`${base}?nointro=1&still=1&cam=0.2,0.05,7.4,-1.15,-0.5,0`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready || window.__error', { timeout: 30000 });

await page.evaluate(() => {
  const g = window.__game;
  document.getElementById('hud').style.display = 'none';
  // soft gold rays behind the skull
  g.award.burstOn(g.head.skull, { size: 7.5, power: 0.42, back: 1.4 });
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="c-tag">玻璃顱骨 · 破壞下注</div>
    <div class="c-title">拔爽了沒?</div>
    <div class="c-line">拔牙・敲眼・越難拔獎越大</div>
    <div class="c-chips"><span>×20</span><span>×50</span><span class="top">×100</span></div>`;
  el.style.cssText = 'position:fixed;left:96px;top:50%;transform:translateY(-52%);z-index:99;font-family:"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif;';
  const css = document.createElement('style');
  css.textContent = `
    .c-tag { font-size: 30px; letter-spacing: 0.32em; color: #9fb3c4; margin-bottom: 18px; }
    .c-title {
      font-size: 156px; font-weight: 900; line-height: 1.05; letter-spacing: 0.02em; white-space: nowrap;
      background: linear-gradient(180deg, #fff6d6 0%, #ffd56e 45%, #c98a22 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent;
      filter: drop-shadow(0 6px 0 rgba(60, 30, 0, 0.55)) drop-shadow(0 0 36px rgba(255, 190, 70, 0.55));
    }
    .c-line { font-size: 38px; font-weight: 700; color: #e9edf2; margin-top: 22px; letter-spacing: 0.06em; text-shadow: 0 3px 14px rgba(0,0,0,0.8); }
    .c-chips { display: flex; gap: 16px; margin-top: 34px; }
    .c-chips span {
      font-size: 40px; font-weight: 800; padding: 8px 22px; border-radius: 14px; color: #1a1104;
      background: linear-gradient(180deg, #ffe7a8, #d39a35); box-shadow: 0 8px 24px rgba(227, 180, 92, 0.35);
    }
    .c-chips span.top { background: linear-gradient(90deg, #ffe7a8, #ff9fe0, #9fe6ff); }`;
  document.head.append(css);
  document.body.append(el);
});
await new Promise((r) => setTimeout(r, 1800)); // let the rays fade in
await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
await browser.close();
console.log('saved', out, `${(statSync(out).size / 1024).toFixed(0)} KB`);
