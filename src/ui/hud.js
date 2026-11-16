import { ZONES, BET_STEPS, SHOWCASE } from '../game/paytable.js';
import { TEETH, EYES } from '../model/layout.js';

const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtMult = (m) => `×${m}`;
const ZONE_ORDER = ['eye', 'molar', 'premolar', 'canine', 'incisor'];
const SVG = 'http://www.w3.org/2000/svg';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const s = (tag, attrs) => {
  const el = document.createElementNS(SVG, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
};

/** Human label for a target, e.g. "上排 左3 犬齒". */
export function targetLabel(id) {
  if (id === 'eyeL') return '左眼 玻璃眼';
  if (id === 'eyeR') return '右眼 玻璃眼';
  const t = TEETH.find((x) => x.id === id);
  return `${t.arch === 'U' ? '上排' : '下排'} ${t.side < 0 ? '左' : '右'}${t.n} ${ZONES[t.zone].name}`;
}

export function createHud(root, { game, onPlay, onHover, onNewHead, onTurbo, onMute, onRefill, sfx }) {
  root.innerHTML = '';

  // ------------------------------------------------------------ top bar
  const top = h('div', 'hud-top');
  top.append(
    h('div', 'brand', '<span class="logo">EXTRACTION</span><span class="tag">玻璃顱骨 · 破壞下注</span>'),
    h('div', 'wallet', '<label>CREDITS</label><b id="hud-balance">0</b>'),
  );

  // ------------------------------------------------------------ paytable
  const pay = h('aside', 'panel paytable');
  pay.append(h('h3', '', '各部位返還 <small>PAYTABLE</small>'));
  const rows = {};
  for (const key of ZONE_ORDER) {
    const z = ZONES[key];
    const row = h('div', `zone z-${key}`);
    row.dataset.zone = key;
    const pips = Array.from({ length: 5 }, (_, i) => `<i class="${i < z.risk ? 'on' : ''}"></i>`).join('');
    row.innerHTML = `
      <div class="zone-head">
        <span class="zone-name">${z.name}</span>
        <span class="zone-tool">${z.tool === 'hammer' ? '鐵鎚敲碎' : '鉗子拔除'}</span>
        <span class="zone-left" data-left></span>
      </div>
      <div class="zone-mults">${z.odds.map((o, i) => `<span class="${o.mult === 0 ? 'zero' : i === z.odds.length - 1 ? 'top' : ''}" title="機率 ${(o.p * 100).toFixed(1)}%">${fmtMult(o.mult)}</span>`).join('')}</div>
      <div class="zone-foot"><span class="pips">${pips}</span><span>中獎率 ${(z.hit * 100).toFixed(0)}%</span><span>最高 <b>${fmtMult(z.max)}</b></span></div>`;
    pay.append(row);
    rows[key] = row;
  }
  pay.append(h('div', 'panel-note', SHOWCASE
    ? '特效展示模式 · 高倍率加權，不計返還率'
    : `理論返還率 RTP ≈ ${(ZONE_ORDER.reduce((a, k) => a + ZONES[k].rtp, 0) / ZONE_ORDER.length * 100).toFixed(1)}%`));

  // ------------------------------------------------------------ chart
  const chart = h('aside', 'panel chart');
  chart.append(h('h3', '', '下注盤 <small>TARGETS</small>'));
  const svg = s('svg', { viewBox: '0 0 200 334', class: 'chart-svg' });
  const marks = {};
  const S = 196, CX = 100;
  const addMark = (id, zone, x, y, r) => {
    const g = s('g', { class: `mark zone-${zone}`, 'data-id': id });
    g.append(s('circle', { cx: x, cy: y, r, class: 'mark-body' }));
    const txt = s('text', { x, y: y + 2.6, class: 'mark-text' });
    g.append(txt);
    g.addEventListener('pointerenter', () => onHover(id, 'chart'));
    g.addEventListener('pointerleave', () => onHover(null, 'chart'));
    g.addEventListener('click', () => onPlay(id));
    svg.append(g);
    marks[id] = { g, txt };
  };
  svg.append(s('path', { d: 'M40 30 Q100 6 160 30', class: 'chart-brow' }));
  for (const e of EYES) {
    const x = CX + e.side * 36, y = 44;
    svg.append(s('circle', { cx: x, cy: y, r: 25, class: 'chart-orbit' }));
    addMark(e.id, 'eye', x, y, 19);
  }
  svg.append(s('path', { d: 'M100 62 l-9 16 h18 z', class: 'chart-nose' }));
  for (const t of TEETH) {
    const x = CX + t.pos[0] * S;
    const y = t.arch === 'U' ? 198 - (t.pos[2] - 0.2) * S : 216 + (t.pos[2] - 0.2) * S;
    addMark(t.id, t.zone, x, y, Math.max(t.width * S * 0.44, 6.4));
  }
  svg.append(s('text', { x: 100, y: 150, class: 'chart-label' }));
  svg.lastChild.textContent = '上排 UPPER';
  svg.append(s('text', { x: 100, y: 270, class: 'chart-label' }));
  svg.lastChild.textContent = '下排 LOWER';
  chart.append(svg);
  const stats = h('div', 'chart-stats', '<div><label>本局下注</label><b id="hud-wagered">0</b></div><div><label>本局贏得</label><b id="hud-won">0</b></div><div><label>剩餘目標</label><b id="hud-left">30</b></div>');
  chart.append(stats);

  // ------------------------------------------------------------ bottom bar
  const bottom = h('div', 'hud-bottom');
  const msg = h('div', 'msg');
  const bar = h('div', 'bar');
  const betBox = h('div', 'bet');
  betBox.innerHTML = `<label>BET</label><button class="round" data-bet="-1" aria-label="降低下注">−</button><b id="hud-bet">10</b><button class="round" data-bet="1" aria-label="提高下注">+</button>`;
  const chips = h('div', 'chips');
  BET_STEPS.forEach((v, i) => {
    const c = h('button', 'chip', String(v));
    c.dataset.i = i;
    chips.append(c);
  });
  const winBox = h('div', 'win', '<label>WIN</label><b id="hud-win">0</b>');
  const btns = h('div', 'btns');
  const bNew = h('button', 'btn primary', '新頭顱');
  const bTurbo = h('button', 'btn toggle', '加速');
  const bMute = h('button', 'btn toggle on', '音效');
  const bRefill = h('button', 'btn warn', '補充籌碼');
  bRefill.hidden = true;
  btns.append(bRefill, bNew, bTurbo, bMute);
  bar.append(betBox, chips, winBox, btns);
  bottom.append(msg, bar);

  const tip = h('div', 'tip');
  const pops = h('div', 'pops');
  const banner = h('div', 'banner');
  // the prize ladder shown while a tooth is being pulled
  const ladder = h('div', 'ladder');
  ladder.innerHTML = '<div class="ladder-head"><span class="ladder-zone"></span><span class="ladder-hint">越難拔，獎越大</span></div><div class="ladder-cells"></div><div class="ladder-now"><span class="ladder-mult">×0</span><b class="ladder-win">+0</b></div>';
  const ladderCells = ladder.querySelector('.ladder-cells');
  const ladderMult = ladder.querySelector('.ladder-mult');
  const ladderWin = ladder.querySelector('.ladder-win');
  root.append(top, pay, chart, bottom, tip, pops, ladder, banner);

  // ------------------------------------------------------------ wiring
  const stop = (el) => ['pointerdown', 'pointerup', 'click', 'wheel'].forEach((ev) => el.addEventListener(ev, (e) => e.stopPropagation()));
  [top, pay, chart, bottom].forEach(stop);
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.bet) { if (game.changeBet(Number(b.dataset.bet))) sfx.bet(); else sfx.deny(); }
    if (b.dataset.i) { const d = Number(b.dataset.i) - game.state.betIndex; if (d && game.changeBet(d)) sfx.bet(); }
  });
  bNew.addEventListener('click', () => onNewHead());
  bTurbo.addEventListener('click', () => { const on = bTurbo.classList.toggle('on'); sfx.ui(); onTurbo(on); });
  bMute.addEventListener('click', () => { const on = bMute.classList.toggle('on'); onMute(!on); sfx.ui(); });
  bRefill.addEventListener('click', () => { sfx.bet(); onRefill(); });

  const $ = (id) => root.querySelector(`#${id}`);
  const balanceEl = $('hud-balance'), betEl = $('hud-bet'), winEl = $('hud-win');
  let shownBalance = null, balanceAnim = 0;
  const setBalance = (target) => {
    if (shownBalance === null) { shownBalance = target; balanceEl.textContent = fmt(target); return; }
    cancelAnimationFrame(balanceAnim);
    const from = shownBalance, t0 = performance.now(), dur = Math.abs(target - from) > 0 ? 420 : 0;
    const step = (now) => {
      const k = dur ? Math.min((now - t0) / dur, 1) : 1;
      shownBalance = from + (target - from) * (1 - Math.pow(1 - k, 3));
      balanceEl.textContent = fmt(Math.round(shownBalance * 100) / 100);
      if (k < 1) balanceAnim = requestAnimationFrame(step); else shownBalance = target;
    };
    balanceAnim = requestAnimationFrame(step);
    balanceEl.classList.remove('bump-up', 'bump-down');
    void balanceEl.offsetWidth;
    if (target !== from) balanceEl.classList.add(target > from ? 'bump-up' : 'bump-down');
  };

  let idleMsg = '點擊牙齒用鉗子拔除，點擊眼睛用鐵鎚敲碎 — 每次出手下注一次';
  const hud = {
    setMessage(text, tone = '') { msg.textContent = text || idleMsg; msg.className = `msg ${tone}`; },

    /** Re-read the game state into the panels. */
    sync(state) {
      setBalance(state.balance);
      betEl.textContent = fmt(game.bet);
      winEl.textContent = fmt(state.lastWin);
      winEl.classList.toggle('hot', state.lastWin > 0);
      chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', Number(c.dataset.i) === state.betIndex));
      $('hud-wagered').textContent = fmt(state.wagered);
      $('hud-won').textContent = fmt(state.won);
      $('hud-left').textContent = String(game.remaining);
      root.classList.toggle('busy', state.busy);
      bNew.disabled = state.busy || state.results.size === 0;
      bRefill.hidden = state.balance >= BET_STEPS[0] * 10 || state.busy;
      const left = {};
      for (const id in marks) {
        const m = marks[id];
        const zone = id.startsWith('eye') ? 'eye' : TEETH.find((t) => t.id === id).zone;
        const r = state.results.get(id);
        m.g.classList.toggle('gone', !!r);
        m.g.classList.remove('tier-dud', 'tier-small', 'tier-win', 'tier-big', 'tier-mega');
        if (r && r.shown) { m.g.classList.add(`tier-${r.tier}`); m.txt.textContent = r.mult === 0 ? '✕' : `×${r.mult}`; }
        else m.txt.textContent = '';
        if (!r) left[zone] = (left[zone] || 0) + 1;
      }
      for (const key of ZONE_ORDER) {
        const total = key === 'eye' ? 2 : TEETH.filter((t) => t.zone === key).length;
        rows[key].querySelector('[data-left]').textContent = `${left[key] || 0}/${total}`;
        rows[key].classList.toggle('empty', !left[key]);
      }
    },

    /** Highlight a target in the panels and show the hover card. */
    hover(id, x, y, reason) {
      for (const k in marks) marks[k].g.classList.toggle('hover', k === id);
      const zone = id ? (id.startsWith('eye') ? 'eye' : TEETH.find((t) => t.id === id).zone) : null;
      for (const k in rows) rows[k].classList.toggle('hover', k === zone);
      if (!id || x === undefined) { tip.classList.remove('show'); return; }
      const z = ZONES[zone];
      const note = reason === 'gone' ? '<em>已破壞</em>' : reason === 'funds' ? '<em class="bad">籌碼不足</em>' : `點擊下注 <b>${fmt(game.bet)}</b>`;
      tip.innerHTML = `<div class="tip-name">${targetLabel(id)}</div><div class="tip-row"><span>最高返還</span><b>${fmtMult(z.max)} = ${fmt(game.bet * z.max)}</b></div><div class="tip-row"><span>中獎率</span><b>${(z.hit * 100).toFixed(0)}%</b></div><div class="tip-act">${note}</div>`;
      const w = 190, pad = 14;
      tip.style.left = `${Math.min(Math.max(x + 18, pad), window.innerWidth - w - pad)}px`;
      tip.style.top = `${Math.min(Math.max(y - 30, pad), window.innerHeight - 130)}px`;
      tip.classList.add('show');
    },

    /** Floating result at a screen position. */
    pop(x, y, outcome) {
      const el = h('div', `pop tier-${outcome.tier}`);
      el.innerHTML = outcome.mult === 0
        ? '<span class="pop-mult">×0</span><span class="pop-win">落空</span>'
        : `<span class="pop-mult">${fmtMult(outcome.mult)}</span><span class="pop-win">+${fmt(outcome.win)}</span>`;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      pops.append(el);
      setTimeout(() => el.remove(), 2600);
    },

    /** A small marker that floats up from the tooth each time the prize climbs. */
    tick(x, y, mult) {
      const el = h('div', 'tick', fmtMult(mult));
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      pops.append(el);
      setTimeout(() => el.remove(), 950);
    },

    /** Big headline with the amount counting up. cls: 'big' | 'mega' | 'jackpot' */
    banner(label, amount, cls, mult) {
      clearTimeout(bannerTimer);
      cancelAnimationFrame(bannerAnim);
      banner.innerHTML = `<span>${label}</span><i>${fmtMult(mult)}</i><b>+0</b>`;
      banner.className = `banner show ${cls}`;
      const b = banner.querySelector('b');
      const dur = cls === 'big' ? 1100 : cls === 'mega' ? 1900 : 2600;
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min((now - t0) / dur, 1);
        b.textContent = `+${fmt(Math.round(amount * (1 - Math.pow(1 - k, 2.2)) * 100) / 100)}`;
        if (k < 1) bannerAnim = requestAnimationFrame(tick); else { b.textContent = `+${fmt(amount)}`; b.classList.add('done'); }
      };
      bannerAnim = requestAnimationFrame(tick);
      bannerTimer = setTimeout(() => { banner.className = 'banner'; }, dur + 1500);
    },

    /** Prize ladder for the tooth being pulled. */
    ladder: {
      /** Lay out every prize this zone can pay, all unlit. */
      show(zoneKey, bet) {
        const z = ZONES[zoneKey];
        ladderState.bet = bet; ladderState.win = 0;
        ladderState.mults = z.odds.filter((o) => o.mult > 0).map((o) => o.mult);
        ladder.querySelector('.ladder-zone').textContent = z.name;
        ladderCells.innerHTML = ladderState.mults.map((m) => `<span class="cell">${fmtMult(m)}</span>`).join('');
        ladderMult.textContent = '×0';
        ladderWin.textContent = '+0';
        ladder.className = 'ladder show';
        ladder.dataset.heat = '0';
      },
      /** The next prize up starts to pulse: will the tooth hold once more? */
      tease(i) {
        [...ladderCells.children].forEach((c, k) => c.classList.toggle('tease', k === i));
      },
      /** The tooth held: prize `i` is now lit and the running win jumps. */
      step(i, mult) {
        const cells = [...ladderCells.children];
        // forced test values may not be on the zone's ladder
        if (cells[i] && cells[i].textContent !== fmtMult(mult)) cells[i].textContent = fmtMult(mult);
        cells.forEach((c, k) => {
          c.classList.remove('tease');
          c.classList.toggle('on', k <= i);
          c.classList.toggle('now', k === i);
        });
        ladder.dataset.heat = String(Math.min(4, Math.floor((i / Math.max(1, cells.length - 1)) * 4.99)));
        ladderMult.textContent = fmtMult(mult);
        ladder.classList.remove('punch', 'slip');
        void ladder.offsetWidth;
        ladder.classList.add('punch');
        const from = ladderState.win, to = Math.round(ladderState.bet * mult * 100) / 100, t0 = performance.now();
        ladderState.win = to;
        cancelAnimationFrame(ladderAnim);
        const tick = (now) => {
          const k = Math.min((now - t0) / 320, 1);
          ladderWin.textContent = `+${fmt(Math.round((from + (to - from) * (1 - Math.pow(1 - k, 3))) * 100) / 100)}`;
          if (k < 1) ladderAnim = requestAnimationFrame(tick);
        };
        ladderAnim = requestAnimationFrame(tick);
      },
      /** The forceps slipped: the whole ladder rattles. */
      slip() {
        ladder.classList.remove('slip');
        void ladder.offsetWidth;
        ladder.classList.add('slip');
      },
      /** The tooth is out: whatever is lit is the prize. */
      lock(mult) {
        [...ladderCells.children].forEach((c) => c.classList.remove('tease'));
        ladder.classList.add(mult > 0 ? 'locked' : 'dud');
        if (!(mult > 0)) { ladderMult.textContent = '×0'; ladderWin.textContent = '落空'; }
      },
      hide() { ladder.classList.remove('show'); },
    },
  };
  let bannerTimer = 0, bannerAnim = 0, ladderAnim = 0;
  const ladderState = { bet: 0, win: 0, mults: [] };
  hud.setMessage('');
  return hud;
}
