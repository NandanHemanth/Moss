// The grove's animals — the same six creatures Moss names its agents after. Each is built from smooth
// lofted shapes (no models are downloaded), glows softly like a spirit, follows a closed wandering path
// and always faces the way it is travelling. Leg and wing cycles are driven by the distance covered, so
// feet do not slide and nothing moonwalks.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FOX_PATH, OWL_PATH, RAVEN_PATH, SNAG, STAG_PATH, SWARM_PATH, TORTOISE_PATH, closedCurve } from "./layout";
import { glowPoints, PALETTE, type PointCloud } from "./environment";
import { canvasTexture, clamp, damp, groundY, lerp, loft, mulberry32, paint, smoothstep, spiritify } from "./util";

export interface Creature {
  name: string;
  root: THREE.Object3D;
  /** World position a camera should look at to see it. */
  focus: THREE.Vector3;
  /** Rough size in metres, for framing. */
  size: number;
  update(dt: number, t: number, camera: THREE.Vector3): void;
}

const TAU = Math.PI * 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const Z = new THREE.Vector3(0, 0, 1);
const col = (hex: string) => new THREE.Color(hex);

function spirit(glow: number, rim: string, rimStrength: number, rimPower = 2.4, side: THREE.Side = THREE.FrontSide) {
  return spiritify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side }), { glow, rim, rimStrength, rimPower });
}
const bright = (hex: string, k: number) => new THREE.MeshBasicMaterial({ color: col(hex).multiplyScalar(k) });

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function pivot(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Soft dark blob under a walker so it sits on the moss instead of floating. */
function contactShadow(tex: THREE.Texture, w: number, l: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  m.scale.set(w, 1, l);
  m.renderOrder = 3;
  return m;
}
function auraPool(tex: THREE.Texture, color: THREE.Color, size: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  m.scale.set(size, 1, size);
  m.renderOrder = 4;
  return m;
}

// ------------------------------------------------------------------ path following
class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  s = 0;
  readonly pos = new THREE.Vector3();
  readonly tan = new THREE.Vector3();
  constructor(points: THREE.Vector3[], start = 0) {
    this.curve = closedCurve(points);
    this.length = this.curve.getLength();
    this.s = start * this.length;
    this.sample();
  }
  private prev = 0;
  advance(ds: number) {
    this.prev = this.s;
    this.s = (this.s + ds) % this.length;
    this.sample();
  }
  private sample() {
    const u = clamp(this.s / this.length, 0, 0.999999);
    this.curve.getPointAt(u, this.pos);
    this.curve.getTangentAt(u, this.tan);
  }
  /** True when the last step passed the mark `u` (0..1 of the loop). */
  crossed(u: number): boolean {
    const mark = u * this.length;
    if (this.s === this.prev) return false;
    return this.prev <= this.s ? this.prev < mark && mark <= this.s : mark > this.prev || mark <= this.s;
  }
}

interface Leg { upper: THREE.Group; lower: THREE.Group; phase: number; hind: boolean }

function addLeg(parent: THREE.Object3D, mat: THREE.Material, at: [number, number, number], upperPts: number[][], lowerPts: number[][], phase: number, hind: boolean, paintU: (t: number, a: number, c: THREE.Color) => void, paintL: (t: number, a: number, c: THREE.Color) => void, radial = 8): Leg {
  const upper = pivot(parent, at[0], at[1], at[2]);
  mesh(upper, loft(upperPts, { radial, sub: 3, color: paintU }), mat);
  const knee = upperPts[upperPts.length - 1];
  const lower = pivot(upper, knee[0], knee[1], knee[2]);
  mesh(lower, loft(lowerPts, { radial, sub: 3, color: paintL }), mat);
  return { upper, lower, phase, hind };
}

/** Swing a leg: `phase` advances with distance; the knee folds while the foot travels forward. */
function swing(leg: Leg, phase: number, amp: number, knee: number, gait: number, restUpper = 0, restLower = 0) {
  const p = phase + leg.phase * TAU;
  const lift = Math.pow(Math.max(0, -Math.cos(p)), 1.4);
  leg.upper.rotation.x = restUpper + Math.sin(p) * amp * gait - lift * knee * 0.22 * gait;
  leg.lower.rotation.x = restLower + lift * knee * gait;
}

