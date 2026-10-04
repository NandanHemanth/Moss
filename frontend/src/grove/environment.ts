// The grove itself: sky and moon, fog-layered trees, mossy ground, stones, ferns, grass, a fallen log,
// a pond, glowing mushrooms, light shafts, fireflies, spores and will-o'-wisps. Everything is generated
// here; nothing is downloaded.
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CAMERA, LOG, MOON_DIR, POND_RIM, SHAFT_DIR, SNAG, STONES, keepClear } from "./layout";
import { POND, canvasTexture, clamp, fbm, glowTexture, groundY, lerp, loft, mulberry32, noise2, paint, smoothstep, spiritify, type Rng } from "./util";

export const PALETTE = {
  mist: new THREE.Color("#1d4a47"),
  zenith: new THREE.Color("#050d16"),
  moon: new THREE.Color("#cfe2ff"),
  gold: new THREE.Color("#ffcf6a"),
  aqua: new THREE.Color("#63f2d2"),
  violet: new THREE.Color("#b68cff"),
};
export const FOG_DENSITY = 0.03;

export interface Environment {
  group: THREE.Group;
  /** Advance wind, pulses and drifting lights. */
  update(t: number): void;
  /** 0 = full, 1 = lighter, 2 = lightest. */
  setQuality(level: number): void;
  /** `pixelsPerUnit` = drawing-buffer height / visible tan-span, for point sprite sizes. */
  setPointScale(pixelsPerUnit: number): void;
  budget: { fireflies: number; spores: number; grass: number; leafCards: number; trees: number };
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

function place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rotY: number, sx: number, sy = sx, sz = sx, tiltX = 0, tiltZ = 0) {
  tmpQ.setFromEuler(new THREE.Euler(tiltX, rotY, tiltZ, "YXZ"));
  tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
  mesh.setMatrixAt(i, tmpM);
}

// ------------------------------------------------------------------ sky
function buildSky(): THREE.Object3D {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(190, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uHorizon: { value: PALETTE.mist.clone() },
        uZenith: { value: PALETTE.zenith.clone() },
        uMoonDir: { value: MOON_DIR.clone() },
        uMoonCol: { value: PALETTE.moon.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uMoonDir; uniform vec3 uMoonCol;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.78, h), 0.55));
          // a band of brighter mist hugging the horizon, strongest under the moon
          float md = max(dot(d, uMoonDir), 0.0);
          vec3 flatMoon = normalize(vec3(uMoonDir.x, 0.0, uMoonDir.z));
          float toward = max(dot(normalize(vec3(d.x, 0.0, d.z)), flatMoon), 0.0);
          col += uHorizon * 0.9 * exp(-h * 5.5) * (0.35 + 0.65 * pow(toward, 3.0));
          float disc = smoothstep(0.9990, 0.99955, md);
          float halo = pow(md, 700.0) * 0.45 + pow(md, 90.0) * 0.22 + pow(md, 10.0) * 0.13;
          col += uMoonCol * (disc * 1.35 + halo);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  g.add(dome);
  return g;
}

function buildStars(rng: Rng, time: { value: number }): THREE.Points {
  const n = 260;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const az = (rng() - 0.5) * Math.PI * 1.1;
    const el = 0.32 + rng() * 0.75;
    pos[i * 3] = Math.sin(az) * Math.cos(el) * 170;
    pos[i * 3 + 1] = Math.sin(el) * 170;
    pos[i * 3 + 2] = -Math.cos(az) * Math.cos(el) * 170;
    seed[i] = rng();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uTime: time, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uPx; attribute float aSeed; varying float vA;
      void main() {
        vA = (0.35 + 0.65 * aSeed) * (0.75 + 0.25 * sin(uTime * (0.6 + aSeed * 1.7) + aSeed * 40.0));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (1.4 + aSeed * 1.8) * uPx;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vec3(0.82, 0.9, 1.0) * vA * smoothstep(1.0, 0.1, d), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -9;
  return pts;
}

/** Two painted rings of distant tree-tops, so the forest carries on behind the last real trees. */
function buildTreeline(rng: Rng): THREE.Object3D {
  const g = new THREE.Group();
  const tex = canvasTexture(
    1024,
    (ctx, w) => {
      const h = 256;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      // The pattern must tile, so everything is drawn three times across the seam.
      const blob = (x: number, y: number, r: number) => {
        for (const o of [-w, 0, w]) {
          ctx.beginPath();
          ctx.ellipse(x + o, y, r, r * (0.75 + rng() * 0.3), 0, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      for (let i = 0; i < 70; i++) {
        const x = rng() * w;
        const top = 40 + rng() * 120;
        const r = 26 + rng() * 34;
        for (let k = 0; k < 7; k++) blob(x + (rng() - 0.5) * r * 1.6, top + r * 0.4 + rng() * r * 0.9, r * (0.45 + rng() * 0.5));
        for (const o of [-w, 0, w]) ctx.fillRect(x + o - 3, top + r, 6 + rng() * 5, h);
      }
      ctx.fillRect(0, 200, w, 56);
    },
    256,
  );
  tex.wrapS = THREE.RepeatWrapping;
  const layers: Array<[number, number, number, number, number]> = [
    // radius, height, y, tone (mix towards mist), repeat
    [92, 30, 9, 0.8, 5],
    [70, 26, 6.5, 0.6, 4],
  ];
  for (const [radius, height, y, tone, repeat] of layers) {
    const t = tex.clone();
    t.repeat.set(repeat, 1);
    t.offset.x = rng();
    t.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map: t,
      alphaTest: 0.5,
      color: new THREE.Color("#04100d").lerp(PALETTE.mist, tone),
      fog: false,
      side: THREE.BackSide,
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 48, 1, true, Math.PI * 0.5, Math.PI), mat);
    mesh.position.set(0, y, 10);
    mesh.renderOrder = -8;
    g.add(mesh);
  }
  tex.dispose();
  return g;
}

// ------------------------------------------------------------------ ground
function buildGround(rng: Rng): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(150, 104, 120, 84);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -34);
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  const deep = new THREE.Color("#274e30");
  const moss = new THREE.Color("#4f9646");
  const bright = new THREE.Color("#9ccb58");
  const soil = new THREE.Color("#343c2a");
  const wet = new THREE.Color("#0b211f");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundY(x, z));
    const n1 = fbm(x * 0.16 + 9, z * 0.16, 3);
    const n2 = fbm(x * 0.7 - 3, z * 0.7 + 11, 2);
    tmpC.copy(deep).lerp(moss, smoothstep(0.25, 0.7, n1));
    tmpC.lerp(bright, smoothstep(0.55, 0.85, n2) * 0.55);
    tmpC.lerp(soil, smoothstep(0.62, 0.42, fbm(x * 0.11 + 40, z * 0.11 - 20, 2)) * 0.7);
    const px = (x - POND.x) / POND.rx;
    const pz = (z - POND.z) / POND.rz;
    tmpC.lerp(wet, smoothstep(1.9, 0.9, Math.sqrt(px * px + pz * pz)) * 0.85);
    col[i * 3] = tmpC.r;
    col[i * 3 + 1] = tmpC.g;
    col[i * 3 + 2] = tmpC.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();

  const tex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = "#c9c9c9";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 5200; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const r = 0.6 + rng() * 2.2;
      const v = Math.round(120 + rng() * 135);
      ctx.fillStyle = `rgba(${v},${Math.min(255, v + 12)},${v - 14},${0.35 + rng() * 0.5})`;
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) ctx.fillRect(x + ox, y + oy, r, r * (0.6 + rng()));
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(46, 32);
  tex.anisotropy = 4;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "ground";
  return mesh;
}

