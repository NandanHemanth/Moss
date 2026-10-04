// Where things are in the grove (world units are metres; the camera sits at z = +10 looking down -Z).
// Kept in one place so trees never grow on a path an animal walks, and so the scene can be re-staged
// without touching geometry or animation code.
import * as THREE from "three";
import { POND } from "./util";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Camera rest position (`eye` is its height above the clearing floor). */
export const CAMERA = { x: 0, eye: 1.0, z: 12.5, targetZ: -14 };

/** Vertical framing: visible tan-span of the viewport and where the horizon sits (fraction from the bottom). */
export const FRAMING = { span: 0.86, horizon: 0.115 };

/** Direction towards the moon (it backlights the clearing from the upper right). */
export const MOON_DIR = v(0.2, 0.56, -1).normalize();
/** Direction the visible light shafts come from: steeper than the moon so they cross the open clearing. */
export const SHAFT_DIR = v(0.5, 1, -0.42).normalize();

/** Dead snag the owl perches on, and the point where the owl's body rests. */
export const SNAG = { x: 3.9, z: -5.0 };
export const OWL_PERCH = v(SNAG.x - 0.98, 1.44, SNAG.z + 0.15);

/** Stones around the pond: [x, z, size]. */
export const POND_RIM: Array<[number, number, number]> = [0.3, 1.1, 1.75, 2.5, 3.3, 4.0, 4.7, 5.5].map((a, i) => [
  POND.x + Math.cos(a) * POND.rx * 1.12,
  POND.z + Math.sin(a) * POND.rz * 1.12,
  0.22 + ((i * 37) % 10) * 0.035,
]);

export const LOG = { x: -8.6, z: -8.6, rot: 0.2, length: 4.4, radius: 0.4 };
export const STONES = { x: -1.6, z: -1.0 };

/** Ground loops (y is ignored; walkers take their height from the terrain). */
export const STAG_PATH = [
  v(-18, 0, -7.2), v(-10, 0, -6.4), v(-3, 0, -6.1), v(2.6, 0, -6.8), v(7.5, 0, -8.9), v(13, 0, -8.8), v(17.5, 0, -10.5),
  v(17.5, 0, -13.5), v(12, 0, -14.8), v(2, 0, -15), v(-8, 0, -14.6), v(-16.5, 0, -13.2), v(-20, 0, -10),
];
export const FOX_PATH = [
  v(-16, 0, -3.0), v(-8, 0, -3.5), v(-1, 0, -3.2), v(5, 0, -3.3), v(12.5, 0, -3.4), v(16.5, 0, -6.2),
  v(14, 0, -10.2), v(6, 0, -11.4), v(-3, 0, -11), v(-11, 0, -10.8), v(-16.5, 0, -7.6),
];
export const TORTOISE_PATH = [
  v(-3.5, 0, -0.50), v(-2.4, 0, 0.10), v(-0.9, 0, 0.05), v(0.3, 0, -0.60), v(0.2, 0, -1.60), v(-1.2, 0, -2.15), v(-2.8, 0, -1.90), v(-3.7, 0, -1.30),
];

/** Flight loops. The owl's first point is its perch. */
export const OWL_PATH = [
  OWL_PERCH, v(0.6, 2.0, -3.6), v(-3.4, 3.4, -4.0), v(-8.5, 5.4, -5.5), v(-15.5, 7.6, -7), v(-22, 9.5, -17),
  v(-14, 11, -31), v(0, 11.5, -37), v(14, 10.5, -31), v(17.5, 8.4, -20), v(12.5, 6.2, -13.5), v(8.2, 3.9, -9.6), v(5.0, 2.15, -6.6),
];
export const RAVEN_PATH = [
  v(17, 9.0, -8), v(8, 8.4, -6), v(0, 9.2, -7.5), v(-8, 8.2, -9), v(-17, 9.5, -8), v(-25, 11, -15),
  v(-20, 12.5, -31), v(-3, 13, -41), v(15, 12.5, -35), v(25, 11, -21), v(23, 9.6, -12),
];
/** Centre of the roaming firefly swarm. */
export const SWARM_PATH = [v(-6, 1.3, -3.5), v(-1.5, 1.9, -5.5), v(3.5, 1.2, -4.2), v(8, 1.6, -7.5), v(3, 2.4, -11), v(-4, 1.5, -9.5), v(-9, 1.1, -6.5)];

export const closedCurve = (pts: THREE.Vector3[], tension = 0.5): THREE.CatmullRomCurve3 => {
  const c = new THREE.CatmullRomCurve3(pts, true, "catmullrom", tension);
  c.arcLengthDivisions = 600;
  return c;
};

/** Points no tree trunk may stand near: every walking lane and the low part of the flight lanes. */
export function keepClear(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const path of [STAG_PATH, FOX_PATH, TORTOISE_PATH]) out.push(...closedCurve(path).getSpacedPoints(90));
  for (const path of [OWL_PATH, RAVEN_PATH]) out.push(...closedCurve(path).getSpacedPoints(90).filter((p) => p.z > -24));
  return out;
}
