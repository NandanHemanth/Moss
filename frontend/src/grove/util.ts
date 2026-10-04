// Small procedural helpers shared by the grove scene: seeded random, value noise, the terrain height
// function, a "loft" (tube with a varying elliptical cross-section) used for trunks and animal bodies,
// canvas textures, and the shader patch that gives creatures their soft spirit glow.
import * as THREE from "three";

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent approach of `current` towards `target`. */
export const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));

function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function noise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise in 0..1. */
export function fbm(x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x, y) * amp;
    norm += amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
    amp *= 0.5;
  }
  return sum / norm;
}

// ------------------------------------------------------------------ world layout
/** Pond centre and radii (world x/z). */
export const POND = { x: 7.0, z: -5.9, rx: 2.6, rz: 1.5 };

/** Height of the mossy ground at world (x, z). The clearing in the middle is gentle; the edges roll. */
export function groundY(x: number, z: number): number {
  const dx = x / 15;
  const dz = z < -7 ? (z + 7) / 13 : (z + 7) / 26; // the calm ground reaches forward, under the viewer
  const edge = smoothstep(0.55, 1.5, Math.sqrt(dx * dx + dz * dz));
  let h = (fbm(x * 0.07 + 3.1, z * 0.07 - 1.7, 3) - 0.5) * 2.2 * (0.16 + 0.84 * edge);
  h += (fbm(x * 0.45, z * 0.45, 2) - 0.5) * 0.14;
  h += smoothstep(-22, -70, z) * 3.2; // the forest floor rises gently into the distance
  const px = (x - POND.x) / (POND.rx * 1.25);
  const pz = (z - POND.z) / (POND.rz * 1.25);
  h -= 0.3 * Math.exp(-(px * px + pz * pz) * 1.4);
  return h;
}

// ------------------------------------------------------------------ geometry
export interface LoftOptions {
  radial?: number;
  /** Extra rings between two control points. */
  sub?: number;
  /** Reference "side" axis; the cross-section's first radius runs along it. */
  ref?: THREE.Vector3;
  /** Radius multiplier per (t along the path 0..1, angle). */
  shape?: (t: number, a: number) => number;
  /** Vertex colour per (t, angle, position). `a = PI/2` is the top of a body lying along +Z. */
  color?: (t: number, a: number, out: THREE.Color, p: THREE.Vector3) => void;
  capStart?: boolean;
  capEnd?: boolean;
  /** Also write UVs (u around, v in metres along the path / `uv`), for tiling textures such as bark. */
  uv?: number;
}

const crom = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/**
 * A smooth tube through control points `[x, y, z, rx, ry]` with an elliptical cross-section.
 * No UVs; has position, normal and color attributes so pieces can be merged.
 */