// ------------------------------------------------------------------ trees
interface TreeSpec {
  x: number;
  z: number;
  scale: number;
  rot: number;
  variant: number;
  far: boolean;
  hue: number;
}

const BARK = new THREE.Color("#6a5848");
const BARK_DARK = new THREE.Color("#2a221c");
const MOSS_BARK = new THREE.Color("#4f8a3a");

/** Tiling bark: pale ridges split by dark vertical furrows. Used as colour and as bump. */
function barkTexture(rng: Rng): THREE.CanvasTexture {
  const tex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = "#b9b9b9";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 150; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const len = 30 + rng() * 110;
      const w = 1.5 + rng() * 5;
      const v = Math.round(20 + rng() * 80);
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.35 + rng() * 0.5})`;
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      for (const ox of [-s, 0, s])
        for (const oy of [-s, 0, s]) {
          ctx.beginPath();
          ctx.moveTo(x + ox, y + oy);
          ctx.bezierCurveTo(x + ox + (rng() - 0.5) * 14, y + oy + len * 0.33, x + ox + (rng() - 0.5) * 14, y + oy + len * 0.66, x + ox + (rng() - 0.5) * 10, y + oy + len);
          ctx.stroke();
        }
    }
    for (let i = 0; i < 900; i++) {
      const v = Math.round(150 + rng() * 105);
      ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
      ctx.fillRect(rng() * s, rng() * s, 1 + rng() * 2, 2 + rng() * 7);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  tex.anisotropy = 4;
  return tex;
}

function trunkGeometry(rng: Rng, variant: number, far: boolean): THREE.BufferGeometry {
  const H = 12;
  const lean = (rng() - 0.5) * 1.6;
  const bend = (rng() - 0.5) * 1.4;
  const lobes = 4 + Math.floor(rng() * 3);
  const lobePhase = rng() * 6.28;
  const seed = variant * 13.7;
  const pts: number[][] = [];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    const r = 0.5 * (0.4 + 0.6 * Math.pow(1 - t, 1.15)) + 0.3 * Math.exp(-t * 14);
    pts.push([lean * t * t + Math.sin(t * 3.1) * bend * 0.25, -0.6 + t * (H + 0.6), bend * t * 0.5, r, r]);
  }
  const bark = (t: number, a: number, c: THREE.Color, p: THREE.Vector3) => {
    const n = fbm(a * 2.4 + seed, p.y * 0.9, 2);
    c.copy(BARK_DARK).lerp(BARK, 0.25 + n * 0.75);
    const mossy = smoothstep(0.45, 0.0, t) * (0.35 + 0.65 * noise2(a * 1.3 + seed, p.y * 0.6)) + Math.exp(-t * 16) * 0.7;
    c.lerp(MOSS_BARK, clamp(mossy, 0, 0.85));
  };
  const parts: THREE.BufferGeometry[] = [
    loft(pts, {
      // distant trees are fog-softened silhouettes: a quarter of the triangles is plenty
      radial: far ? 8 : 16,
      sub: far ? 1 : 2,
      capStart: false,
      uv: 2.2,
      // buttress roots: a few sharp ridges that die away up the bole, plus the bark's own waviness
      shape: (t, a) => 1 + 1.25 * Math.exp(-t * 17) * Math.pow(Math.max(0, Math.cos(lobes * 0.5 * a + lobePhase)), 6) + (noise2(Math.cos(a) * 2 + seed, t * 16 + Math.sin(a) * 2) - 0.5) * 0.2,
      color: bark,
    }),
  ];
  // a few heavy limbs reaching into the crown
  const limbs = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < limbs; i++) {
    const t0 = 0.5 + rng() * 0.38;
    const base = pts[Math.round(t0 * 9)];
    const ang = (i / limbs) * 6.28 + rng() * 1.2;
    const len = 2.6 + rng() * 2.6;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const r0 = base[3] * 0.55;
    parts.push(
      loft(
        [
          [base[0], base[1] - 0.2, base[2], r0, r0],
          [base[0] + dx * len * 0.4, base[1] + len * 0.28, base[2] + dz * len * 0.4, r0 * 0.75, r0 * 0.75],
          [base[0] + dx * len * 0.8, base[1] + len * 0.62, base[2] + dz * len * 0.8, r0 * 0.45, r0 * 0.45],
          [base[0] + dx * len, base[1] + len * 0.95, base[2] + dz * len, r0 * 0.12, r0 * 0.12],
        ],
        { radial: far ? 4 : 6, sub: far ? 1 : 2, uv: 2.2, ref: new THREE.Vector3(-dz, 0, dx), color: bark },
      ),
    );
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

function canopyBlobGeometry(detail: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  g = mergeVertices(g, 1e-3);
  const pos = g.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    tmpV.fromBufferAttribute(pos, i);
    const n = fbm(tmpV.x * 1.7 + tmpV.z * 0.9 + 3, tmpV.y * 1.7 - tmpV.z * 1.1, 3);
    const k = 0.72 + n * 0.56;
    const shade = 0.4 + 0.6 * smoothstep(-0.9, 0.8, tmpV.y) * (0.6 + n * 0.5);
    tmpV.multiplyScalar(k);
    pos.setXYZ(i, tmpV.x, tmpV.y * 0.74, tmpV.z);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function leafTexture(rng: Rng): THREE.CanvasTexture {
  const tex = canvasTexture(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 150; i++) {
      const r = Math.pow(rng(), 0.7) * s * 0.44;
      const a = rng() * 6.28;
      const x = s / 2 + Math.cos(a) * r;
      const y = s / 2 + Math.sin(a) * r * 0.86;
      const len = 11 + rng() * 15;
      const v = Math.round(105 + rng() * 150);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng() * 6.28);
      ctx.fillStyle = `rgb(${Math.round(v * 0.86)},${v},${Math.round(v * 0.8)})`;
      ctx.beginPath();
      ctx.moveTo(-len / 2, 0);
      ctx.quadraticCurveTo(0, -len * 0.36, len / 2, 0);
      ctx.quadraticCurveTo(0, len * 0.36, -len / 2, 0);
      ctx.fill();
      ctx.restore();
    }
  });
  tex.anisotropy = 2;
  return tex;
}

function scatterTrees(rng: Rng): TreeSpec[] {
  const clear = keepClear();
  const trees: TreeSpec[] = [
    // the two old giants that frame the view
    { x: -6.1, z: 1.9, scale: 1.55, rot: 0.6, variant: 0, far: false, hue: 0.2 },
    { x: 7.2, z: 1.2, scale: 1.4, rot: 2.4, variant: 1, far: false, hue: 0.6 },
  ];
  const ok = (x: number, z: number, spacing: number, lane: number) => {
    const ex = x / 8.2;
    const ez = (z + 5.5) / 8.6;
    if (ex * ex + ez * ez < 1) return false; // the open clearing
    if (Math.hypot(x - LOG.x, z - LOG.z) < 3.2 || Math.hypot(x - SNAG.x, z - SNAG.z) < 3 || Math.hypot(x - POND.x, z - POND.z) < 4.6) return false;
    for (const t of trees) if (Math.hypot(x - t.x, z - t.z) < spacing * (0.6 + 0.4 * t.scale)) return false;
    for (const p of clear) if (Math.hypot(x - p.x, z - p.z) < lane) return false;
    return true;
  };
  const fill = (count: number, x0: number, x1: number, z0: number, z1: number, spacing: number, lane: number, s0: number, s1: number, far: boolean) => {
    let made = 0;
    for (let tries = 0; tries < count * 60 && made < count; tries++) {
      const x = lerp(x0, x1, rng());
      const z = lerp(z0, z1, rng());
      if (!ok(x, z, spacing, lane)) continue;
      trees.push({ x, z, scale: lerp(s0, s1, rng()), rot: rng() * 6.28, variant: Math.floor(rng() * 3), far, hue: rng() });
      made++;
    }
  };
  fill(4, -24, -9.5, -4, 4.5, 4.4, 2.6, 0.95, 1.3, false);
  fill(4, 10.5, 24, -4, 4.5, 4.4, 2.6, 0.95, 1.3, false);
  fill(22, -27, 27, -31, -3, 4.3, 2.5, 0.8, 1.25, false);
  fill(52, -58, 58, -70, -30, 4.2, 0, 0.75, 1.3, true);
  return trees;
}

function buildTrees(rng: Rng, time: { value: number }): { group: THREE.Group; leafCards: number; trees: TreeSpec[]; bark: THREE.Texture; leaves: THREE.InstancedMesh } {
  const group = new THREE.Group();
  const trees = scatterTrees(rng);

  const barkTex = barkTexture(rng);
  const trunkMat = spiritify(new THREE.MeshLambertMaterial({ vertexColors: true, map: barkTex, bumpMap: barkTex, bumpScale: 2.5 }), { glow: 0, rim: "#8fc6d2", rimPower: 3.0, rimStrength: 0.3 });
  for (const far of [false, true]) {
    for (let variant = 0; variant < 3; variant++) {
      const list = trees.filter((t) => t.variant === variant && t.far === far);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(trunkGeometry(rng, variant, far), trunkMat, list.length);
      list.forEach((t, i) => place(mesh, i, t.x, groundY(t.x, t.z), t.z, t.rot, t.scale, t.scale * (0.92 + ((t.hue * 7) % 1) * 0.3), t.scale));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = `trunks-${far ? "far-" : ""}${variant}`;
      group.add(mesh);
    }
  }

  // crowns: a few dark cores per tree plus many alpha-tested leaf cards with baked moonlight
  interface Blob { p: THREE.Vector3; r: number; hue: number; far: boolean }
  const blobs: Blob[] = [];
  for (const t of trees) {
    const top = groundY(t.x, t.z) + 11.2 * t.scale;
    const n = t.far ? 4 : 7 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * 6.28;
      const rad = (i === 0 ? 0 : 1.4 + rng() * 2.9) * t.scale;
      blobs.push({
        p: new THREE.Vector3(t.x + Math.cos(a) * rad, top + (rng() - 0.45) * 3.6 * t.scale - rad * 0.22, t.z + Math.sin(a) * rad),
        r: (t.far ? 2.7 : 2.0) * t.scale * (0.8 + rng() * 0.55),
        hue: t.hue,
        far: t.far,
      });
    }
  }
  // leaves that hang into the top corners from the two giants
  for (const [x, y, z, r] of [[-8.4, 8.6, 3.6, 2.0], [-4.2, 9.6, 2.8, 1.8], [-10.8, 7.4, 1.0, 2.0], [9.2, 8.8, 2.8, 2.0], [5.6, 9.8, 2.0, 1.7], [11.8, 7.6, 0.2, 2.1]]) {
    blobs.push({ p: new THREE.Vector3(x, y, z), r, hue: 0.3, far: false });
  }
  // keep a window in the canopy where the moon hangs
  const eye = new THREE.Vector3(CAMERA.x, groundY(0, -3) + CAMERA.eye, CAMERA.z);
  const open = blobs.filter((b) => {
    const d = tmpV.copy(b.p).sub(eye);
    const dist = d.length();
    return d.normalize().angleTo(MOON_DIR) > 0.1 + Math.atan(b.r / dist);
  });
  blobs.length = 0;
  blobs.push(...open);

  const leafA = new THREE.Color("#1f4a2a");
  const leafB = new THREE.Color("#2f6b45");
  const leafC = new THREE.Color("#1c4a4a");
  const moonTint = new THREE.Color("#9fd4c4");
  const tint = (hue: number, out: THREE.Color) => out.copy(leafA).lerp(hue < 0.5 ? leafB : leafC, Math.abs(hue - 0.5) * 2);

  const coreMat = spiritify(new THREE.MeshLambertMaterial({ vertexColors: true }), { glow: 0, rim: "#6fb7a8", rimPower: 2.6, rimStrength: 0.2 });
  for (const far of [false, true]) {
    const list = blobs.filter((b) => b.far === far);
    const mesh = new THREE.InstancedMesh(canopyBlobGeometry(1), coreMat, list.length);
    list.forEach((b, i) => {
      place(mesh, i, b.p.x, b.p.y, b.p.z, rng() * 6.28, b.r * 0.66);
      mesh.setColorAt(i, tint(b.hue, tmpC).multiplyScalar(0.3 + rng() * 0.15));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = far ? "crowns-far" : "crowns";
    group.add(mesh);
  }

  const cardsPer = (b: Blob) => (b.far ? 5 : 12);
  const total = blobs.reduce((n, b) => n + cardsPer(b), 0);
  const cardGeo = new THREE.PlaneGeometry(1, 1);
  const leafMat = new THREE.MeshBasicMaterial({ map: leafTexture(rng), alphaTest: 0.4, side: THREE.DoubleSide });
  leafMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23 + instanceMatrix[3].y * 0.4;
          transformed.x += sin(uTime * 0.7 + ph) * 0.035;
          transformed.y += sin(uTime * 0.9 + ph * 1.7) * 0.025;
        #endif`,
      );
  };
  const cards = new THREE.InstancedMesh(cardGeo, leafMat, total);
  // Instances are written to alternating halves of the buffer, so drawing only the first half
  // (lowest quality) thins every crown evenly instead of stripping whole trees.
  let made = 0;
  const slot = () => {
    const i = made++;
    return i % 2 === 0 ? i / 2 : Math.ceil(total / 2) + (i - 1) / 2;
  };
  const dir = new THREE.Vector3();
  const look = new THREE.Matrix4();
  for (const b of blobs) {
    for (let k = 0; k < cardsPer(b); k++) {
      const ci = slot();
      dir.set(rng() - 0.5, (rng() - 0.4) * 0.9, rng() - 0.5).normalize();
      tmpV.copy(b.p).addScaledVector(dir, b.r * (0.55 + rng() * 0.4));
      tmpV.y = b.p.y + dir.y * b.r * 0.5;
      // cards face roughly outwards, with a random lean so no two line up
      const lean = new THREE.Vector3(dir.x + (rng() - 0.5) * 1.1, dir.y + (rng() - 0.5) * 1.1, dir.z + (rng() - 0.5) * 1.1).normalize();
      look.lookAt(new THREE.Vector3(), lean, UP);
      tmpQ.setFromRotationMatrix(look);
      const s = b.r * (b.far ? 1.95 : 1.42) * (0.8 + rng() * 0.6);
      tmpM.compose(tmpV, tmpQ, tmpS.set(s, s, s));
      cards.setMatrixAt(ci, tmpM);
      const lit = clamp(0.5 + 0.5 * dir.dot(MOON_DIR), 0, 1);
      const upness = 0.55 + 0.45 * clamp(dir.y + 0.4, 0, 1);
      tint(b.hue, tmpC)
        .multiplyScalar((0.34 + 0.9 * lit * lit) * upness * (0.8 + rng() * 0.4))
        .lerp(moonTint, lit * lit * 0.22);
      cards.setColorAt(ci, tmpC);
    }
  }
  cards.instanceMatrix.needsUpdate = true;
  if (cards.instanceColor) cards.instanceColor.needsUpdate = true;
  cards.name = "leaves";
  group.add(cards);
  return { group, leafCards: total, trees, bark: barkTex, leaves: cards };
}