// ------------------------------------------------------------------ stag
function buildStag(glow: THREE.Texture): Creature {
  const SCALE = 1.05;
  const root = new THREE.Group();
  const rig = new THREE.Group();
  rig.scale.setScalar(SCALE);
  root.add(rig);
  const body = new THREE.Group();
  rig.add(body);

  const mat = spirit(0.3, "#cfeaff", 0.95, 2.0);
  const coat = col("#c6d2e6");
  const belly = col("#f6fbff");
  const shade = col("#9fb2cc");
  const hoof = col("#252a36");

  mesh(
    body,
    loft(
      [
        [0, 1.2, -0.76, 0.03, 0.03],
        [0, 1.25, -0.67, 0.16, 0.18],
        [0, 1.25, -0.44, 0.225, 0.265],
        [0, 1.2, -0.1, 0.212, 0.24],
        [0, 1.2, 0.22, 0.225, 0.268],
        [0, 1.23, 0.47, 0.212, 0.29],
        [0, 1.29, 0.64, 0.15, 0.22],
        [0, 1.34, 0.74, 0.05, 0.08],
      ],
      { radial: 14, sub: 3, color: (_t, a, c) => c.copy(coat).lerp(belly, smoothstep(0.2, -1.2, a) * 0.6).lerp(shade, smoothstep(0.9, 1.57, Math.abs(a)) * 0.12) },
    ),
    mat,
  );
  const tail = pivot(body, 0, 1.25, -0.72);
  mesh(tail, loft([[0, 0, 0, 0.03, 0.03], [0, -0.06, -0.06, 0.055, 0.04], [0, -0.17, -0.09, 0.04, 0.03], [0, -0.24, -0.09, 0.008, 0.008]], { radial: 7, color: (_t, _a, c) => c.copy(belly) }), mat);

  // neck and head
  const neck = pivot(body, 0, 1.27, 0.55);
  mesh(
    neck,
    loft(
      [
        [0, -0.1, -0.12, 0.15, 0.21],
        [0, 0.1, 0.05, 0.112, 0.16],
        [0, 0.34, 0.15, 0.082, 0.112],
        [0, 0.55, 0.21, 0.07, 0.088],
        [0, 0.63, 0.24, 0.05, 0.06],
      ],
      { radial: 12, sub: 3, color: (_t, a, c) => c.copy(coat).lerp(belly, smoothstep(0.3, -1.3, a) * 0.7) },
    ),
    mat,
  );
  const head = pivot(neck, 0, 0.6, 0.23);
  const ear = (side: number) => {
    const g = paint(new THREE.ConeGeometry(0.04, 0.17, 7), (p, _n, c) => c.copy(coat).lerp(col("#f2c9cf"), p.z > 0 ? 0.25 : 0));
    g.scale(1, 1, 0.42);
    g.translate(0, 0.085, 0);
    g.rotateZ(-side * 1.02);
    g.rotateY(side * 0.25);
    g.translate(side * 0.075, 0.062, -0.045);
    return g;
  };
  const skull = loft(
    [
      [0, 0.02, -0.11, 0.03, 0.03],
      [0, 0.035, -0.055, 0.075, 0.082],
      [0, 0.025, 0.04, 0.082, 0.092],
      [0, -0.015, 0.16, 0.06, 0.066],
      [0, -0.058, 0.28, 0.042, 0.045],
      [0, -0.078, 0.345, 0.034, 0.035],
      [0, -0.084, 0.37, 0.012, 0.012],
    ],
    { radial: 10, sub: 3, color: (t, _a, c) => c.copy(coat).lerp(col("#5d6880"), smoothstep(0.86, 1, t)) },
  );
  mesh(head, mergeGeometries([skull, ear(1), ear(-1)]), mat);
  const eyeGeo = mergeGeometries([new THREE.SphereGeometry(0.017, 8, 6).translate(0.068, 0.04, 0.085), new THREE.SphereGeometry(0.017, 8, 6).translate(-0.068, 0.04, 0.085)]);
  mesh(head, eyeGeo, bright("#9fe4ff", 2.2));

  // antlers: a main beam and four tines per side, glowing
  const beam = (pts: number[][], r0: number) => loft(pts.map((p, i) => [...p, r0 * (1 - (i / (pts.length - 1)) * 0.86), r0 * (1 - (i / (pts.length - 1)) * 0.86)]), { radial: 6, sub: 3, ref: Z });
  const antlerSide = (s: number) => [
    beam([[0.045 * s, 0.085, -0.03], [0.15 * s, 0.25, -0.12], [0.28 * s, 0.46, -0.17], [0.36 * s, 0.68, -0.1], [0.35 * s, 0.86, 0.05]], 0.026),
    beam([[0.07 * s, 0.13, -0.05], [0.11 * s, 0.2, 0.08], [0.13 * s, 0.31, 0.15]], 0.017),
    beam([[0.2 * s, 0.34, -0.15], [0.27 * s, 0.43, 0.0], [0.3 * s, 0.56, 0.07]], 0.017),
    beam([[0.32 * s, 0.56, -0.15], [0.44 * s, 0.67, -0.17], [0.5 * s, 0.82, -0.13]], 0.016),
    beam([[0.36 * s, 0.68, -0.1], [0.27 * s, 0.81, -0.17], [0.25 * s, 0.94, -0.15]], 0.015),
  ];
  const antlerGeo = mergeGeometries([...antlerSide(1), ...antlerSide(-1)]);
  const antlerMat = new THREE.MeshBasicMaterial({ color: col("#ffe6a6").multiplyScalar(2.3), side: THREE.DoubleSide });
  mesh(head, antlerGeo, antlerMat);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: col("#ffd98a").multiplyScalar(0.34), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  halo.scale.setScalar(1.7);
  halo.position.set(0, 0.5, -0.05);
  head.add(halo);

  // legs
  const legU = (_t: number, _a: number, c: THREE.Color) => c.copy(coat);
  const legL = (t: number, _a: number, c: THREE.Color) => c.copy(coat).lerp(shade, t * 0.7).lerp(hoof, smoothstep(0.84, 0.9, t));
  const frontU = [[0, 0.1, 0, 0.085, 0.125], [0, -0.14, 0.0, 0.074, 0.1], [0, -0.36, 0.01, 0.046, 0.058], [0, -0.47, 0.01, 0.04, 0.046]];
  const frontL = [[0, 0.03, 0, 0.04, 0.046], [0, -0.22, 0, 0.028, 0.032], [0, -0.44, 0, 0.028, 0.032], [0, -0.5, 0.012, 0.04, 0.05], [0, -0.55, 0.02, 0.042, 0.052]];
  const hindU = [[0, 0.12, 0, 0.1, 0.17], [0, -0.16, 0.05, 0.088, 0.135], [0, -0.42, -0.02, 0.048, 0.064], [0, -0.53, -0.085, 0.038, 0.046]];
  const hindL = [[0, 0.03, 0, 0.038, 0.046], [0, -0.22, 0.025, 0.028, 0.032], [0, -0.44, 0.05, 0.028, 0.032], [0, -0.49, 0.065, 0.04, 0.05], [0, -0.53, 0.075, 0.042, 0.052]];
  const legs: Leg[] = [
    addLeg(body, mat, [0.135, 1.02, 0.5], frontU, frontL, 0.25, false, legU, legL), // left front
    addLeg(body, mat, [-0.135, 1.02, 0.5], frontU, frontL, 0.75, false, legU, legL), // right front
    addLeg(body, mat, [0.135, 1.06, -0.5], hindU, hindL, 0.0, true, legU, legL), // left hind
    addLeg(body, mat, [-0.135, 1.06, -0.5], hindU, hindL, 0.5, true, legU, legL), // right hind
  ];

  const shadow = contactShadow(glow, 1.5, 3.0);
  const aura = auraPool(glow, col("#9fd0ff").multiplyScalar(0.16), 5.2);
  root.add(shadow, aura);
  shadow.position.y = aura.position.y = 0.05;

  const track = new Track(STAG_PATH, 0.065);
  const STRIDE = 4 * 1.03 * Math.sin(0.34) * SCALE;
  const WALK = 0.92;
  const stops = [0.14, 0.36, 0.69];
  let speed = WALK;
  let phase = 0;
  let pause = 0; // seconds left standing
  let pauseBlend = 0;
  let lookYaw = 0;
  const focus = new THREE.Vector3();

  return {
    name: "stag",
    root,
    focus,
    size: 2.6,
    update(dt, t, camera) {
      if (pause > 0) pause -= dt;
      speed = damp(speed, pause > 0 ? 0 : WALK, pause > 0 ? 1.6 : 1.1, dt);
      const ds = speed * dt;
      track.advance(ds);
      if (pause <= 0) for (const u of stops) if (track.crossed(u)) pause = 7.5 + ((u * 97) % 3);
      phase += (ds / STRIDE) * TAU;
      const gait = smoothstep(0.04, 0.6, speed / WALK);
      pauseBlend = damp(pauseBlend, pause > 0 && speed < 0.3 ? 1 : 0, 1.6, dt);

      root.position.set(track.pos.x, groundY(track.pos.x, track.pos.z), track.pos.z);
      const heading = Math.atan2(track.tan.x, track.tan.z);
      root.rotation.y = heading;

      body.position.y = Math.sin(phase * 2) * 0.012 * gait;
      body.rotation.z = Math.sin(phase) * 0.014 * gait;
      for (const leg of legs) swing(leg, phase, 0.34, leg.hind ? 0.75 : 0.95, gait, leg.hind ? 0.02 : 0);

      // while standing, the head comes up and turns towards the viewer, then scans the clearing
      const toCam = wrap(Math.atan2(camera.x - root.position.x, camera.z - root.position.z) - heading);
      const want = clamp(toCam, -1.25, 1.25) * pauseBlend + Math.sin(t * 0.45) * 0.22 * pauseBlend;
      lookYaw = damp(lookYaw, want, 1.5, dt);
      neck.rotation.x = lerp(0.3 + Math.sin(phase * 2 + 0.7) * 0.035 * gait, -0.1, pauseBlend);
      neck.rotation.y = lookYaw * 0.5;
      head.rotation.y = lookYaw * 0.5;
      head.rotation.x = lerp(0.12, 0.2, pauseBlend) + Math.sin(phase * 2 + 1.4) * 0.02 * gait;
      tail.rotation.x = Math.sin(t * 3.1) * 0.12 * (0.3 + 0.7 * pauseBlend);
      antlerMat.color.setRGB(2.5, 2.25, 1.6).multiplyScalar(0.85 + 0.15 * Math.sin(t * 0.9));
      focus.copy(root.position).setY(root.position.y + 1.35 * SCALE);
    },
  };
}

