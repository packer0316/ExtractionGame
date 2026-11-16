import * as THREE from 'three';

// A domed glass lens that can crack and break apart.
// The dome is pre-fractured into a spider-web of shards around an impact
// point (radial spokes + concentric rings, like real impact fractures).
// While intact a single smooth mesh is shown; cracks are thin bright ribbons
// lying on the surface that are revealed outwards from the impact.

function crackMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uReveal: { value: 0 } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aOrder;
      varying float vOrder;
      void main() {
        vOrder = aOrder;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uReveal;
      varying float vOrder;
      void main() {
        if (vOrder > uReveal) discard;
        float tip = smoothstep(uReveal, uReveal - 0.12, vOrder);
        gl_FragColor = vec4(vec3(0.82, 0.95, 1.05) * mix(2.2, 1.0, tip), 1.0);
      }`,
  });
}

export class LensDome {
  /**
   * @param a rim radius  @param h bulge height  @param thickness glass thickness
   * The dome sits on the XY plane and bulges towards +Z.
   */
  constructor({ a = 0.132, h = 0.05, thickness = 0.011, material }) {
    this.a = a; this.h = h; this.t = thickness; this.material = material;
    this.R = (a * a + h * h) / (2 * h);
    this.zc = h - this.R;
    this.group = new THREE.Group();
    this.intact = new THREE.Mesh(this._capGeometry(), material);
    this.intact.renderOrder = 4;
    this.group.add(this.intact);
    this.crackMat = crackMaterial();
    this.shards = [];
    this.cracks = null;
    this.state = 'intact';
    this.generate();
  }

  /** Point on the outer surface above disc position (x, y), pushed in by `inset`. */
  surf(x, y, out, inset = 0) {
    const z = Math.sqrt(Math.max(this.R * this.R - x * x - y * y, 0));
    const k = (this.R - inset) / this.R;
    return out.set(x * k, y * k, z * k + this.zc);
  }

  _capGeometry() {
    const rings = 24, segs = 128;
    const pos = [], nrm = [], idx = [];
    const p = new THREE.Vector3();
    const layer = (inset, sign) => {
      const base = pos.length / 3;
      for (let i = 0; i <= rings; i++) {
        const r = (i / rings) * this.a;
        for (let s = 0; s <= segs; s++) {
          const ang = (s / segs) * Math.PI * 2;
          const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
          this.surf(x, y, p, inset);
          pos.push(p.x, p.y, p.z);
          const z = Math.sqrt(this.R * this.R - x * x - y * y);
          nrm.push((sign * x) / this.R, (sign * y) / this.R, (sign * z) / this.R);
        }
      }
      for (let i = 0; i < rings; i++) {
        for (let s = 0; s < segs; s++) {
          const A = base + i * (segs + 1) + s, B = A + 1, C = A + segs + 1, D = C + 1;
          if (sign > 0) idx.push(A, C, B, B, C, D); else idx.push(A, B, C, B, D, C);
        }
      }
      return base;
    };
    const o = layer(0, 1);
    const n = layer(this.t, -1);
    // rim wall
    const last = rings * (segs + 1);
    for (let s = 0; s < segs; s++) {
      const A = o + last + s, B = A + 1, C = n + last + s, D = C + 1;
      idx.push(A, C, B, B, C, D);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    return g;
  }

  /** (Re)build the fracture pattern around a fresh impact point. */
  generate() {
    this._disposeFracture();
    const { a } = this;
    const NR = 11 + Math.floor(Math.random() * 3);
    const fr = [0, 0.15, 0.36, 0.6, 0.82, 1.0];
    const NJ = fr.length - 1;
    const ia = Math.random() * Math.PI * 2, ir = Math.random() * a * 0.22;
    const cx = Math.cos(ia) * ir, cy = Math.sin(ia) * ir;
    this.impact = new THREE.Vector3();
    this.surf(cx, cy, this.impact);
    this.NJ = NJ;

    // lattice vertices: V[i][j] = [x, y] on the disc
    const V = [];
    let ang = Math.random() * Math.PI * 2;
    const angles = [];
    for (let i = 0; i < NR; i++) {
      angles.push(ang);
      ang += ((Math.PI * 2) / NR) * (0.72 + Math.random() * 0.56);
    }
    const span = ang - angles[0];
    for (let i = 0; i < NR; i++) angles[i] = angles[0] + ((angles[i] - angles[0]) / span) * Math.PI * 2;
    for (let i = 0; i < NR; i++) {
      const dx = Math.cos(angles[i]), dy = Math.sin(angles[i]);
      const b = cx * dx + cy * dy;
      const reach = -b + Math.sqrt(b * b - (cx * cx + cy * cy) + a * a);
      const row = [[cx, cy]];
      for (let j = 1; j <= NJ; j++) {
        let f = fr[j];
        let wob = 0;
        if (j < NJ) { f *= 0.86 + Math.random() * 0.28; wob = (Math.random() - 0.5) * 0.045 * f; }
        const r = reach * Math.min(f, 0.94 + (j === NJ ? 0.06 : 0));
        row.push([cx + dx * r - dy * wob, cy + dy * r + dx * wob]);
      }
      V.push(row);
    }

    // shards
    const S = 3;
    const grid = [];
    for (let i = 0; i < NR; i++) {
      const i1 = (i + 1) % NR;
      for (let j = 1; j <= NJ; j++) {
        const P00 = V[i][j - 1], P10 = V[i1][j - 1], P11 = V[i1][j], P01 = V[i][j];
        grid.length = 0;
        for (let v = 0; v <= S; v++) {
          for (let u = 0; u <= S; u++) {
            const fu = u / S, fv = v / S;
            let x = (P00[0] * (1 - fu) + P10[0] * fu) * (1 - fv) + (P01[0] * (1 - fu) + P11[0] * fu) * fv;
            let y = (P00[1] * (1 - fu) + P10[1] * fu) * (1 - fv) + (P01[1] * (1 - fu) + P11[1] * fu) * fv;
            if (j === NJ && v === S) { const l = Math.hypot(x, y); x *= a / l; y *= a / l; }
            grid.push([x, y]);
          }
        }
        this.shards.push(this._buildShard(grid, S, i, j));
      }
    }
    this.shardIndex = (i, j) => (((i % NR) + NR) % NR) * NJ + (j - 1);

    // crack ribbons
    const pos = [], order = [];
    this.ribbons = [];
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
    const ribbon = (p0, p1, w0, w1, o0, o1, owners) => {
      const start = pos.length / 3;
      const K = 4;
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l;
      for (let k = 0; k < K; k++) {
        const s0 = k / K, s1 = (k + 1) / K;
        const wa = w0 + (w1 - w0) * s0, wb = w0 + (w1 - w0) * s1;
        const ax = p0[0] + dx * s0, ay = p0[1] + dy * s0, bx = p0[0] + dx * s1, by = p0[1] + dy * s1;
        this.surf(ax + nx * wa, ay + ny * wa, A, -0.0012);
        this.surf(ax - nx * wa, ay - ny * wa, B, -0.0012);
        this.surf(bx + nx * wb, by + ny * wb, C, -0.0012);
        this.surf(bx - nx * wb, by - ny * wb, D, -0.0012);
        pos.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z, B.x, B.y, B.z, D.x, D.y, D.z, C.x, C.y, C.z);
        const oa = o0 + (o1 - o0) * s0, ob = o0 + (o1 - o0) * s1;
        order.push(oa, oa, ob, oa, ob, ob);
      }
      this.ribbons.push({ start, count: pos.length / 3 - start, owners, order: order.slice(start) });
    };
    for (let i = 0; i < NR; i++) {
      const i1 = (i + 1) % NR;
      for (let j = 1; j <= NJ; j++) {
        const o0 = ((j - 1) / NJ) * 0.92, o1 = (j / NJ) * 0.92;
        const w = 0.0021 - 0.0011 * (j / NJ);
        ribbon(V[i][j - 1], V[i][j], w + 0.0004, w, o0, o1, [this.shardIndex(i - 1, j), this.shardIndex(i, j)]);
        if (j < NJ) {
          const jit = o1 + Math.random() * 0.1;
          ribbon(V[i][j], V[i1][j], 0.0012, 0.0012, jit, jit + 0.04, [this.shardIndex(i, j), this.shardIndex(i, j + 1)]);
        }
      }
      // a few hairline branches for richness
      for (let n = 0; n < 2; n++) {
        const j = 2 + Math.floor(Math.random() * (NJ - 1));
        const p0 = V[i][j - 1], p1 = V[i][j], q = V[i1][j];
        const s = 0.25 + Math.random() * 0.5;
        const from = [p0[0] + (p1[0] - p0[0]) * s, p0[1] + (p1[1] - p0[1]) * s];
        const k = 0.25 + Math.random() * 0.4;
        const to = [from[0] + (q[0] - from[0]) * k, from[1] + (q[1] - from[1]) * k];
        const o = ((j - 0.5) / NJ) * 0.92 + 0.06;
        ribbon(from, to, 0.001, 0.0002, o, o + 0.05, [this.shardIndex(i, j)]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aOrder', new THREE.Float32BufferAttribute(order, 1));
    this.cracks = new THREE.Mesh(g, this.crackMat);
    this.cracks.renderOrder = 6;
    this.cracks.frustumCulled = false;
    this.crackMat.uniforms.uReveal.value = 0;
    this.group.add(this.cracks);
    this.intact.visible = true;
    this.state = 'intact';
  }

  _buildShard(grid, S, sector, ring) {
    const outer = [], inner = [];
    const c = new THREE.Vector3();
    for (const [x, y] of grid) {
      outer.push(this.surf(x, y, new THREE.Vector3(), 0));
      inner.push(this.surf(x, y, new THREE.Vector3(), this.t));
    }
    for (const p of outer) c.add(p);
    for (const p of inner) c.add(p);
    c.multiplyScalar(1 / (outer.length * 2));
    const pos = [], nrm = [];
    const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const tri = (p0, p1, p2, want) => {
      // skip the degenerate triangles of the wedge-shaped centre shards
      e1.subVectors(p1, p0); e2.subVectors(p2, p0);
      n.crossVectors(e1, e2);
      if (n.lengthSq() < 1e-14) return;
      n.normalize();
      let a = p1, b = p2;
      if (n.dot(want) < 0) { a = p2; b = p1; n.negate(); }
      for (const p of [p0, a, b]) pos.push(p.x - c.x, p.y - c.y, p.z - c.z);
      return n;
    };
    const sphereN = (p, sign, out) => out.set(p.x, p.y, p.z - this.zc).normalize().multiplyScalar(sign);
    const sn = new THREE.Vector3();
    const smoothTri = (arr, i0, i1, i2, sign) => {
      const want = sphereN(arr[i0], sign, new THREE.Vector3());
      const before = pos.length;
      if (!tri(arr[i0], arr[i1], arr[i2], want)) return;
      // overwrite face normal with smooth sphere normals
      for (let k = before; k < pos.length; k += 3) {
        sn.set(pos[k] + c.x, pos[k + 1] + c.y, pos[k + 2] + c.z - this.zc).normalize().multiplyScalar(sign);
        nrm.push(sn.x, sn.y, sn.z);
      }
    };
    const W = S + 1;
    for (let v = 0; v < S; v++) {
      for (let u = 0; u < S; u++) {
        const i0 = v * W + u, i1 = i0 + 1, i2 = i0 + W, i3 = i2 + 1;
        smoothTri(outer, i0, i1, i3, 1); smoothTri(outer, i0, i3, i2, 1);
        smoothTri(inner, i0, i1, i3, -1); smoothTri(inner, i0, i3, i2, -1);
      }
    }
    // side walls (flat shaded so the broken edges catch the light)
    const wall = (ia, ib) => {
      const mid = new THREE.Vector3().addVectors(outer[ia], outer[ib]).multiplyScalar(0.5).sub(c);
      for (const [p0, p1, p2] of [[outer[ia], outer[ib], inner[ib]], [outer[ia], inner[ib], inner[ia]]]) {
        const fn = tri(p0, p1, p2, mid);
        if (fn) for (let k = 0; k < 3; k++) nrm.push(fn.x, fn.y, fn.z);
      }
    };
    for (let k = 0; k < S; k++) {
      wall(k, k + 1); // v = 0 edge
      wall(S * W + k, S * W + k + 1); // v = S edge
      wall(k * W, (k + 1) * W); // u = 0 edge
      wall(k * W + S, (k + 1) * W + S); // u = S edge
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.copy(c);
    mesh.visible = false;
    mesh.renderOrder = 4;
    this.group.add(mesh);
    const normal = new THREE.Vector3(c.x, c.y, c.z - this.zc).normalize();
    return { mesh, ring, sector, normal, attached: true, size: g.boundingSphere.radius };
  }

  /** 0..1: how far the cracks have spread from the impact point. */
  crack(level) {
    this.crackMat.uniforms.uReveal.value = level;
    if (this.state === 'intact' && level > 0) this.state = 'cracked';
  }

  _swapToShards() {
    if (!this.intact.visible) return;
    this.intact.visible = false;
    for (const s of this.shards) s.mesh.visible = true;
  }

  _eject(pick) {
    const out = [];
    for (const s of this.shards) {
      if (!s.attached || !pick(s)) continue;
      s.attached = false;
      out.push(s);
    }
    this._refreshCracks();
    return out;
  }

  /** Punch out the centre: returns the shards that came loose. */
  open() {
    this._swapToShards();
    this.crack(1);
    this.state = 'holed';
    return this._eject((s) => s.ring === 1 || (s.ring === 2 && Math.random() < 0.55));
  }

  /** Blow out everything but a jagged fringe left in the bezel. */
  burst() {
    this._swapToShards();
    this.crack(1);
    this.state = 'broken';
    const NJ = this.NJ;
    const keep = new Set();
    for (const s of this.shards) if (s.ring === NJ && s.attached && Math.random() < 0.62) keep.add(s.sector);
    return this._eject((s) => {
      if (s.ring === NJ) return !keep.has(s.sector);
      if (s.ring === NJ - 1) return !(keep.has(s.sector) && Math.random() < 0.22);
      return true;
    });
  }

  _refreshCracks() {
    const attr = this.cracks.geometry.attributes.aOrder;
    for (const r of this.ribbons) {
      const alive = r.owners.some((i) => this.shards[i] && this.shards[i].attached);
      for (let k = 0; k < r.count; k++) attr.array[r.start + k] = alive ? r.order[k] : 99;
    }
    attr.needsUpdate = true;
  }

  _disposeFracture() {
    for (const s of this.shards) {
      s.mesh.removeFromParent();
      s.mesh.geometry.dispose();
    }
    this.shards = [];
    if (this.cracks) {
      this.cracks.removeFromParent();
      this.cracks.geometry.dispose();
      this.cracks = null;
    }
  }

  /** Fresh, unbroken lens with a new hidden fracture pattern. */
  reset() {
    this.generate();
  }

  /** Dome-local point to world space. */
  toWorld(local, out = new THREE.Vector3()) {
    return this.group.localToWorld(out.copy(local));
  }
}