// ------------------------------------------------------------------ undergrowth
function stoneGeometry(mossy: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  g = mergeVertices(g, 1e-3);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    tmpV.fromBufferAttribute(pos, i);
    const k = 0.74 + fbm(tmpV.x * 1.3 + 7, tmpV.y * 1.3 + tmpV.z * 1.1, 2) * 0.52;
    pos.setXYZ(i, tmpV.x * k, tmpV.y * k * 0.66, tmpV.z * k * 0.9);
  }
  g.computeVertexNormals();
  const rock = new THREE.Color("#4a5350");
  const rockDark = new THREE.Color("#1f2625");
  const mossC = new THREE.Color(mossy ? "#2c5a2c" : "#3f7a36");
  const nor = g.getAttribute("normal");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    tmpV.fromBufferAttribute(pos, i);
    const ny = nor.getY(i);
    const n = fbm(tmpV.x * 3 + 2, tmpV.z * 3 - tmpV.y * 2, 2);
    tmpC.copy(rockDark).lerp(rock, 0.3 + n * 0.7);
    tmpC.lerp(mossC, clamp(smoothstep(0.25 - mossy, 0.85 - mossy, ny + (n - 0.5) * 0.5), 0, 1) * (0.75 + mossy * 0.25));
    col[i * 3] = tmpC.r;
    col[i * 3 + 1] = tmpC.g;
    col[i * 3 + 2] = tmpC.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