// ------------------------------------------------------------------ fox
function buildFox(glow: THREE.Texture): Creature {
  const SCALE = 1.42;
  const root = new THREE.Group();
  const rig = new THREE.Group();
  rig.scale.setScalar(SCALE);
  root.add(rig);

  const mat = spirit(0.48, "#ffc27a", 0.7, 2.2);
  const ember = col("#ff7a2b");
  const deep = col("#d9480f");
  const cream = col("#fff1dc");
  const sock = col("#2c1612");

  const HIP: [number, number, number] = [0, 0.37, -0.24];
  const hips = pivot(rig, ...HIP);
  const front = new THREE.Group();
  hips.add(front);
  const frontIn = pivot(front, -HIP[0], -HIP[1], -HIP[2]);
  const rearIn = pivot(hips, -HIP[0], -HIP[1], -HIP[2]);

  mesh(
    frontIn,
    loft(
      [
        [0, 0.4, -0.37, 0.02, 0.02],
        [0, 0.41, -0.31, 0.085, 0.098],
        [0, 0.41, -0.15, 0.105, 0.122],
        [0, 0.4, 0.05, 0.098, 0.112],
        [0, 0.41, 0.21, 0.105, 0.128],
        [0, 0.435, 0.33, 0.082, 0.104],
        [0, 0.455, 0.39, 0.035, 0.045],
      ],
      { radial: 12, sub: 3, color: (t, a, c) => c.copy(ember).lerp(deep, smoothstep(0.6, 1.57, a) * 0.35).lerp(cream, smoothstep(-0.5, -1.4, a) * (0.35 + 0.65 * t)) },
    ),
    mat,
  );

  const neck = pivot(frontIn, 0, 0.455, 0.33);
  mesh(neck, loft([[0, -0.05, -0.06, 0.072, 0.088], [0, 0.05, 0.04, 0.058, 0.068], [0, 0.12, 0.09, 0.052, 0.056]], { radial: 10, sub: 3, color: (_t, a, c) => c.copy(ember).lerp(cream, smoothstep(-0.2, -1.2, a)) }), mat);
  const head = pivot(neck, 0, 0.125, 0.1);
  const fear = (side: number) => {
    const g = paint(new THREE.ConeGeometry(0.04, 0.125, 5), (p, _n, c) => c.copy(ember).lerp(sock, smoothstep(0.0, 0.06, p.y)));
    g.scale(1, 1, 0.5);
    g.translate(0, 0.06, 0);
    g.rotateZ(-side * 0.22);
    g.translate(side * 0.043, 0.045, -0.03);
    return g;
  };
  const cheek = (side: number) => {
    const g = paint(new THREE.SphereGeometry(0.036, 8, 6), cream);
    g.scale(1.0, 0.72, 1.1);
    g.translate(side * 0.05, -0.022, 0.035);
    return g;
  };
  const fskull = loft(
    [
      [0, 0.0, -0.075, 0.02, 0.02],
      [0, 0.012, -0.04, 0.064, 0.06],
      [0, 0.006, 0.03, 0.07, 0.062],
      [0, -0.01, 0.09, 0.042, 0.04],
      [0, -0.024, 0.15, 0.024, 0.024],
      [0, -0.03, 0.19, 0.016, 0.016],
      [0, -0.03, 0.2, 0.006, 0.006],
    ],
    { radial: 10, sub: 3, color: (t, a, c) => c.copy(ember).lerp(cream, smoothstep(-0.1, -1.0, a) * 0.95).lerp(sock, smoothstep(0.9, 0.97, t)) },
  );
  mesh(head, mergeGeometries([fskull, fear(1), fear(-1), cheek(1), cheek(-1)]), mat);
  mesh(head, mergeGeometries([new THREE.SphereGeometry(0.0125, 8, 6).translate(0.04, 0.022, 0.065), new THREE.SphereGeometry(0.0125, 8, 6).translate(-0.04, 0.022, 0.065)]), bright("#fff3c4", 2.4));

  const tail = pivot(rearIn, 0, 0.41, -0.33);
  const tailTip = pivot(tail, 0, -0.045, -0.24);
  const tailPaint = (k0: number, k1: number) => (t: number, _a: number, c: THREE.Color) => c.copy(ember).lerp(deep, 0.25).lerp(cream, smoothstep(0.62, 0.8, lerp(k0, k1, t)));
  mesh(tail, loft([[0, 0, 0.02, 0.03, 0.03], [0, -0.012, -0.08, 0.062, 0.062], [0, -0.03, -0.17, 0.084, 0.084], [0, -0.045, -0.25, 0.09, 0.09]], { radial: 10, sub: 3, capEnd: false, color: tailPaint(0, 0.5) }), mat);
  mesh(tailTip, loft([[0, 0, -0.0, 0.09, 0.09], [0, -0.01, -0.1, 0.078, 0.078], [0, -0.016, -0.19, 0.045, 0.045], [0, -0.016, -0.235, 0.008, 0.008]], { radial: 10, sub: 3, capStart: false, color: tailPaint(0.5, 1) }), mat);

  const legU = (_t: number, _a: number, c: THREE.Color) => c.copy(ember);
  const legL = (t: number, _a: number, c: THREE.Color) => c.copy(ember).lerp(sock, smoothstep(0.0, 0.3, t));
  const fU = [[0, 0.045, 0, 0.042, 0.058], [0, -0.07, 0, 0.032, 0.04], [0, -0.17, 0, 0.021, 0.025]];
  const fL = [[0, 0.012, 0, 0.021, 0.025], [0, -0.1, 0, 0.016, 0.019], [0, -0.165, 0.004, 0.017, 0.021], [0, -0.184, 0.018, 0.022, 0.03], [0, -0.19, 0.03, 0.02, 0.028]];
  const hU = [[0, 0.05, 0, 0.052, 0.08], [0, -0.07, 0.03, 0.042, 0.062], [0, -0.17, -0.02, 0.023, 0.03]];
  const hL = [[0, 0.012, 0, 0.022, 0.027], [0, -0.1, 0.012, 0.016, 0.019], [0, -0.172, 0.022, 0.017, 0.021], [0, -0.194, 0.036, 0.022, 0.03], [0, -0.2, 0.048, 0.02, 0.028]];
  // trot: diagonal pairs move together
  const legs: Leg[] = [
    addLeg(frontIn, mat, [0.066, 0.36, 0.24], fU, fL, 0.0, false, legU, legL),
    addLeg(frontIn, mat, [-0.066, 0.36, 0.24], fU, fL, 0.5, false, legU, legL),
    addLeg(rearIn, mat, [0.07, 0.37, -0.24], hU, hL, 0.5, true, legU, legL),
    addLeg(rearIn, mat, [-0.07, 0.37, -0.24], hU, hL, 0.0, true, legU, legL),
  ];

  const shadow = contactShadow(glow, 0.85, 1.9);
  const aura = auraPool(glow, col("#ff8a3c").multiplyScalar(0.2), 3.4);
  root.add(shadow, aura);
  shadow.position.y = aura.position.y = 0.05;

  const track = new Track(FOX_PATH, 0.155);
  const STRIDE = 4 * 0.36 * Math.sin(0.5) * SCALE;
  const TROT = 1.75;
  const sitMarks = [0.275, 0.115];
  let speed = TROT;
  let phase = 0;
  let mode: "trot" | "stop" | "sit" | "rise" = "trot";
  let timer = 0;
  let sit = 0;
  let lookYaw = 0;
  let visit = 0;
  const focus = new THREE.Vector3();

  return {
    name: "fox",
    root,
    focus,
    size: 1.5,
    update(dt, t, camera) {
      const target = mode === "trot" ? TROT : 0;
      speed = damp(speed, target, mode === "trot" ? 1.4 : 2.4, dt);
      const ds = speed * dt;
      track.advance(ds);
      if (mode === "trot") {
        // skips every third mark, so it sits sometimes rather than always
        for (const u of sitMarks) if (track.crossed(u) && visit++ % 3 !== 1) mode = "stop";
      } else if (mode === "stop" && speed < 0.08) {
        mode = "sit";
        timer = 8.5;
      } else if (mode === "sit") {
        timer -= dt;
        if (timer <= 0) mode = "rise";
      } else if (mode === "rise" && sit < 0.06) mode = "trot";
      // ease in and out of the sit (smootherstep on a linear timer keeps it free of pops)
      sit = clamp(sit + (mode === "sit" ? dt / 1.1 : mode === "trot" || mode === "rise" ? -dt / 0.9 : 0), 0, 1);
      const s = sit * sit * (3 - 2 * sit);
      phase += (ds / STRIDE) * TAU;
      const gait = smoothstep(0.04, 0.5, speed / TROT);

      root.position.set(track.pos.x, groundY(track.pos.x, track.pos.z), track.pos.z);
      const heading = Math.atan2(track.tan.x, track.tan.z);
      root.rotation.y = heading;

      hips.position.y = HIP[1] - 0.27 * s + Math.abs(Math.sin(phase)) * 0.018 * gait;
      front.rotation.x = -0.62 * s + Math.sin(phase * 2) * 0.02 * gait;
      for (const leg of legs) {
        if (leg.hind) {
          // haunches fold up beside the body, paws tucked under
          swing(leg, phase, 0.5, 0.95, gait, -2.0 * s, 1.45 * s);
          leg.upper.rotation.z = Math.sign(leg.upper.position.x) * 0.28 * s;
        } else swing(leg, phase, 0.5, 1.05, gait, 0.62 * s, 0);
      }
      const toCam = wrap(Math.atan2(camera.x - root.position.x, camera.z - root.position.z) - heading);
      lookYaw = damp(lookYaw, (clamp(toCam, -1.3, 1.3) + Math.sin(t * 0.7) * 0.25) * s, 2, dt);
      neck.rotation.x = 0.16 + 0.42 * s + Math.sin(phase * 2 + 0.5) * 0.03 * gait;
      neck.rotation.y = lookYaw * 0.55;
      head.rotation.y = lookYaw * 0.45;
      head.rotation.x = 0.1 - 0.05 * s;
      // the brush streams behind at a trot and curls round the paws when sitting
      tail.rotation.x = -0.1 + 0.3 * s + Math.sin(phase * 2) * 0.05 * gait;
      tail.rotation.y = Math.sin(phase + 0.6) * 0.13 * gait + 0.75 * s + Math.sin(t * 1.3) * 0.06 * s;
      tailTip.rotation.y = Math.sin(phase - 0.4) * 0.2 * gait + 0.85 * s + Math.sin(t * 1.3 - 0.8) * 0.12 * s;
      tailTip.rotation.x = -0.12 * gait;
      focus.copy(root.position).setY(root.position.y + 0.42 * SCALE);
    },
  };
}

