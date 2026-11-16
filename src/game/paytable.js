// Payout model. Every target belongs to a zone; each zone has its own
// table of [multiplier, weight]. Tables are tuned so each zone returns
// about 96% of the stake over the long run, with volatility rising from
// the front teeth to the molars to the eyes.

export const ZONES = {
  incisor: {
    name: '門牙', en: 'INCISOR', risk: 1, tool: 'forceps',
    table: [[0.3, 290], [0.6, 275], [1, 205], [1.5, 125], [2, 68], [4, 28], [8, 9]],
  },
  canine: {
    name: '犬齒', en: 'CANINE', risk: 2, tool: 'forceps',
    table: [[0, 345], [0.5, 270], [1, 190], [2, 118], [3, 49], [6, 22], [15, 8]],
  },
  premolar: {
    name: '小臼齒', en: 'PREMOLAR', risk: 3, tool: 'forceps',
    table: [[0, 560], [0.5, 180], [1.5, 128], [3, 76], [5, 36], [10, 15.5], [25, 4.5]],
  },
  molar: {
    name: '大臼齒', en: 'MOLAR', risk: 4, tool: 'forceps',
    table: [[0, 722], [1, 118], [2, 80], [4, 46], [8, 23], [20, 10], [50, 2.4]],
  },
  eye: {
    name: '玻璃眼', en: 'GLASS EYE', risk: 5, tool: 'hammer',
    table: [[0, 820], [1, 74], [2, 48], [5, 31], [10, 15], [25, 7.4], [100, 3]],
  },
};

for (const z of Object.values(ZONES)) {
  const total = z.table.reduce((s, [, w]) => s + w, 0);
  z.total = total;
  z.rtp = z.table.reduce((s, [m, w]) => s + m * w, 0) / total;
  z.max = z.table[z.table.length - 1][0];
  z.hit = z.table.reduce((s, [m, w]) => s + (m > 0 ? w : 0), 0) / total;
  z.odds = z.table.map(([m, w]) => ({ mult: m, p: w / total }));
}

/** Uniform float in [0,1) from the platform CSPRNG. */
function random() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

/** Draw a multiplier for a zone. */
export function draw(zoneKey, rng = random) {
  const z = ZONES[zoneKey];
  let r = rng() * z.total;
  for (const [m, w] of z.table) {
    if ((r -= w) < 0) return m;
  }
  return z.table[z.table.length - 1][0];
}

/** How loudly a result should be celebrated. */
export function tierOf(mult) {
  if (mult <= 0) return 'dud';
  if (mult < 1) return 'small';
  if (mult < 5) return 'win';
  if (mult < 20) return 'big';
  return 'mega';
}

export const BET_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500];
export const START_BALANCE = 10000;