function buildStones(rng: Rng): THREE.Object3D {
  const g = new THREE.Group();
  const mat = spiritify(new THREE.MeshLambertMaterial({ vertexColors: true }), { glow: 0, rim: "#8fd0c8", rimPower: 3, rimStrength: 0.18 });
  const specs: Array<[number, number, number]> = [
    // the tortoise's stones
    [STONES.x, STONES.z, 0.62], [STONES.x + 0.75, STONES.z - 0.15, 0.36], [STONES.x - 0.6, STONES.z + 0.3, 0.3], [STONES.x + 0.2, STONES.z + 0.6, 0.24],
    // pond rim
    ...POND_RIM,
    // scattered
    [-9.2, -0.8, 0.7], [-8.4, -0.2, 0.35], [9.8, -7.2, 0.8], [-3.6, -8.7, 0.42], [3.4, -13.0, 0.8], [4.3, -12.8, 0.4],
    [-4.6, -12.9, 0.7], [15.5, -17.5, 0.6], [4.6, 1.4, 0.3], [-0.2, -4.6, 0.22], [8.9, -1.6, 0.34],
  ];
  const stones = new THREE.InstancedMesh(stoneGeometry(0), mat, specs.length);
  specs.forEach(([x, z, s], i) => place(stones, i, x, groundY(x, z) + s * 0.18, z, rng() * 6.28, s * (0.9 + rng() * 0.3), s * (0.8 + rng() * 0.5), s));
  stones.instanceMatrix.needsUpdate = true;
  stones.name = "stones";
  g.add(stones);

  const lanes = keepClear().filter((p) => p.y < 0.5);
  const mounds: Array<[number, number, number]> = [];
  for (let i = 0; i < 22; i++) {
    const x = (rng() - 0.5) * 36;
    const z = 1 - rng() * 22;
    if (Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz) < 1.5) continue;
    if (lanes.some((p) => Math.hypot(p.x - x, p.z - z) < 1.9)) continue; // never on a path the animals walk
    mounds.push([x, z, 0.45 + rng() * 0.75]);
  }
  const mound = new THREE.InstancedMesh(stoneGeometry(1), mat, mounds.length);
  mounds.forEach(([x, z, s], i) => place(mound, i, x, groundY(x, z) - s * 0.3, z, rng() * 6.28, s * 1.15, s * 0.62, s));
  mound.instanceMatrix.needsUpdate = true;
  mound.name = "moss-mounds";
  g.add(mound);
  return g;
}