// ------------------------------------------------------------------ tortoise
function buildTortoise(glow: THREE.Texture): Creature {
  const SCALE = 1.15;
  const root = new THREE.Group();
  const rig = new THREE.Group();
  rig.scale.setScalar(SCALE);
  root.add(rig);
  const body = pivot(rig, 0, 0, 0);

  // shell with softly glowing scute lines; drawn onto a small canvas, used as colour and as emission
  const drawScutes = (ctx: CanvasRenderingContext2D, w: number, lines: string, fill: (v: number) => string) => {
    const h = 128;
    const rows: Array<[number, number, number, number]> = [
      // v0, v1, cells, offset — v runs from the rim (0) to the top of the dome (1)
      [0.0, 0.3, 22, 0],
      [0.3, 0.64, 9, 0],
      [0.64, 0.88, 5, 0.5],
      [0.88, 1.0, 1, 0],
    ];
    for (const [v0, v1] of rows) {
      ctx.fillStyle = fill((v0 + v1) / 2);
      ctx.fillRect(0, (1 - v1) * h, w, (v1 - v0) * h);
    }
    ctx.strokeStyle = lines;
    ctx.lineWidth = 3.2;
    ctx.lineJoin = "round";
    for (const [v0, v1, cells, off] of rows) {
      const y0 = (1 - v0) * h;
      const y1 = (1 - v1) * h;
      ctx.beginPath();
      ctx.moveTo(0, y1);
      ctx.lineTo(w, y1);
      ctx.stroke();
      if (cells < 2) continue;
      for (let i = 0; i <= cells; i++) {
        const x = ((i + off) / cells) * w;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
      }
    }
  };
  const shellMap = canvasTexture(256, (ctx, w) => drawScutes(ctx, w, "#9fe08a", (v) => `rgb(${Math.round(40 + v * 30)},${Math.round(74 + v * 34)},${Math.round(44 + v * 10)})`), 128);
  const shellGlow = canvasTexture(
    256,
    (ctx, w) => {
      ctx.fillStyle = "#061006";
      ctx.fillRect(0, 0, w, 128);
      ctx.shadowColor = "#9dff9a";
      ctx.shadowBlur = 7;
      drawScutes(ctx, w, "#c9ffb8", () => "rgba(12,30,14,1)");
    },
    128,
  );
  const shellGeo = new THREE.LatheGeometry(
    [[0.88, -0.05], [1.0, -0.01], [0.97, 0.06], [0.84, 0.15], [0.6, 0.235], [0.3, 0.29], [0.001, 0.305]].map(([x, y]) => new THREE.Vector2(x, y)),
    20,
  );
  shellGeo.scale(0.33, 1, 0.42);
  const shellMat = new THREE.MeshStandardMaterial({ map: shellMap, emissiveMap: shellGlow, emissive: col("#8dff9a"), emissiveIntensity: 1.1, roughness: 0.7, side: THREE.DoubleSide });
  mesh(body, shellGeo, shellMat, 0, 0.19, 0);

  const skinMat = spirit(0.5, "#b7ffb0", 0.5, 2.2);
  const skin = col("#6e9455");
  const skinDark = col("#3d5a36");
  const under = paint(new THREE.SphereGeometry(1, 14, 8), col("#55733f"));
  under.scale(0.29, 0.085, 0.37);
  mesh(body, under, skinMat, 0, 0.165, 0);

  const neck = pivot(body, 0, 0.175, 0.33);
  mesh(
    neck,
    loft([[0, -0.01, -0.08, 0.05, 0.045], [0, 0.03, 0.05, 0.044, 0.042], [0, 0.075, 0.13, 0.04, 0.04], [0, 0.095, 0.185, 0.056, 0.05], [0, 0.09, 0.25, 0.046, 0.04], [0, 0.082, 0.285, 0.02, 0.018]], {
      radial: 9,
      sub: 3,
      color: (t, _a, c) => c.copy(skinDark).lerp(skin, t),
    }),
    skinMat,
  );
  mesh(neck, mergeGeometries([new THREE.SphereGeometry(0.012, 8, 6).translate(0.04, 0.115, 0.215), new THREE.SphereGeometry(0.012, 8, 6).translate(-0.04, 0.115, 0.215)]), bright("#eaffb0", 2.2));
  const tail = pivot(body, 0, 0.17, -0.4);
  mesh(tail, loft([[0, 0, 0.04, 0.03, 0.03], [0, -0.03, -0.06, 0.012, 0.012]], { radial: 6, color: (_t, _a, c) => c.copy(skinDark) }), skinMat);

  const legPts = (side: number) => [[0, 0.03, 0, 0.062, 0.062], [side * 0.035, -0.06, 0, 0.056, 0.058], [side * 0.05, -0.135, 0.005, 0.052, 0.06], [side * 0.05, -0.165, 0.012, 0.03, 0.036]];
  const legPaint = (t: number, _a: number, c: THREE.Color) => c.copy(skin).lerp(skinDark, t * 0.8);
  const legs = ([[0.2, 0.25, 0.0], [-0.2, 0.25, 0.5], [0.2, -0.25, 0.5], [-0.2, -0.25, 0.0]] as const).map(([x, z, ph]) => {
    const p = pivot(body, x, 0.165, z);
    mesh(p, loft(legPts(Math.sign(x)), { radial: 8, sub: 3, color: legPaint }), skinMat);
    return { p, ph };
  });

  const shadow = contactShadow(glow, 1.25, 1.5);
  const aura = auraPool(glow, col("#7dff9a").multiplyScalar(0.2), 2.8);
  root.add(shadow, aura);
  shadow.position.y = aura.position.y = 0.04;

  const track = new Track(TORTOISE_PATH, 0.2);
  const SPEED = 0.085;
  const STRIDE = 0.22 * SCALE;
  let phase = 0;
  let speed = SPEED;
  let rest = 0;
  let next = 16;
  const focus = new THREE.Vector3();

  return {
    name: "tortoise",
    root,
    focus,
    size: 1.1,
    update(dt, t) {
      // creeps, and every so often stops to look about
      next -= dt;
      if (next <= 0) {
        rest = 5;
        next = 24;
      }
      if (rest > 0) rest -= dt;
      speed = damp(speed, rest > 0 ? 0 : SPEED, 1.5, dt);
      const ds = speed * dt;
      track.advance(ds);
      phase += (ds / STRIDE) * TAU;
      const gait = smoothstep(0.05, 0.7, speed / SPEED);
      const looking = 1 - gait;

      root.position.set(track.pos.x, groundY(track.pos.x, track.pos.z), track.pos.z);
      root.rotation.y = Math.atan2(track.tan.x, track.tan.z);
      body.rotation.z = Math.sin(phase) * 0.035 * gait;
      body.position.y = Math.sin(phase * 2) * 0.006 * gait;
      for (const { p, ph } of legs) {
        const a = phase + ph * TAU;
        p.rotation.x = Math.sin(a) * 0.42 * gait;
        p.position.y = 0.165 + Math.max(0, -Math.cos(a)) * 0.022 * gait;
      }
      neck.rotation.x = -0.05 - 0.28 * looking + Math.sin(phase * 2) * 0.03 * gait;
      neck.rotation.y = Math.sin(phase) * 0.07 * gait + Math.sin(t * 0.6) * 0.5 * looking;
      tail.rotation.y = Math.sin(phase) * 0.3 * gait;
      shellMat.emissiveIntensity = 1.05 + 0.4 * Math.sin(t * 0.8);
      focus.copy(root.position).setY(root.position.y + 0.25 * SCALE);
    },
  };
}

