import * as THREE from 'three';

/**
 * Motion-sensor hold.
 *
 * When ARCore pauses camera tracking (blank wall, too close, low light),
 * WebXR stops giving a viewer pose and Three.js keeps rendering with the
 * last camera. Objects then look glued to the screen. While that happens we
 * read the phone's own orientation sensor, which keeps working, and rotate
 * the world around the last camera position so objects stay put as the
 * user turns the device. Position is frozen until camera tracking returns.
 *
 * This file has no browser dependencies so it can be unit-tested in Node.
 */

/**
 * Which way the platform's orientation quaternion maps frames. The Generic
 * Sensor spec wording is easy to misread and implementations have differed,
 * so it is measured at runtime against the camera instead of assumed.
 */
export type SensorConvention = 'device-to-ref' | 'ref-to-device';

export type CalibrationResult = 'calibrating' | SensorConvention | 'unusable';

/** Rotation that maps device-frame vectors at t1 into the device frame at t0. */
export function relativeRotation(
  convention: SensorConvention,
  q0: THREE.Quaternion,
  q1: THREE.Quaternion,
): THREE.Quaternion {
  return convention === 'device-to-ref'
    ? q0.clone().invert().multiply(q1)
    : q0.clone().multiply(q1.clone().invert());
}

/**
 * World transform M such that rendering M * world with the stale camera
 * (position p0, orientation c0) looks like rendering the untouched world
 * from a camera at p0 with orientation c0 * r.
 *
 * Derivation: the view of point X from (p0, c0 r) is r^-1 c0^-1 (X - p0).
 * With M = T(p0) c0 r^-1 c0^-1 T(-p0), the stale view c0^-1 (M X - p0)
 * equals the same expression.
 */
export function holdMatrix(
  p0: THREE.Vector3,
  c0: THREE.Quaternion,
  r: THREE.Quaternion,
  out: THREE.Matrix4,
): THREE.Matrix4 {
  const rot = c0.clone().multiply(r.clone().invert()).multiply(c0.clone().invert());
  out.makeRotationFromQuaternion(rot);
  const rp = p0.clone().applyQuaternion(rot);
  out.setPosition(p0.x - rp.x, p0.y - rp.y, p0.z - rp.z);
  return out;
}

/** Camera must turn at least this much between samples for a vote. */
const MIN_ANGLE = THREE.MathUtils.degToRad(8);
/** A sensor rotation within this fraction of the camera rotation agrees. */
const MAX_ERROR = 0.35;
const VOTES_TO_DECIDE = 3;
const VOTE_CAP = 40;

/**
 * Compares sensor rotations with camera rotations while camera tracking is
 * good, and decides which convention the sensor uses, or that it does not
 * match the camera at all (then the hold is never used).
 */
export class SensorCalibrator {
  startCam: THREE.Quaternion | null = null;
  startSensor: THREE.Quaternion | null = null;
  votesA = 0;
  votesB = 0;
  votesBad = 0;
  result: CalibrationResult = 'calibrating';

  reset(): void {
    this.startCam = null;
    this.startSensor = null;
    this.votesA = 0;
    this.votesB = 0;
    this.votesBad = 0;
    this.result = 'calibrating';
  }

  /** Feed one sample taken while camera tracking is good. */
  add(cam: THREE.Quaternion, sensor: THREE.Quaternion): CalibrationResult {
    if (!this.startCam || !this.startSensor) {
      this.startCam = cam.clone();
      this.startSensor = sensor.clone();
      return this.result;
    }

    const camRel = this.startCam.clone().invert().multiply(cam);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(camRel.w)));
    if (angle < MIN_ANGLE) return this.result;

    const errA = camRel.angleTo(relativeRotation('device-to-ref', this.startSensor, sensor));
    const errB = camRel.angleTo(relativeRotation('ref-to-device', this.startSensor, sensor));
    if (Math.min(errA, errB) > angle * MAX_ERROR) this.votesBad += 1;
    else if (errA <= errB) this.votesA += 1;
    else this.votesB += 1;

    // Next window starts here.
    this.startCam.copy(cam);
    this.startSensor.copy(sensor);

    if (this.votesA + this.votesB + this.votesBad > VOTE_CAP) {
      this.votesA = Math.floor(this.votesA / 2);
      this.votesB = Math.floor(this.votesB / 2);
      this.votesBad = Math.floor(this.votesBad / 2);
    }

    const { votesA: a, votesB: b, votesBad: bad } = this;
    if (a >= VOTES_TO_DECIDE && a >= 2 * (b + bad)) this.result = 'device-to-ref';
    else if (b >= VOTES_TO_DECIDE && b >= 2 * (a + bad)) this.result = 'ref-to-device';
    else if (bad >= VOTES_TO_DECIDE + 1 && bad >= a + b) this.result = 'unusable';
    return this.result;
  }
}