function buildLogAndSnag(barkTex: THREE.Texture): THREE.Object3D {
  const g = new THREE.Group();
  const bark = (seed: number) => (t: number, a: number, c: THREE.Color) => {
    const n = fbm(a * 2.2 + seed, t * 9, 2);
    c.copy(BARK_DARK).lerp(BARK, 0.3 + n * 0.7);
    c.lerp(MOSS_BARK, smoothstep(0.1, 0.95, Math.sin(a)) * (0.5 + n * 0.5));
  };
  const half = LOG.length / 2;
  const logGeo = mergeGeometries([
    loft(
      [
        [0, 0, -half, LOG.radius * 0.7, LOG.radius * 0.7],
        [0, 0.02, -half + 0.25, LOG.radius * 1.08, LOG.radius * 1.02],
        [0.05, 0, -half * 0.3, LOG.radius, LOG.radius * 0.96],
        [-0.04, 0.03, half * 0.4, LOG.radius * 0.92, LOG.radius * 0.9],
        [0, 0.02, half - 0.2, LOG.radius * 0.84, LOG.radius * 0.84],
        [0, 0.02, half, LOG.radius * 0.5, LOG.radius * 0.5],
      ],
      { radial: 12, sub: 3, uv: 2.2, color: bark(1), shape: (t, a) => 1 + (noise2(Math.cos(a) * 2, t * 14 + Math.sin(a) * 2) - 0.5) * 0.18 },
    ),
    loft(
      [
        [0.05, 0.2, 0.6, 0.11, 0.11],
        [0.4, 0.62, 0.72, 0.07, 0.07],
        [0.62, 1.0, 0.95, 0.02, 0.02],
      ],
      { radial: 6, sub: 2, uv: 2.2, ref: new THREE.Vector3(0, 0, 1), color: bark(4) },
    ),
  ]);
  const mat = spiritify(new THREE.MeshLambertMaterial({ vertexColors: true, map: barkTex, bumpMap: barkTex, bumpScale: 2 }), { glow: 0, rim: "#8fc6d2", rimPower: 3, rimStrength: 0.3 });
  const log = new THREE.Mesh(logGeo, mat);
  log.position.set(LOG.x, groundY(LOG.x, LOG.z) + LOG.radius * 0.72, LOG.z);
  log.rotation.y = LOG.rot + Math.PI / 2;
  log.name = "log";
  g.add(log);

  // the owl's perch: a broken, leaning snag with one long side branch
  const sy = groundY(SNAG.x, SNAG.z);
  const snagGeo = mergeGeometries([
    loft(
      [
        [0, -0.3, 0, 0.36, 0.36],
        [0.02, 0.25, 0, 0.24, 0.24],
        [0.08, 0.95, 0.03, 0.19, 0.19],
        [0.17, 1.65, 0.06, 0.15, 0.15],
        [0.22, 2.05, 0.08, 0.09, 0.05],
        [0.25, 2.3, 0.1, 0.02, 0.02],
      ],
      { radial: 10, sub: 2, uv: 2.2, color: bark(7), shape: (t, a) => 1 + 0.55 * Math.exp(-t * 9) * Math.pow(Math.max(0, Math.cos(2.5 * a)), 2) + (noise2(Math.cos(a) * 2, t * 12 + Math.sin(a) * 2) - 0.5) * 0.2 },
    ),
    loft(
      [
        [0.05, 0.95, 0.03, 0.09, 0.09],
        [-0.4, 1.1, 0.1, 0.072, 0.072],
        [-0.98, 1.16, 0.15, 0.058, 0.058],
        [-1.5, 1.2, 0.12, 0.04, 0.04],
        [-1.85, 1.34, 0.05, 0.012, 0.012],
      ],
      { radial: 7, sub: 3, uv: 2.2, ref: new THREE.Vector3(0, 0, 1), color: bark(9) },
    ),
    loft(
      [
        [0.12, 1.5, 0.05, 0.06, 0.06],
        [0.5, 1.82, -0.1, 0.035, 0.035],
        [0.75, 2.2, -0.16, 0.008, 0.008],
      ],
      { radial: 6, sub: 2, uv: 2.2, ref: new THREE.Vector3(0, 0, 1), color: bark(11) },
    ),
  ]);
  const snag = new THREE.Mesh(snagGeo, mat);
  snag.position.set(SNAG.x, sy, SNAG.z);
  snag.name = "snag";
  g.add(snag);
  return g;
}