// ------------------------------------------------------------------ birds
interface WingSpec {
  span: number;
  chord0: number;
  chord1: number;
  cols: number;
  /** How deep the gaps between tip feathers are (0 = smooth, rounded wing). */
  fingers: number;
  sweep: number;
  round: number;
  lead: THREE.Color;
  trail: THREE.Color;
  bars: number;
}

/** A flat, slightly cambered wing panel in the XZ plane, spanning from x = 0 towards `side`. */
function wingPanel(side: number, w: WingSpec, tip: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const colr: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i <= w.cols; i++) {
    const u = i / w.cols;
    const rounding = tip ? Math.sqrt(Math.max(0.02, 1 - Math.pow(Math.max(0, (u - (1 - w.round)) / w.round), 2))) : 1;
    const chord = lerp(w.chord0, w.chord1, u) * rounding;
    const le = w.chord0 * 0.36 - w.sweep * u * u - (tip ? (1 - rounding) * w.chord1 * 0.35 : 0);
    // scalloped trailing edge: every other column is a feather tip
    const notch = i % 2 === 0 ? 0 : 1;
    const depth = tip ? lerp(0.1, w.fingers, smoothstep(0.35, 1, u)) : 0.08;
    const te = le - chord * (1 - depth * (1 - notch));
    const x = side * u * w.span;
    pos.push(x, 0, le, x, chord * 0.07, lerp(le, te, 0.42), x, 0, te);
    for (const k of [0, 0.42, 1]) {
      c.copy(w.lead).lerp(w.trail, k);
      if (w.bars > 0) c.multiplyScalar(0.8 + 0.2 * Math.sin(k * w.bars * 6.283 + u * 2));
      colr.push(c.r, c.g, c.b);
    }
    if (i < w.cols) {
      const a = i * 3;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tailFan(len: number, spread: number, feathers: number, a: THREE.Color, b: THREE.Color, wedge: number): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const colr: number[] = [a.r, a.g, a.b];
  const idx: number[] = [];
  const n = feathers * 2;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const ang = (u - 0.5) * spread;
    const r = len * (1 - wedge * Math.abs(u - 0.5) * 2) * (i % 2 === 0 ? 0.9 : 1);
    pos.push(Math.sin(ang) * r, 0, -Math.cos(ang) * r);
    colr.push(b.r, b.g, b.b);
    if (i < n) idx.push(0, i + 1, i + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface BirdRig {
  root: THREE.Group;
  /** Pitches the whole bird upright when perched. */
  tilt: THREE.Group;
  head: THREE.Group;
  wings: Array<{ side: number; inner: THREE.Group; outer: THREE.Group }>;
  tail: THREE.Object3D;
}

function birdRig(kind: "owl" | "raven", scale: number): BirdRig {
  const owl = kind === "owl";
  const root = new THREE.Group();
  root.rotation.order = "YXZ";
  const rig = new THREE.Group();
  rig.scale.setScalar(scale);
  root.add(rig);
  const tilt = new THREE.Group();
  rig.add(tilt);

  const mat = owl ? spirit(0.55, "#d9c8ff", 0.7, 2.2, THREE.DoubleSide) : spirit(0.75, "#8ea2ff", 0.85, 2.6, THREE.DoubleSide);
  const base = owl ? col("#d8cdea") : col("#1a2050");
  const dark = owl ? col("#8d7bb8") : col("#0a0d26");
  const pale = owl ? col("#fbf6ff") : col("#2a3478");

  const bodyPts = owl
    ? [[0, 0, -0.21, 0.02, 0.02], [0, 0, -0.15, 0.092, 0.086], [0, 0, -0.02, 0.128, 0.122], [0, 0.012, 0.1, 0.122, 0.118], [0, 0.022, 0.18, 0.09, 0.09]]
    : [[0, 0, -0.21, 0.015, 0.015], [0, 0, -0.14, 0.058, 0.056], [0, 0, 0.0, 0.086, 0.084], [0, 0.012, 0.12, 0.076, 0.076], [0, 0.024, 0.21, 0.05, 0.05]];
  mesh(
    tilt,
    loft(bodyPts, {
      radial: 12,
      sub: 3,
      color: (t, a, c) => c.copy(base).lerp(pale, smoothstep(0.0, -1.3, a) * (owl ? 0.7 : 0.25)).multiplyScalar(owl ? 0.9 + 0.1 * Math.sin(t * 40 + a * 3) : 1),
    }),
    mat,
  );

  const head = pivot(tilt, 0, owl ? 0.045 : 0.04, owl ? 0.215 : 0.255);
  if (owl) {
    const parts: THREE.BufferGeometry[] = [];
    const sk = paint(new THREE.SphereGeometry(0.118, 16, 12), (p, _n, c) => c.copy(base).lerp(dark, smoothstep(0.02, 0.1, p.y) * 0.5));
    sk.scale(1.12, 0.96, 0.95);
    parts.push(sk);
    for (const s of [1, -1]) {
      const disc = paint(new THREE.SphereGeometry(0.062, 14, 8), (p, _n, c) => c.copy(pale).lerp(dark, smoothstep(0.045, 0.062, Math.hypot(p.x, p.y)) * 0.6));
      disc.scale(1, 1.05, 0.3);
      disc.translate(s * 0.053, 0.008, 0.09);
      parts.push(disc);
      const tuft = paint(new THREE.ConeGeometry(0.03, 0.1, 5), dark);
      tuft.scale(1, 1, 0.5);
      tuft.translate(0, 0.05, 0);
      tuft.rotateZ(-s * 0.5);
      tuft.translate(s * 0.075, 0.085, 0.0);
      parts.push(tuft);
    }
    mesh(head, mergeGeometries(parts), mat);
    const eyes = [1, -1].map((s) => new THREE.SphereGeometry(0.027, 10, 8).translate(s * 0.053, 0.012, 0.102));
    mesh(head, mergeGeometries(eyes), bright("#ffc44a", 2.3));
    const pupils = [1, -1].map((s) => new THREE.SphereGeometry(0.013, 8, 6).translate(s * 0.053, 0.012, 0.124));
    const beak = new THREE.ConeGeometry(0.016, 0.045, 6);
    beak.rotateX(2.6);
    beak.translate(0, -0.025, 0.118);
    mesh(head, mergeGeometries([...pupils, beak]), new THREE.MeshBasicMaterial({ color: "#1a1326" }));
  } else {
    const sk = paint(new THREE.SphereGeometry(0.062, 12, 10), base);
    sk.scale(0.95, 0.95, 1.12);
    const beak = paint(new THREE.ConeGeometry(0.03, 0.17, 7), dark);
    beak.rotateX(Math.PI / 2 + 0.12);
    beak.scale(0.8, 1, 1);
    beak.translate(0, -0.012, 0.13);
    const throat = paint(new THREE.SphereGeometry(0.04, 8, 6), base);
    throat.translate(0, -0.04, 0.0);
    mesh(head, mergeGeometries([sk, beak, throat]), mat);
    mesh(head, mergeGeometries([1, -1].map((s) => new THREE.SphereGeometry(0.011, 8, 6).translate(s * 0.046, 0.016, 0.04))), bright("#dfe8ff", 2.6));
  }

  const spec: WingSpec = owl
    ? { span: 0.31, chord0: 0.29, chord1: 0.28, cols: 8, fingers: 0.2, sweep: 0.02, round: 0.5, lead: base, trail: dark, bars: 3 }
    : { span: 0.27, chord0: 0.2, chord1: 0.2, cols: 8, fingers: 0.5, sweep: 0.03, round: 0.4, lead: pale, trail: base, bars: 0 };
  const tipSpec: WingSpec = owl ? { ...spec, span: 0.4, chord0: 0.28, chord1: 0.17, cols: 12, sweep: 0.06 } : { ...spec, span: 0.43, chord0: 0.2, chord1: 0.13, cols: 12, sweep: 0.13 };
  const wings = [1, -1].map((side) => {
    const inner = pivot(tilt, side * (owl ? 0.085 : 0.06), owl ? 0.045 : 0.035, owl ? 0.06 : 0.07);
    inner.rotation.order = "ZYX";
    mesh(inner, wingPanel(side, spec, false), mat);
    const outer = pivot(inner, side * spec.span, 0, 0);
    outer.rotation.order = "ZYX";
    mesh(outer, wingPanel(side, tipSpec, true), mat);
    return { side, inner, outer };
  });
  const tail = mesh(tilt, owl ? tailFan(0.2, 1.05, 6, base, dark, 0.0) : tailFan(0.26, 0.75, 6, base, dark, 0.3), mat, 0, 0.0, -0.14);
  // feet tucked under the body, visible when perched
  if (owl) {
    const feet = mergeGeometries([1, -1].map((s) => new THREE.SphereGeometry(0.022, 6, 5).translate(s * 0.045, -0.105, -0.12)));
    mesh(tilt, feet, new THREE.MeshBasicMaterial({ color: col("#caa15a").multiplyScalar(0.8) }));
  }
  return { root, tilt, head, wings, tail };
}

/** Wing pose: `flap` -1..1 through the beat, `fold` 0 (spread) .. 1 (closed against the body). */
function poseWings(rig: BirdRig, beat: number, amp: number, fold: number, dihedral: number) {
  for (const w of rig.wings) {
    const up = Math.sin(beat) * amp + dihedral;
    const lag = Math.sin(beat - 0.9) * amp * 0.85 - 0.12;
    const sweepBack = Math.max(0, Math.cos(beat)) * 0.3 * amp; // the hand sweeps back on the upstroke
    // folded: the wing swings back along the flank (yaw), then hangs down beside it (roll about the body axis)
    w.inner.rotation.z = w.side * lerp(up, -1.15, fold);
    w.inner.rotation.y = w.side * lerp(0, 1.42, fold);
    w.inner.scale.x = lerp(1, 0.66, fold);
    w.outer.rotation.z = w.side * lerp(lag, 0, fold);
    w.outer.rotation.y = w.side * lerp(sweepBack, 0.12, fold);
  }
}

function buildOwl(): Creature {
  const SCALE = 1.5;
  const rig = birdRig("owl", SCALE);
  const perchY = groundY(SNAG.x, SNAG.z) + 1.22 + 0.19 * SCALE;
  const pts = OWL_PATH.map((p) => p.clone());
  pts[0].y = perchY;
  const track = new Track(pts, 0);
  const FAST = 5.6;
  let speed = 0;
  let beat = 0;
  let perched = 6; // seconds left on the branch (it starts there)
  let fold = 1;
  let prevHeading = Math.atan2(track.tan.x, track.tan.z);
  let roll = 0;
  let headYaw = 0;
  const focus = new THREE.Vector3();

  return {
    name: "owl",
    root: rig.root,
    focus,
    size: 1.6,
    update(dt, t, camera) {
      const L = track.length;
      const toPerch = Math.min(track.s, L - track.s);
      if (perched > 0) {
        perched -= dt;
        speed = 0;
        if (perched <= 0) track.s = 0.02;
      } else {
        const want = FAST * clamp(toPerch / 7 + 0.09, 0, 1);
        speed = damp(speed, want, 4, dt);
        const before = track.s;
        track.advance(speed * dt);
        if (track.s < before) {
          // completed the loop: settle on the branch
          track.s = 0;
          track.advance(0);
          perched = 10;
          speed = 0;
        }
      }
      const near = perched > 0 ? 0 : Math.min(track.s, L - track.s);
      const foldTarget = perched > 0 ? 1 : 0;
      fold = clamp(fold + (foldTarget > fold ? dt / 0.7 : -dt / 0.5), 0, 1);
      const f = fold * fold * (3 - 2 * fold);
      const upright = Math.max(f, 1 - smoothstep(0.3, 3.4, near)); // flares upright as it lands or takes off

      rig.root.position.copy(track.pos);
      const heading = Math.atan2(track.tan.x, track.tan.z);
      const turn = dt > 0 ? wrap(heading - prevHeading) / dt : 0;
      prevHeading = heading;
      roll = damp(roll, clamp(-turn * 0.55, -0.6, 0.6) * (1 - upright), 2.5, dt);
      rig.root.rotation.set(-Math.asin(clamp(track.tan.y, -1, 1)) * 0.6 * (1 - upright), heading, roll);

      // slow, deep beats with glides in between; hard braking beats close to the branch
      const cruise = 0.5 + 0.5 * Math.sin(t * 0.42 + 1.0);
      const effort = Math.max(smoothstep(0.35, 0.65, cruise), 1 - smoothstep(2, 9, near));
      const rate = lerp(1.25, 2.1, 1 - smoothstep(1, 6, near));
      beat += dt * TAU * rate * (perched > 0 ? 0 : 1);
      poseWings(rig, beat, lerp(0.16, 0.62, effort), f, lerp(0.14, 0.05, effort));
      rig.tilt.rotation.x = -1.12 * upright - 0.06;
      rig.tilt.position.y = -Math.sin(beat) * 0.02 * effort * (1 - f);
      rig.tail.rotation.x = 0.5 * upright * (1 - f) + 0.15 * f;

      // perched: keeps its face to the viewer and looks about
      const toCam = wrap(Math.atan2(camera.x - rig.root.position.x, camera.z - rig.root.position.z) - heading);
      headYaw = damp(headYaw, (clamp(toCam, -1.4, 1.4) + Math.sin(t * 0.8) * 0.45) * f, 2.2, dt);
      // default XYZ order: the yaw happens in the head's own (already levelled) frame
      rig.head.rotation.set(1.04 * upright, headYaw, 0);
      focus.copy(rig.root.position);
    },
  };
}

function buildRaven(): Creature {
  const SCALE = 1.7;
  const rig = birdRig("raven", SCALE);
  const track = new Track(RAVEN_PATH, 0.65);
  const SPEED = 7.2;
  let beat = 0;
  let prevHeading = Math.atan2(track.tan.x, track.tan.z);
  let roll = 0;
  const focus = new THREE.Vector3();
  return {
    name: "raven",
    root: rig.root,
    focus,
    size: 1.6,
    update(dt, t) {
      track.advance(SPEED * dt);
      rig.root.position.copy(track.pos);
      const heading = Math.atan2(track.tan.x, track.tan.z);
      const turn = dt > 0 ? wrap(heading - prevHeading) / dt : 0;
      prevHeading = heading;
      roll = damp(roll, clamp(-turn * 0.6, -0.7, 0.7), 2.5, dt);
      rig.root.rotation.set(-Math.asin(clamp(track.tan.y, -1, 1)) * 0.7, heading, roll);
      // quick beats in bursts, short glides between them
      const effort = smoothstep(0.25, 0.5, 0.5 + 0.5 * Math.sin(t * 0.8 + 0.4));
      beat += dt * TAU * lerp(2.2, 3.3, effort);
      poseWings(rig, beat, lerp(0.12, 0.7, effort), 0, lerp(0.16, 0.02, effort));
      rig.tilt.position.y = -Math.sin(beat) * 0.022 * effort;
      rig.tilt.rotation.x = -0.05;
      rig.head.rotation.x = 0.08;
      focus.copy(rig.root.position);
    },
  };
}

// ------------------------------------------------------------------ firefly swarm
function buildSwarm(time: { value: number }): Creature & { cloud: PointCloud } {
  const rng = mulberry32(77);
  const cloud = glowPoints(
    46,
    time,
    (i, p, c) => {
      const a = rng() * TAU;
      const r = Math.pow(rng(), 0.6) * 1.25;
      p.set(Math.cos(a) * r, (rng() - 0.5) * 1.1, Math.sin(a) * r);
      c.copy(i % 4 === 0 ? col("#d7ff9a") : PALETTE.gold);
      return 0.15 + rng() * 0.1;
    },
    { amp: [0.5, 0.32, 0.5], blink: 0.75, speed: 1.5, brightness: 1.35 },
    rng,
  );
  const track = new Track(SWARM_PATH, 0.1);
  const focus = new THREE.Vector3();
  return {
    name: "fireflies",
    root: cloud.points,
    cloud,
    focus,
    size: 3,
    update(dt, t) {
      track.advance(0.42 * dt * (0.7 + 0.3 * Math.sin(t * 0.3)));
      cloud.uniforms.uCenter.value.set(track.pos.x, groundY(track.pos.x, track.pos.z) + track.pos.y + Math.sin(t * 0.5) * 0.25, track.pos.z);
      focus.copy(cloud.uniforms.uCenter.value);
    },
  };
}

export interface Menagerie {
  group: THREE.Group;
  list: Creature[];
  swarm: PointCloud;
  update(dt: number, t: number, camera: THREE.Vector3): void;
}

export function buildCreatures(time: { value: number }, glow: THREE.Texture): Menagerie {
  const group = new THREE.Group();
  const swarm = buildSwarm(time);
  const list: Creature[] = [buildStag(glow), buildFox(glow), buildTortoise(glow), buildOwl(), buildRaven(), swarm];
  for (const c of list) group.add(c.root);
  return {
    group,
    list,
    swarm: swarm.cloud,
    update(dt, t, camera) {
      for (const c of list) c.update(dt, t, camera);
    },
  };
}
