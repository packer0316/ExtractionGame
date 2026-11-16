// Payout model. Every target belongs to a zone; each zone has its own
// table of [multiplier, weight], with volatility rising from the front teeth
// to the molars to the eyes. Two sets of weights are kept side by side:
//
//   balanced  each zone returns about 96% of the stake over the long run
//   showcase  weighted towards the top so the big-win shows come up most
//             plays, with one extra top prize on the front teeth so every
//             zone can reach the biggest show. It pays out many times the
//             stake and is only meant for demonstrating the effects.

/** Which set of weights is live. Set to false to go back to ~96% RTP. */
export const SHOWCASE = true;

const WEIGHTS = {
  incisor: {
    balanced: [[0.3, 290], [0.6, 275], [1, 205], [1.5, 125], [2, 68], [4, 28], [8, 9]],
    showcase: [[0.3, 6], [0.6, 8], [1, 10], [1.5, 12], [2, 14], [4, 18], [8, 20], [20, 12]],
  },
  canine: {
    balanced: [[0, 345], [0.5, 270], [1, 190], [2, 118], [3, 49], [6, 22], [15, 8]],
    showcase: [[0, 8], [0.5, 8], [1, 10], [2, 12], [3, 14], [6, 18], [15, 18], [30, 12]],
  },
  premolar: {
    balanced: [[0, 560], [0.5, 180], [1.5, 128], [3, 76], [5, 36], [10, 15.5], [25, 4.5]],
    showcase: [[0, 8], [0.5, 6], [1.5, 10], [3, 14], [5, 20], [10, 22], [25, 20]],
  },
  molar: {
    balanced: [[0, 722], [1, 118], [2, 80], [4, 46], [8, 23], [20, 10], [50, 2.4]],
    showcase: [[0, 10], [1, 6], [2, 10], [4, 14], [8, 20], [20, 22], [50, 18]],
  },
  eye: {
    balanced: [[0, 820], [1, 74], [2, 48], [5, 31], [10, 15], [25, 7.4], [100, 3]],
    showcase: [[0, 12], [1, 6], [2, 8], [5, 16], [10, 20], [25, 20], [100, 18]],
  },
};
const table = (zone) => WEIGHTS[zone][SHOWCASE ? 'showcase' : 'balanced'];

export const ZONES = {
  incisor: { name: '門牙', en: 'INCISOR', risk: 1, tool: 'forceps', table: table('incisor') },
  canine: { name: '犬齒', en: 'CANINE', risk: 2, tool: 'forceps', table: table('canine') },
  premolar: { name: '小臼齒', en: 'PREMOLAR', risk: 3, tool: 'forceps', table: table('premolar') },
  molar: { name: '大臼齒', en: 'MOLAR', risk: 4, tool: 'forceps', table: table('molar') },
  eye: { name: '玻璃眼', en: 'GLASS EYE', risk: 5, tool: 'hammer', table: table('eye') },
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