function buildGrass(rng: Rng, time: { value: number }): { mesh: THREE.InstancedMesh; count: number } {
  // one tuft = a handful of tapered blades
  const blades = 6;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const base = new THREE.Color("#173420");
  const tip = new THREE.Color("#74b254");
  for (let b = 0; b < blades; b++) {
    const a = rng() * 6.28;
    const r = rng() * 0.16;
    const ox = Math.cos(a) * r;
    const oz = Math.sin(a) * r;
    const face = rng() * 6.28;
    const wx = Math.cos(face) * 0.032;
    const wz = Math.sin(face) * 0.032;
    const leanX = (rng() - 0.5) * 0.5;
    const leanZ = (rng() - 0.5) * 0.5;
    const h = 0.55 + rng() * 0.55;
    const v0 = pos.length / 3;
    const push = (x: number, y: number, z: number, t: number) => {
      pos.push(x, y, z);
      tmpC.copy(base).lerp(tip, t);
      col.push(tmpC.r, tmpC.g, tmpC.b);
    };
    push(ox - wx, 0, oz - wz, 0);
    push(ox + wx, 0, oz + wz, 0);
    push(ox - wx * 0.6 + leanX * 0.25 * h, h * 0.55, oz - wz * 0.6 + leanZ * 0.25 * h, 0.55);
    push(ox + wx * 0.6 + leanX * 0.25 * h, h * 0.55, oz + wz * 0.6 + leanZ * 0.25 * h, 0.55);
    push(ox + leanX * h, h, oz + leanZ * h, 1);
    idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2, v0 + 2, v0 + 3, v0 + 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float wph = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27;
          float bend = position.y * position.y;
          transformed.x += (sin(uTime * 1.3 + wph) * 0.1 + sin(uTime * 2.9 + wph * 2.3) * 0.035) * bend;
          transformed.z += cos(uTime * 1.1 + wph * 1.3) * 0.07 * bend;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => "moss-grass";

  const count = 3400;
  const lanes = keepClear().filter((p) => p.y < 0.5);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  let made = 0;
  for (let tries = 0; tries < count * 8 && made < count; tries++) {
    // denser near the camera, thinning with depth
    const depth = Math.pow(rng(), 1.6);
    const z = 1.5 - depth * 24;
    const x = (rng() - 0.5) * (26 + depth * 24);
    if (Math.hypot((x - POND.x) / (POND.rx * 1.05), (z - POND.z) / (POND.rz * 1.05)) < 1) continue;
    const patch = fbm(x * 0.3 + 5, z * 0.3 - 8, 2);
    if (patch < 0.36 && rng() < 0.8) continue;
    // cropped short where the animals walk, so their legs stay in view
    let lane = 1;
    for (const p of lanes) if (Math.abs(p.x - x) < 1.6 && Math.abs(p.z - z) < 1.6) lane = Math.min(lane, Math.hypot(p.x - x, p.z - z) / 1.6);
    const s = (0.16 + rng() * 0.2) * (0.7 + patch * 0.7) * (0.4 + 0.6 * lane);
    place(mesh, made, x, groundY(x, z) - 0.02, z, rng() * 6.28, s * 1.5, s, s * 1.5);
    tmpC.setRGB(0.6 + rng() * 0.5, 0.75 + rng() * 0.45, 0.6 + rng() * 0.4);
    mesh.setColorAt(made, tmpC);
    made++;
  }
  mesh.count = made;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = "grass";
  return { mesh, count: made };
}

function buildFerns(rng: Rng): THREE.InstancedMesh {
  const parts: THREE.BufferGeometry[] = [];
  const fronds = 12;
  const dark = new THREE.Color("#173a22");
  const light = new THREE.Color("#5aa552");
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * 6.28 + rng() * 0.5;
    const len = 0.7 + rng() * 0.5;
    const rise = 0.45 + rng() * 0.45;
    const seg = 12;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const out = t * len;
      const y = Math.sin(t * 2.2) * rise - t * t * 0.42;
      const w = Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.96 + 0.04)), 0.8) * 0.115 * (i % 2 ? 1 : 0.35);
      const cx = Math.cos(a) * out;
      const cz = Math.sin(a) * out;
      pos.push(cx - Math.sin(a) * w, y, cz + Math.cos(a) * w, cx + Math.sin(a) * w, y, cz - Math.cos(a) * w);
      tmpC.copy(dark).lerp(light, 0.15 + t * 0.85);
      col.push(tmpC.r, tmpC.g, tmpC.b, tmpC.r, tmpC.g, tmpC.b);
      if (i < seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const lanes = keepClear().filter((p) => p.y < 0.5);
  const spots: Array<[number, number, number]> = [
    // big dark fronds right in front of the lens, in the bottom corners
    [-6.2, 7.6, 2.3], [-7.6, 6.6, 2.0], [6.6, 7.5, 2.2], [8.0, 6.4, 2.0],
  ];
  for (let i = 0; i < 74; i++) {
    const depth = Math.pow(rng(), 1.3);
    const z = 2.4 - depth * 22;
    const x = (rng() - 0.5) * (26 + depth * 16);
    if (Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz) < 1.15) continue;
    if (Math.abs(x) < 9.5 && z > -4.4) continue; // keep the front of the stage open for the fox and the tortoise
    if (lanes.some((p) => Math.hypot(p.x - x, p.z - z) < 1.7)) continue;
    spots.push([x, z, 0.75 + rng() * 0.8]);
  }
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  spots.forEach(([x, z, s], i) => {
    place(mesh, i, x, groundY(x, z), z, rng() * 6.28, s);
    tmpC.setRGB(0.7 + rng() * 0.4, 0.8 + rng() * 0.3, 0.7 + rng() * 0.4);
    mesh.setColorAt(i, tmpC);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = "ferns";
  return mesh;
}

// ------------------------------------------------------------------ magic
interface Shroom { x: number; y: number; z: number; s: number; color: THREE.Color; tilt: number; rot: number }

function buildMushrooms(rng: Rng, time: { value: number }, glow: THREE.Texture, trees: TreeSpec[]): { group: THREE.Group; lights: THREE.PointLight[] } {
  const group = new THREE.Group();
  const shrooms: Shroom[] = [];
  const pools: Array<{ x: number; z: number; r: number; color: THREE.Color; strength: number }> = [];
  const cluster = (cx: number, cz: number, radius: number, n: number, color: THREE.Color, s0: number, s1: number, pool = 1) => {
    for (let i = 0; i < n; i++) {
      const a = rng() * 6.28;
      const r = Math.sqrt(rng()) * radius;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const c = color.clone().offsetHSL((rng() - 0.5) * 0.05, 0, (rng() - 0.5) * 0.1);
      shrooms.push({ x, y: groundY(x, z), z, s: lerp(s0, s1, Math.pow(rng(), 1.6)), color: c, tilt: (rng() - 0.5) * 0.5, rot: rng() * 6.28 });
    }
    if (pool > 0) pools.push({ x: cx, z: cz, r: radius * 1.6 + 1.2, color, strength: pool });
  };
  cluster(-4.4, 0.4, 0.75, 9, PALETTE.aqua, 0.2, 0.5);
  cluster(5.4, 0.9, 0.7, 8, PALETTE.aqua, 0.18, 0.46);
  cluster(POND.x - 2.2, POND.z + 1.5, 0.7, 7, PALETTE.violet, 0.16, 0.42);
  cluster(POND.x + 2.4, POND.z + 0.6, 0.5, 5, PALETTE.violet, 0.14, 0.34, 0.6);
  cluster(SNAG.x + 0.55, SNAG.z + 0.35, 0.4, 5, PALETTE.gold, 0.12, 0.3, 0.7);
  cluster(LOG.x + 2.6, LOG.z - 0.5, 0.6, 7, PALETTE.aqua, 0.14, 0.4);
  cluster(-12.6, -8.5, 0.6, 6, PALETTE.violet, 0.2, 0.5, 0.8);
  cluster(0.8, -12.9, 0.7, 7, PALETTE.aqua, 0.2, 0.55, 0.9);
  cluster(11.6, -6.3, 0.7, 6, PALETTE.gold, 0.2, 0.46, 0.7);
  // a ring at the foot of some trees
  for (const t of trees.filter((t) => !t.far).slice(0, 14)) {
    if (rng() < 0.35) continue;
    const a = Math.atan2(10 - t.z, -t.x) + (rng() - 0.5) * 1.6; // on the side that faces the camera
    const d = 1.25 * t.scale;
    cluster(t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, 0.5, 4, rng() < 0.7 ? PALETTE.aqua : PALETTE.violet, 0.14, 0.4, 0.55);
  }
  // shelf mushrooms along the top of the fallen log
  for (let i = 0; i < 7; i++) {
    const along = (rng() - 0.5) * LOG.length * 0.8;
    const x = LOG.x + Math.cos(LOG.rot) * along;
    const z = LOG.z - Math.sin(LOG.rot) * along;
    shrooms.push({ x, y: groundY(LOG.x, LOG.z) + LOG.radius * 1.62, z, s: 0.12 + rng() * 0.14, color: PALETTE.aqua.clone(), tilt: (rng() - 0.5) * 0.4, rot: rng() * 6.28 });
  }

  const capGeo = new THREE.LatheGeometry(
    // profile runs bottom-up: gills, rim, then over the dome to the tip
    [[0.1, 0.02], [0.5, -0.02], [0.9, -0.07], [1.0, -0.04], [0.96, 0.06], [0.78, 0.25], [0.5, 0.41], [0.22, 0.5], [0.001, 0.52]].map(([x, y]) => new THREE.Vector2(x, y)),
    10,
  );
  paint(capGeo, (p, _n, c) => c.setScalar(p.y < 0.0 ? 0.55 : 0.55 + 0.45 * smoothstep(0.5, 0.0, p.y)));
  capGeo.scale(0.5, 0.62, 0.5);
  capGeo.translate(0, 1, 0);
  const stemGeo = new THREE.CylinderGeometry(0.075, 0.12, 1, 7, 1, true);
  stemGeo.translate(0, 0.5, 0);
  paint(stemGeo, (p, _n, c) => c.setScalar(0.45 + 0.55 * p.y));

  const phases = new Float32Array(shrooms.length);
  shrooms.forEach((_, i) => (phases[i] = rng() * 6.28));
  capGeo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
  const capMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  capMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aPhase;\nvarying float vPulse;\nuniform float uTime;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPulse = 0.72 + 0.28 * sin(uTime * 1.15 + aPhase);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vPulse;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float rimC = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 2.0);
        totalEmissiveRadiance += diffuseColor.rgb * (0.55 + rimC * 0.7) * vPulse;`,
      );
  };
  capMat.customProgramCacheKey = () => "moss-cap";
  const stemMat = spiritify(new THREE.MeshLambertMaterial({ vertexColors: true }), { glow: 0.5, rim: "#ffffff", rimPower: 2, rimStrength: 0.05 });

  const caps = new THREE.InstancedMesh(capGeo, capMat, shrooms.length);
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, shrooms.length);
  shrooms.forEach((m, i) => {
    place(stems, i, m.x, m.y - 0.02, m.z, m.rot, m.s, m.s, m.s, m.tilt * 0.5, m.tilt * 0.4);
    place(caps, i, m.x, m.y - 0.02, m.z, m.rot, m.s * (1.1 + ((i * 7) % 5) * 0.09), m.s, m.s * 1.15, m.tilt * 0.5, m.tilt * 0.4);
    caps.setColorAt(i, m.color);
    stems.setColorAt(i, tmpC.copy(m.color).lerp(new THREE.Color("#e9f6e6"), 0.6).multiplyScalar(0.55));
  });
  for (const m of [caps, stems]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  caps.name = "mushroom-caps";
  stems.name = "mushroom-stems";
  group.add(caps, stems);

  // pools of coloured light on the moss under each cluster
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({ map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const poolMesh = new THREE.InstancedMesh(poolGeo, poolMat, pools.length);
  pools.forEach((p, i) => {
    place(poolMesh, i, p.x, groundY(p.x, p.z) + 0.07, p.z, 0, p.r * 2, 1, p.r * 2);
    poolMesh.setColorAt(i, tmpC.copy(p.color).multiplyScalar(0.13 * p.strength));
  });
  poolMesh.instanceMatrix.needsUpdate = true;
  if (poolMesh.instanceColor) poolMesh.instanceColor.needsUpdate = true;
  poolMesh.name = "mushroom-pools";
  poolMesh.renderOrder = 2;
  group.add(poolMesh);

  const lights = [
    new THREE.PointLight(PALETTE.aqua, 2.2, 8, 2),
    new THREE.PointLight(PALETTE.aqua, 2.2, 8, 2),
  ];
  lights[0].position.set(-4.4, groundY(-4.4, 0.6) + 0.7, 0.2);
  lights[1].position.set(5.3, groundY(5.3, 0.9) + 0.7, 0.5);
  group.add(...lights);
  return { group, lights };
}

function buildPond(time: { value: number }): THREE.Object3D {
  const g = new THREE.Group();
  const geo = new THREE.CircleGeometry(1, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: time,
      uSky: { value: PALETTE.mist.clone().multiplyScalar(1.5) },
      uGlow: { value: PALETTE.aqua.clone() },
      uMoon: { value: PALETTE.moon.clone() },
      uFogColor: { value: PALETTE.mist.clone() },
      uFogDensity: { value: FOG_DENSITY },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec2 vLocal; varying float vDepth;
      void main() {
        vLocal = position.xz;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mv = viewMatrix * w;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSky; uniform vec3 uGlow; uniform vec3 uMoon; uniform vec3 uFogColor; uniform float uFogDensity;
      varying vec3 vWorld; varying vec2 vLocal; varying float vDepth;
      void main() {
        vec2 p = vWorld.xz;
        float r1 = sin(p.x * 2.6 + uTime * 0.55) * sin(p.y * 5.3 - uTime * 0.4);
        float r2 = sin((p.x * 1.3 + p.y * 7.0) + uTime * 0.8);
        float ripple = r1 * 0.6 + r2 * 0.4;
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
        vec3 col = mix(vec3(0.004, 0.03, 0.035), uSky, clamp(fres * (0.8 + ripple * 0.2), 0.0, 1.0));
        float d = length(vLocal);
        col += uGlow * (0.16 + 0.1 * ripple) * smoothstep(1.0, 0.2, d);
        col += uMoon * pow(max(ripple, 0.0), 7.0) * 0.9;
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
        col = mix(col, uFogColor, fog);
        gl_FragColor = vec4(col, smoothstep(1.0, 0.86, d));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const water = new THREE.Mesh(geo, mat);
  water.scale.set(POND.rx * 1.18, 1, POND.rz * 1.18);
  water.position.set(POND.x, groundY(POND.x, POND.z) + 0.17, POND.z);
  water.name = "pond";
  water.renderOrder = 1;
  g.add(water);
  const light = new THREE.PointLight(PALETTE.aqua, 3.5, 8, 2);
  light.position.set(POND.x, water.position.y + 0.5, POND.z);
  g.add(light);
  return g;
}

function buildShafts(rng: Rng, time: { value: number }, glow: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const lands: Array<[number, number, number]> = [
    [-4.5, -8.5, 1.7], [1.6, -5.0, 1.3], [6.2, -11.5, 2.0], [-9.5, -14, 2.2], [-1, -16.5, 2.4], [10.5, -19, 2.6], [-14, -22, 2.8], [-2.2, -1.6, 1.0],
  ];
  const L = 26;
  const geo = new THREE.CylinderGeometry(0.42, 1, L, 14, 1, true);
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, SHAFT_DIR);
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);
  lands.forEach(([x, z, r], i) => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: time,
        uPhase: { value: rng() * 20 },
        uColor: { value: new THREE.Color("#a9dcd8") },
        uStrength: { value: 0.36 + rng() * 0.16 },
        uFogDensity: { value: FOG_DENSITY * 0.6 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth;
        void main() {
          vUv = uv;
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uPhase; uniform vec3 uColor; uniform float uStrength; uniform float uFogDensity;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth;
        void main() {
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          float along = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.72, vUv.y) * (0.3 + 0.7 * vUv.y);
          float streak = 0.62 + 0.38 * sin(vUv.x * 44.0 + uPhase) * sin(vUv.x * 17.0 - uPhase * 1.7 + uTime * 0.07);
          float shimmer = 0.78 + 0.22 * sin(uTime * 0.45 + uPhase + vUv.y * 2.5);
          float fog = exp(-uFogDensity * uFogDensity * vDepth * vDepth);
          gl_FragColor = vec4(uColor * edge * along * streak * shimmer * uStrength * fog, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const shaft = new THREE.Mesh(geo, mat);
    const y = groundY(x, z);
    shaft.position.set(x, y, z).addScaledVector(SHAFT_DIR, L / 2 - 0.4);
    shaft.quaternion.copy(quat);
    shaft.scale.set(r, 1, r);
    shaft.renderOrder = 5 + i;
    shaft.name = "light-shaft";
    g.add(shaft);

    const pool = new THREE.Mesh(
      poolGeo,
      new THREE.MeshBasicMaterial({ map: glow, color: new THREE.Color("#8fc9b9").multiplyScalar(0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    pool.position.set(x, y + 0.06, z);
    pool.scale.set(r * 2.8, 1, r * 2.4);
    pool.renderOrder = 2;
    g.add(pool);
  });
  return g;
}

export interface PointCloud {
  points: THREE.Points;
  count: number;
  uniforms: { uTime: { value: number }; uScale: { value: number }; uCenter: { value: THREE.Vector3 } };
}

/** Additive glowing points that drift on their own in the vertex shader (no per-frame CPU work). */
export function glowPoints(
  n: number,
  time: { value: number },
  fill: (i: number, pos: THREE.Vector3, color: THREE.Color) => number,
  o: { amp: [number, number, number]; blink: number; speed: number; rise?: number; brightness?: number },
  rng: Rng,
): PointCloud {
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  const size = new Float32Array(n);
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    size[i] = fill(i, p, c);
    pos.set([p.x, p.y, p.z], i * 3);
    col.set([c.r, c.g, c.b], i * 3);
    seed.set([rng(), rng(), rng(), rng()], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const uniforms = {
    uTime: time,
    uScale: { value: 600 },
    uCenter: { value: new THREE.Vector3() },
    uAmp: { value: new THREE.Vector3(...o.amp) },
    uBlink: { value: o.blink },
    uSpeed: { value: o.speed },
    uRise: { value: o.rise ?? 0 },
    uBright: { value: o.brightness ?? 1 },
    uFogDensity: { value: FOG_DENSITY * 0.7 },
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uScale; uniform vec3 uCenter; uniform vec3 uAmp; uniform float uBlink; uniform float uSpeed; uniform float uRise; uniform float uFogDensity;
      attribute vec3 aColor; attribute vec4 aSeed; attribute float aSize;
      varying vec3 vColor; varying float vA;
      void main() {
        float t = uTime * uSpeed;
        vec3 p = position + uCenter;
        p.x += sin(t * (0.5 + aSeed.x) + aSeed.y * 6.283) * uAmp.x * (0.4 + aSeed.z) + sin(t * 0.23 * (1.0 + aSeed.w) + aSeed.x * 9.0) * uAmp.x * 0.6;
        p.y += sin(t * (0.6 + aSeed.z) + aSeed.x * 6.283) * uAmp.y * (0.4 + aSeed.w);
        p.z += cos(t * (0.45 + aSeed.y) + aSeed.w * 6.283) * uAmp.z * (0.4 + aSeed.x);
        p.y += mod(uTime * uRise * (0.5 + aSeed.y) + aSeed.z * 7.0, 7.0) * step(0.0001, uRise);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        float px = aSize * uScale / max(dist, 0.5);
        float blink = mix(1.0, smoothstep(0.15, 0.85, 0.5 + 0.5 * sin(uTime * (0.7 + aSeed.w * 1.6) + aSeed.x * 40.0)), uBlink);
        // very small sprites keep a minimum size and fade instead, so they never flicker
        vA = blink * exp(-uFogDensity * uFogDensity * dist * dist) * clamp(px / 3.0, 0.25, 1.0);
        vColor = aColor;
        gl_PointSize = clamp(px, 3.0, 96.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uBright;
      varying vec3 vColor; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = smoothstep(0.32, 0.0, d);
        float halo = pow(max(0.0, 1.0 - d), 2.6);
        gl_FragColor = vec4(vColor * (core * 2.2 + halo * 0.75) * vA * uBright, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 20;
  return { points, count: n, uniforms };
}

// ------------------------------------------------------------------ assemble
export function buildEnvironment(seed: number, time: { value: number }): Environment {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  const glow = glowTexture(128, 0, 2.2);

  group.add(buildSky(), buildTreeline(rng));
  const stars = buildStars(rng, time);
  group.add(stars);

  // moonlight from behind the clearing, a soft cool fill from the viewer's side, and sky/ground ambience
  const moon = new THREE.DirectionalLight("#bcd4ff", 1.9);
  moon.position.copy(MOON_DIR).multiplyScalar(60);
  const fill = new THREE.DirectionalLight("#7fb8b0", 0.7);
  fill.position.set(-0.5, 0.8, 1).multiplyScalar(40);
  const hemi = new THREE.HemisphereLight("#7fb3c0", "#0b1a10", 0.95);
  group.add(moon, fill, hemi);

  group.add(buildGround(rng));
  const trees = buildTrees(rng, time);
  group.add(trees.group);
  group.add(buildStones(rng), buildLogAndSnag(trees.bark));
  const grass = buildGrass(rng, time);
  group.add(grass.mesh, buildFerns(rng));
  const shrooms = buildMushrooms(rng, time, glow, trees.trees);
  const shafts = buildShafts(rng, time, glow);
  group.add(shrooms.group, buildPond(time), shafts);

  const warm = PALETTE.gold;
  const green = new THREE.Color("#c2ff9a");
  const fireflies = glowPoints(
    240,
    time,
    (i, p, c) => {
      const depth = Math.pow(rng(), 1.25);
      p.set((rng() - 0.5) * (20 + depth * 22), 0, 4 - depth * 30);
      p.y = groundY(p.x, p.z) + 0.25 + Math.pow(rng(), 1.8) * 5.5;
      c.copy(i % 5 === 0 ? green : warm);
      return 0.13 + rng() * 0.1;
    },
    { amp: [0.7, 0.4, 0.7], blink: 1, speed: 0.55, brightness: 1.25 },
    rng,
  );
  const spores = glowPoints(
    300,
    time,
    (_i, p, c) => {
      p.set((rng() - 0.5) * 34, rng() * 1.5 - 1, 5 - rng() * 26);
      c.set("#bfe9d6").multiplyScalar(0.55 + rng() * 0.3);
      return 0.035 + rng() * 0.035;
    },
    { amp: [0.5, 0.25, 0.5], blink: 0.35, speed: 0.3, rise: 0.11, brightness: 0.55 },
    rng,
  );
  group.add(fireflies.points, spores.points);

  // will-o'-wisps: a bright core with a wide halo, wandering between the trunks
  const wispDefs: Array<{ c: THREE.Color; base: THREE.Vector3; r: THREE.Vector3; f: number; ph: number }> = [
    { c: PALETTE.aqua, base: new THREE.Vector3(-8.5, 1.5, -9), r: new THREE.Vector3(3.2, 0.5, 2.4), f: 0.11, ph: 0 },
    { c: PALETTE.violet, base: new THREE.Vector3(9, 1.8, -12), r: new THREE.Vector3(3.4, 0.6, 3), f: 0.09, ph: 2.1 },
    { c: new THREE.Color("#9fd8ff"), base: new THREE.Vector3(0.5, 2.4, -17), r: new THREE.Vector3(5, 0.7, 2.5), f: 0.07, ph: 4.2 },
    { c: PALETTE.aqua, base: new THREE.Vector3(-13.5, 1.3, -3.2), r: new THREE.Vector3(1.6, 0.4, 1.6), f: 0.13, ph: 1.2 },
  ];
  const wisps = wispDefs.map((d) => {
    const w = new THREE.Group();
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: d.c.clone().lerp(new THREE.Color("#ffffff"), 0.55).multiplyScalar(2.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    core.scale.setScalar(0.42);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: d.c.clone().multiplyScalar(0.55), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.scale.setScalar(2.4);
    w.add(halo, core);
    w.renderOrder = 21;
    group.add(w);
    return { w, d, core, halo };
  });

  const full = { fireflies: fireflies.count, spores: spores.count, grass: grass.count };
  return {
    group,
    budget: { ...full, leafCards: trees.leafCards, trees: trees.trees.length },
    update(t) {
      for (const { w, d, halo } of wisps) {
        const a = t * d.f * 6.283 + d.ph;
        w.position.set(d.base.x + Math.sin(a) * d.r.x + Math.sin(a * 2.3 + 1) * 0.5, 0, d.base.z + Math.cos(a * 0.83 + d.ph) * d.r.z);
        w.position.y = groundY(w.position.x, w.position.z) + d.base.y + Math.sin(a * 1.7) * d.r.y;
        halo.scale.setScalar(2.2 + Math.sin(t * 1.3 + d.ph) * 0.35);
      }
      shrooms.lights.forEach((l, i) => (l.intensity = 2.2 * (0.82 + 0.18 * Math.sin(t * 1.15 + i * 2.1))));
    },
    setQuality(level) {
      const k = level >= 2 ? 0.5 : 1;
      fireflies.points.geometry.setDrawRange(0, Math.round(full.fireflies * k));
      spores.points.geometry.setDrawRange(0, Math.round(full.spores * (level >= 2 ? 0.4 : 1)));
      grass.mesh.count = Math.round(full.grass * (level >= 2 ? 0.55 : 1));
      trees.leaves.count = level >= 2 ? Math.ceil(trees.leafCards / 2) : trees.leafCards;
      // the lightest level keeps every other shaft: they are big, blended, screen-filling surfaces
      let n = 0;
      for (const o of shafts.children) if (o.name === "light-shaft") o.visible = level < 2 || n++ % 2 === 0;
    },
    setPointScale(pixelsPerUnit) {
      fireflies.uniforms.uScale.value = pixelsPerUnit;
      spores.uniforms.uScale.value = pixelsPerUnit;
      (stars.material as THREE.ShaderMaterial).uniforms.uPx.value = Math.max(1, pixelsPerUnit / 1000);
    },
  };
}
