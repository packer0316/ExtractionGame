// Turns a signed-distance function into an indexed triangle mesh.
// Naive surface nets for topology, then every vertex is pulled onto the true
// surface and given the analytic gradient as its normal, so shading stays
// smooth and detailed even at a moderate grid size.

const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];

export function meshSdf(sdf, { min, max, h, block = 4, projectIters = 4, label = '' }) {
  const t0 = performance.now();
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const sx = nx, sxy = nx * ny;
  const val = new Float32Array(nx * ny * nz);

  // Coarse pass: skip blocks that are certainly far from the surface.
  const bh = h * block;
  const reach = bh * 0.87 * 1.6 + h;
  let evals = 0;
  for (let bk = 0; bk < nz; bk += block) {
    for (let bj = 0; bj < ny; bj += block) {
      for (let bi = 0; bi < nx; bi += block) {
        const cx = min[0] + (bi + block * 0.5) * h;
        const cy = min[1] + (bj + block * 0.5) * h;
        const cz = min[2] + (bk + block * 0.5) * h;
        const dc = sdf(cx, cy, cz);
        const far = Math.abs(dc) > reach;
        const ke = Math.min(bk + block, nz), je = Math.min(bj + block, ny), ie = Math.min(bi + block, nx);
        for (let k = bk; k < ke; k++) {
          for (let j = bj; j < je; j++) {
            let idx = bi + j * sx + k * sxy;
            for (let i = bi; i < ie; i++, idx++) {
              if (far) val[idx] = dc;
              else {
                val[idx] = sdf(min[0] + i * h, min[1] + j * h, min[2] + k * h);
                evals++;
              }
            }
          }
        }
      }
    }
  }

  // One vertex per cell that the surface crosses.
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const corner = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const base = i + j * sx + k * sxy;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = val[base + (c & 1) + ((c >> 1) & 1) * sx + ((c >> 2) & 1) * sxy];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0, py = 0, pz = 0, n = 0;
        for (let e = 0; e < 12; e++) {
          const a = EDGES[e][0], b = EDGES[e][1];
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          px += (a & 1) + t * ((b & 1) - (a & 1));
          py += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          pz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
          n++;
        }
        cellVert[base] = pos.length / 3;
        pos.push(min[0] + (i + px / n) * h, min[1] + (j + py / n) * h, min[2] + (k + pz / n) * h);
      }
    }
  }

  // Pull vertices onto the surface and take normals from the gradient.
  const count = pos.length / 3;
  const P = new Float32Array(pos);
  const N = new Float32Array(count * 3);
  const e = h * 0.2;
  const grad = (x, y, z, out) => {
    out[0] = sdf(x + e, y, z) - sdf(x - e, y, z);
    out[1] = sdf(x, y + e, z) - sdf(x, y - e, z);
    out[2] = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= l; out[1] /= l; out[2] /= l;
  };
  const g = [0, 0, 0];
  for (let v = 0; v < count; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    for (let it = 0; it < projectIters; it++) {
      const d = sdf(x, y, z);
      if (Math.abs(d) < h * 0.002) break;
      grad(x, y, z, g);
      const step = Math.max(-h, Math.min(h, d)) * 0.9;
      x -= g[0] * step; y -= g[1] * step; z -= g[2] * step;
    }
    grad(x, y, z, g);
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    N[v * 3] = g[0]; N[v * 3 + 1] = g[1]; N[v * 3 + 2] = g[2];
  }

  // Quads around every grid edge that crosses the surface.
  const idx = [];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // split along the shorter diagonal
    const dac = dist2(P, a, c), dbd = dist2(P, b, d);
    const tris = dac <= dbd ? [a, b, c, a, c, d] : [a, b, d, b, c, d];
    for (let t = 0; t < 6; t += 3) {
      let i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;
      if (faceDot(P, N, i0, i1, i2) < 0) { const tmp = i1; i1 = i2; i2 = tmp; }
      idx.push(i0, i1, i2);
    }
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const base = i + j * sx + k * sxy;
        const s = val[base] < 0;
        if (s !== val[base + 1] < 0) {
          quad(cellVert[base - sx - sxy], cellVert[base - sxy], cellVert[base], cellVert[base - sx]);
        }
        if (s !== val[base + sx] < 0) {
          quad(cellVert[base - 1 - sxy], cellVert[base - sxy], cellVert[base], cellVert[base - 1]);
        }
        if (s !== val[base + sxy] < 0) {
          quad(cellVert[base - 1 - sx], cellVert[base - sx], cellVert[base], cellVert[base - 1]);
        }
      }
    }
  }

  const ms = (performance.now() - t0).toFixed(0);
  console.log(
    `  ${label.padEnd(12)} grid ${nx}x${ny}x${nz}  evals ${(evals / 1e6).toFixed(2)}M  ` +
      `verts ${count}  tris ${idx.length / 3}  ${ms} ms`,
  );
  return { positions: P, normals: N, indices: new Uint32Array(idx) };
}

function dist2(P, a, b) {
  const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

function faceDot(P, N, a, b, c) {
  const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
  const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
  const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return (
    nx * (N[a * 3] + N[b * 3] + N[c * 3]) +
    ny * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) +
    nz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2])
  );
}

/** Snap a point onto the zero surface of sdf; returns position and normal. */
export function snapToSurface(sdf, p, iters = 24) {
  let [x, y, z] = p;
  const e = 0.002;
  let g = [0, 1, 0];
  for (let it = 0; it < iters; it++) {
    const d = sdf(x, y, z);
    g = [
      sdf(x + e, y, z) - sdf(x - e, y, z),
      sdf(x, y + e, z) - sdf(x, y - e, z),
      sdf(x, y, z + e) - sdf(x, y, z - e),
    ];
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    g = [g[0] / l, g[1] / l, g[2] / l];
    x -= g[0] * d * 0.8; y -= g[1] * d * 0.8; z -= g[2] * d * 0.8;
  }
  return { p: [x, y, z], n: g };
}