export function loft(pts: number[][], o: LoftOptions = {}): THREE.BufferGeometry {
  const radial = o.radial ?? 10;
  const sub = o.sub ?? 3;
  const ref = o.ref ?? new THREE.Vector3(1, 0, 0);
  const n = pts.length;
  const samples: number[][] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      samples.push([0, 1, 2, 3, 4].map((k) => (k < 3 ? crom(p0[k], p1[k], p2[k], p3[k], t) : Math.max(0, lerp(p1[k], p2[k], t * t * (3 - 2 * t))))));
    }
  }
  samples.push(pts[n - 1].slice(0, 5));

  const capStart = o.capStart ?? true;
  const capEnd = o.capEnd ?? true;
  const rings: { c: THREE.Vector3; rx: number; ry: number; t: number; S: THREE.Vector3; N: THREE.Vector3 }[] = [];
  const S = new THREE.Vector3();
  const prevS = new THREE.Vector3().copy(ref);
  const T = new THREE.Vector3();
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    S.copy(ref).addScaledVector(T, -ref.dot(T));
    if (S.lengthSq() < 0.02) S.copy(prevS).addScaledVector(T, -prevS.dot(T));
    if (S.lengthSq() < 0.02) S.set(0, 1, 0).addScaledVector(T, -T.y);
    S.normalize();
    prevS.copy(S);
    const N = new THREE.Vector3().crossVectors(T, S).normalize();
    const cur = samples[i];
    rings.push({ c: new THREE.Vector3(cur[0], cur[1], cur[2]), rx: cur[3], ry: cur[4], t: i / (samples.length - 1), S: S.clone(), N });
  }
  if (capStart) rings.unshift({ ...rings[0], rx: 0, ry: 0 });
  if (capEnd) rings.push({ ...rings[rings.length - 1], rx: 0, ry: 0 });

  // With UVs the first column is repeated at the end so the texture can wrap; without, columns share vertices.
  const cols = o.uv ? radial + 1 : radial;
  const pos = new Float32Array(rings.length * cols * 3);
  const col = new Float32Array(rings.length * cols * 3);
  const uvs = o.uv ? new Float32Array(rings.length * cols * 2) : null;
  const c = new THREE.Color();
  const p = new THREE.Vector3();
  let along = 0;
  rings.forEach((r, j) => {
    if (j > 0) along += r.c.distanceTo(rings[j - 1].c);
    for (let k = 0; k < cols; k++) {
      const a = ((k % radial) / radial) * Math.PI * 2;
      const m = o.shape ? o.shape(r.t, a) : 1;
      p.copy(r.c)
        .addScaledVector(r.S, Math.cos(a) * r.rx * m)
        .addScaledVector(r.N, Math.sin(a) * r.ry * m);
      const o3 = (j * cols + k) * 3;
      pos[o3] = p.x;
      pos[o3 + 1] = p.y;
      pos[o3 + 2] = p.z;
      c.setRGB(1, 1, 1);
      if (o.color) o.color(r.t, a > Math.PI ? a - Math.PI * 2 : a, c, p);
      col[o3] = c.r;
      col[o3 + 1] = c.g;
      col[o3 + 2] = c.b;
      if (uvs && o.uv) {
        uvs[(j * cols + k) * 2] = k / radial;
        uvs[(j * cols + k) * 2 + 1] = along / o.uv;
      }
    }
  });
  const idx: number[] = [];
  for (let j = 0; j < rings.length - 1; j++) {
    for (let k = 0; k < radial; k++) {
      const k1 = o.uv ? k + 1 : (k + 1) % radial;
      const a = j * cols + k;
      const b = j * cols + k1;
      const d = (j + 1) * cols + k;
      const e = (j + 1) * cols + k1;
      idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (uvs) g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (o.uv) {
    // weld the shading across the seam
    const nor = g.getAttribute("normal");
    const n0 = new THREE.Vector3();
    const n1 = new THREE.Vector3();
    for (let j = 0; j < rings.length; j++) {
      n0.fromBufferAttribute(nor, j * cols);
      n1.fromBufferAttribute(nor, j * cols + radial);
      n0.add(n1).normalize();
      nor.setXYZ(j * cols, n0.x, n0.y, n0.z);
      nor.setXYZ(j * cols + radial, n0.x, n0.y, n0.z);
    }
  }
  return g;
}

/** Give a primitive geometry a colour attribute (and drop its UVs) so it can be merged with lofts. */
export function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation | ((p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void)): THREE.BufferGeometry {
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (typeof color === "function") {
      p.fromBufferAttribute(pos, i);
      if (nor) n.fromBufferAttribute(nor, i);
      c.setRGB(1, 1, 1);
      color(p, n, c);
    } else c.set(color);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.deleteAttribute("uv");
  return g;
}

// ------------------------------------------------------------------ textures
export function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void, height = size): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = height;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft round glow, white centre fading to transparent. */
export function glowTexture(size = 128, inner = 0.0, power = 2): THREE.CanvasTexture {
  return canvasTexture(size, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const d = Math.hypot(x + 0.5 - s / 2, y + 0.5 - s / 2) / (s / 2);
        const v = Math.pow(clamp(1 - (d - inner) / (1 - inner), 0, 1), power);
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(v * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

// ------------------------------------------------------------------ materials
export interface SpiritOptions {
  /** Self-illumination as a fraction of the surface colour. */
  glow: number;
  rim: THREE.ColorRepresentation;
  rimPower?: number;
  rimStrength?: number;
}

/**
 * Patch a lit material so it also emits a share of its own (vertex) colour plus a view-dependent rim.
 * This is what makes the creatures (and moonlit foliage) read at night without extra lights.
 */
export function spiritify<M extends THREE.Material>(mat: M, o: SpiritOptions): M {
  const uniforms = {
    uSelfGlow: { value: o.glow },
    uRimColor: { value: new THREE.Color(o.rim) },
    uRimPower: { value: o.rimPower ?? 2.5 },
    uRimStrength: { value: o.rimStrength ?? 1 },
  };
  mat.userData.spirit = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uSelfGlow;\nuniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimStrength;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float rimF = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), uRimPower);
        totalEmissiveRadiance += diffuseColor.rgb * uSelfGlow + uRimColor * rimF * uRimStrength;`,
      );
  };
  mat.customProgramCacheKey = () => "moss-spirit";
  return mat;
}

/** Dispose every geometry, material and texture under `root`. */
export function disposeTree(root: THREE.Object3D): void {
  const seen = new Set<unknown>();
  const once = (x: { dispose: () => void } | null | undefined) => {
    if (x && !seen.has(x)) {
      seen.add(x);
      x.dispose();
    }
  };
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    once(m.geometry);
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) once(v);
      const u = (mat as THREE.ShaderMaterial).uniforms;
      if (u) for (const k of Object.keys(u)) if (u[k]?.value instanceof THREE.Texture) once(u[k].value as THREE.Texture);
      once(mat);
    }
    if ((obj as THREE.InstancedMesh).isInstancedMesh) (obj as THREE.InstancedMesh).dispose();
  });
}
