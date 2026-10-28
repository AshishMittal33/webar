import * as THREE from 'three';
import { getModelSpec } from './models';
import {
  describeArError,
  type EngineEvent,
  type EngineListener,
  type ObjectKind,
  type ObjectSummary,
  type SessionInfo,
  type TrackingState,
} from './types';

/**
 * Only "local" tracking is required so the session can start on every
 * ARCore device. Anchors keep objects fixed to the real world; hit-testing
 * is used only to learn the floor height so floor objects spawn on it.
 */
const OPTIONAL_FEATURES = ['dom-overlay', 'hit-test', 'anchors'];

/** Pixel budget per AR frame, roughly 1080p. Above this we scale down. */
const TARGET_PIXELS = 2_000_000;

/** Frames a degraded pose must persist before the status changes (~60 fps). */
const LIMITED_AFTER_FRAMES = 20;
const LOST_AFTER_FRAMES = 45;

/** Where new objects appear relative to the user. */
const SPAWN_DISTANCE = 1.5;
const TV_SPAWN_BELOW_EYE = 0.3;
const FLOOR_BELOW_EYE_FALLBACK = 1.4;

const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
const MAX_DISTANCE = 12;

/** If an edit moves an object this far from its anchor, give it a new one nearby. */
const REANCHOR_DISTANCE = 0.5;
/** Frames an anchor may stay untracked (while the camera tracks) before it is replaced. */
const ANCHOR_UNTRACKED_LIMIT = 120;

/** One-finger movement below this (normalized screen units) is a tap. */
const TAP_SLOP = 0.01;
/** Two-finger vertical drag: metres of push/pull per full screen height. */
const PUSH_PER_SCREEN = 2.5;

/** Two-finger thresholds before each component starts acting. */
const PINCH_START = 0.08;
const TWIST_START = THREE.MathUtils.degToRad(6);
const PUSH_START = 0.04;

const UNDO_LIMIT = 30;

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * Chooses the WebXR framebuffer scale for this screen: 1.0 on phones with
 * modest resolution, down to 0.5 on large high-DPI tablets.
 */
export function computeRenderScale(): number {
  const dpr = window.devicePixelRatio || 1;
  const physical = window.innerWidth * dpr * window.innerHeight * dpr;
  if (!physical) return 1;
  const scale = Math.sqrt(TARGET_PIXELS / physical);
  return Math.min(1, Math.max(0.5, Math.round(scale * 100) / 100));
}

/** Rotation for an upright object whose front (+Z) points along `dir`. */
function quatFacing(dir: THREE.Vector3): THREE.Quaternion {
  const n = new THREE.Vector3(dir.x, 0, dir.z).normalize();
  if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(UP, n).normalize();
  const m = new THREE.Matrix4().makeBasis(right, UP, n);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** Pointer input from the overlay's gesture layer, normalized to [0, 1]. */
export interface GestureEvent {
  type: 'down' | 'move' | 'up' | 'cancel';
  id: number;
  x: number;
  y: number;
}

/**
 * A placed object. Its pose is stored relative to an ARCore anchor, the way
 * the WebXR anchors sample does it: every frame the object is put exactly at
 * anchorPose * offset. ARCore corrects the camera and the anchors together,
 * so following the anchor exactly is what keeps the object fixed in the room.
 * Any filtering of that pose makes the object lag behind the correction and
 * appear to slide.
 */
interface SceneObject {
  id: string;
  kind: ObjectKind;
  spawn: 'floor' | 'eye';
  /** root.position / root.quaternion are the world pose; scale is separate. */
  root: THREE.Group;
  outline: THREE.LineSegments;
  anchor: XRAnchor | null;
  /** Latest anchor pose in the reference space. */
  readonly anchorMatrix: THREE.Matrix4;
  /** Rigid transform from the anchor to the object. */
  readonly offset: THREE.Matrix4;
  /** False until the first pose of a new anchor has arrived. */
  offsetValid: boolean;
  /** Create an anchor at the object's current pose on the next frame. */
  needsAnchor: boolean;
  anchorPending: boolean;
  untrackedFrames: number;
}

type AnchorCapableFrame = XRFrame & {
  createAnchor?: (pose: XRRigidTransform, space: XRSpace) => Promise<XRAnchor>;
};

interface Transform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: number;
}

type UndoEntry =
  | { type: 'transform'; id: string; before: Transform }
  | { type: 'add'; id: string }
  | { type: 'delete'; id: string; kind: ObjectKind; before: Transform };

type Gesture =
  | {
      kind: 'drag';
      pointerId: number;
      objectId: string;
      /** Plane the object slides on: horizontal for floor objects, facing the user for others. */
      plane: THREE.Plane;
      grabOffset: THREE.Vector3;
      startX: number;
      startY: number;
      moved: boolean;
      undoPushed: boolean;
    }
  | {
      kind: 'two';
      objectId: string;
      startDistance: number;
      startAngle: number;
      startMidY: number;
      startScale: number;
      startQuaternion: THREE.Quaternion;
      startPosition: THREE.Vector3;
      forward: THREE.Vector3;
      /** Each component switches on only once its movement passes a threshold. */
      scaleOn: boolean;
      twistOn: boolean;
      pushOn: boolean;
    }
  | { kind: 'tap-empty'; pointerId: number; startX: number; startY: number; moved: boolean };

type FeatureSession = XRSession & { enabledFeatures?: string[] };

/**
 * Owns the WebXR session, the Three.js renderer, the render loop and the
 * placed objects. React never touches transforms: it sends commands
 * (spawn, nudge, rotate, gestures) and listens for summary events.
 */
export class ArEngine {
  readonly scene = new THREE.Scene();
  /** Camera object; its pose is driven by WebXR each frame. */
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 30);

  private renderer: THREE.WebGLRenderer | null = null;
  private session: XRSession | null = null;
  private listeners = new Set<EngineListener>();
  private trackingState: TrackingState = 'initializing';
  private endedByUser = false;

  private frameCount = 0;
  private fpsWindowStart = 0;
  private statsEnabled = false;
  private lostFrames = 0;
  private limitedFrames = 0;
  /** True on frames where WebXR gave a viewer pose. */
  private hasPose = false;

  private hitTestSource: XRHitTestSource | null = null;
  private floorY: number | null = null;
  private anchorsAvailable = false;

  private objects: SceneObject[] = [];
  private selectedId: string | null = null;
  private nextId = 1;
  private undoStack: UndoEntry[] = [];

  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly outlineMaterial = new THREE.LineBasicMaterial({ color: 0xf5b942 });

  // Scratch objects reused every frame to avoid garbage.
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpScale = new THREE.Vector3();

  constructor() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x667799, 1.0);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(0.5, 1, 0.25);
    this.scene.add(hemi, dir);
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get isRunning(): boolean {
    return this.session !== null;
  }

  private emit(event: EngineEvent) {
    for (const l of this.listeners) l(event);
  }

  // ----- Session -----

  /**
   * Must be called synchronously from a user gesture (button tap): Chrome
   * only allows requestSession with transient user activation, so nothing
   * here awaits before requestSession is invoked.
   */
  async start(canvasHost: HTMLElement, overlayRoot: HTMLElement): Promise<void> {
    if (this.session) throw new DOMException('Session already running', 'InvalidStateError');
    const xr = navigator.xr;
    if (!xr) throw new DOMException('WebXR not available', 'NotSupportedError');

    const sessionPromise = xr.requestSession('immersive-ar', {
      requiredFeatures: ['local'],
      optionalFeatures: OPTIONAL_FEATURES,
      domOverlay: { root: overlayRoot },
    });

    this.endedByUser = false;
    this.trackingState = 'initializing';
    this.lostFrames = 0;
    this.limitedFrames = 0;
    this.frameCount = 0;
    this.fpsWindowStart = 0;
    this.hasPose = false;

    let session: XRSession;
    try {
      session = await sessionPromise;
    } catch (err) {
      this.emit({ type: 'error', error: describeArError(err) });
      throw err;
    }

    this.session = session;
    const renderer = this.createRenderer(canvasHost);
    this.renderer = renderer;

    session.addEventListener('end', this.onSessionEnd);
    session.addEventListener('visibilitychange', this.onVisibilityChange);

    renderer.xr.setReferenceSpaceType('local');
    const renderScale = computeRenderScale();
    renderer.xr.setFramebufferScaleFactor(renderScale);
    await renderer.xr.setSession(session);

    const info = this.collectSessionInfo(session, renderScale);
    this.anchorsAvailable = info.anchorsSupported;
    await this.setupHitTest(session, info);

    renderer.setAnimationLoop(this.onFrame);
    this.emit({ type: 'started', info });
    this.emitObjects();
  }

  /** Ends the session. Resolves after cleanup; safe to call twice. */
  async end(): Promise<void> {
    if (!this.session) return;
    this.endedByUser = true;
    try {
      await this.session.end();
    } catch {
      // Session was already ending; onSessionEnd handles cleanup.
    }
  }

  /** Turn the once-a-second fps report on or off (it re-renders the overlay). */
  setStatsEnabled(enabled: boolean): void {
    this.statsEnabled = enabled;
    this.frameCount = 0;
    this.fpsWindowStart = 0;
  }

  private createRenderer(host: HTMLElement): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    renderer.setSize(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
    renderer.xr.enabled = true;
    renderer.shadowMap.enabled = false;
    host.appendChild(renderer.domElement);
    return renderer;
  }

  private collectSessionInfo(session: XRSession, renderScale: number): SessionInfo {
    const enabled = (session as FeatureSession).enabledFeatures ?? ['(enabledFeatures not reported by this browser)'];
    return {
      enabledFeatures: enabled,
      missingFeatures: OPTIONAL_FEATURES.filter((f) => !enabled.includes(f)),
      environmentBlendMode: session.environmentBlendMode,
      referenceSpace: 'local',
      domOverlaySupported: enabled.includes('dom-overlay'),
      hitTestSupported: enabled.includes('hit-test') && typeof session.requestHitTestSource === 'function',
      anchorsSupported: enabled.includes('anchors'),
      renderScale,
    };
  }

  private async setupHitTest(session: XRSession, info: SessionInfo) {
    if (!info.hitTestSupported) return;
    try {
      const viewerSpace = await session.requestReferenceSpace('viewer');
      this.hitTestSource = (await session.requestHitTestSource!({ space: viewerSpace })) ?? null;
    } catch {
      this.hitTestSource = null;
      info.hitTestSupported = false;
    }
  }

  // ----- Frame loop -----

  private onFrame = (time: number, frame?: XRFrame) => {
    const renderer = this.renderer;
    if (!renderer) return;

    if (frame) {
      const refSpace = renderer.xr.getReferenceSpace();
      const viewerPose = (refSpace ? frame.getViewerPose(refSpace) : null) ?? null;
      this.updateTracking(viewerPose);
      this.hasPose = viewerPose !== null;
      // Like the WebXR samples: with no viewer pose there is nothing correct
      // to draw. Three.js would otherwise reuse the last camera and the
      // objects would look glued to the screen.
      this.scene.visible = this.hasPose;
      if (refSpace && this.hasPose) {
        this.learnFloor(frame, refSpace);
        this.updateAnchors(frame, refSpace);
      }
    }
    this.countFrame(time);

    renderer.render(this.scene, this.camera);
  };

  // ----- Anchors -----

  private updateAnchors(frame: XRFrame, refSpace: XRReferenceSpace) {
    if (!this.anchorsAvailable) return;
    const f = frame as AnchorCapableFrame;

    for (const obj of this.objects) {
      if (obj.needsAnchor && !obj.anchorPending && typeof f.createAnchor === 'function') {
        this.createAnchorFor(obj, f, refSpace);
      }

      if (!obj.anchor) {
        obj.root.visible = true;
        continue;
      }

      const pose = frame.getPose(obj.anchor.anchorSpace, refSpace);
      if (!pose) {
        // The anchor is not tracked right now. Hide the object rather than
        // draw it somewhere that may be wrong, as the samples do. If this
        // lasts while the camera itself tracks, replace the anchor.
        obj.root.visible = false;
        obj.untrackedFrames += 1;
        if (obj.untrackedFrames > ANCHOR_UNTRACKED_LIMIT) {
          obj.anchor.delete();
          obj.anchor = null;
          obj.needsAnchor = true;
          obj.root.visible = true;
        }
        continue;
      }

      obj.untrackedFrames = 0;
      obj.root.visible = true;
      obj.anchorMatrix.fromArray(pose.transform.matrix);
      if (!obj.offsetValid) {
        this.recomputeOffset(obj);
        obj.offsetValid = true;
      }
      if (this.isBeingManipulated(obj.id)) continue;

      // Exactly anchorPose * offset, every frame, no filtering.
      this.tmpMatrix.multiplyMatrices(obj.anchorMatrix, obj.offset);
      this.tmpMatrix.decompose(obj.root.position, obj.root.quaternion, this.tmpScale);
    }
  }

  private createAnchorFor(obj: SceneObject, frame: AnchorCapableFrame, refSpace: XRReferenceSpace) {
    obj.needsAnchor = false;
    obj.anchorPending = true;
    const p = obj.root.position;
    const q = obj.root.quaternion;
    try {
      frame
        .createAnchor!(new XRRigidTransform({ x: p.x, y: p.y, z: p.z, w: 1 }, { x: q.x, y: q.y, z: q.z, w: q.w }), refSpace)
        .then((anchor) => {
          obj.anchorPending = false;
          if (!this.objects.includes(obj)) {
            anchor.delete();
            return;
          }
          obj.anchor?.delete();
          obj.anchor = anchor;
          obj.untrackedFrames = 0;
          // The offset is computed from the object's pose when the anchor's
          // first pose arrives, so edits made meanwhile are kept.
          obj.offsetValid = false;
        })
        .catch(() => {
          obj.anchorPending = false;
        });
    } catch {
      obj.anchorPending = false;
    }
  }

  /** offset = anchorPose^-1 * objectPose (rigid; scale is kept on the root). */
  private recomputeOffset(obj: SceneObject) {
    this.tmpMatrix.compose(obj.root.position, obj.root.quaternion, ONE);
    obj.offset.copy(obj.anchorMatrix).invert().multiply(this.tmpMatrix);
  }

  private isBeingManipulated(id: string): boolean {
    const g = this.gesture;
    return (g?.kind === 'drag' || g?.kind === 'two') && g.objectId === id;
  }

  /**
   * Call after the user changes an object's pose. The new pose is stored
   * relative to the existing anchor; a fresh anchor is made only when the
   * object moved far from it.
   */
  private touch(obj: SceneObject) {
    if (!obj.anchor || !obj.offsetValid) {
      if (!obj.anchor && !obj.anchorPending) obj.needsAnchor = true;
      return;
    }
    this.recomputeOffset(obj);
    const offsetDistance = new THREE.Vector3().setFromMatrixPosition(obj.offset).length();
    if (offsetDistance > REANCHOR_DISTANCE) obj.needsAnchor = true;
  }

  /** Keeps the lowest horizontal hit seen so floor objects spawn on the floor. */
  private learnFloor(frame: XRFrame, refSpace: XRReferenceSpace) {
    if (!this.hitTestSource) return;
    const results = frame.getHitTestResults(this.hitTestSource);
    if (results.length === 0) return;
    const pose = results[0].getPose(refSpace);
    if (!pose) return;
    const q = pose.transform.orientation;
    const normal = UP.clone().applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    if (normal.y < 0.75) return;
    const y = pose.transform.position.y;
    const wasKnown = this.floorY !== null;
    this.floorY = wasKnown ? Math.min(this.floorY!, y) : y;
    if (!wasKnown) this.emit({ type: 'floor', known: true });
  }

  private countFrame(time: number) {
    if (!this.statsEnabled) return;
    this.frameCount += 1;
    if (this.fpsWindowStart === 0) this.fpsWindowStart = time;
    const elapsed = time - this.fpsWindowStart;
    if (elapsed >= 1000) {
      const fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.fpsWindowStart = time;
      this.emit({ type: 'fps', fps });
    }
  }

  /**
   * Tracking status for the UI, with hysteresis so a brief dropout does not
   * flash the label. (Rendering uses the raw per-frame pose, not this.)
   */
  private updateTracking(pose: XRViewerPose | null) {
    if (!pose) {
      this.limitedFrames = 0;
      this.lostFrames += 1;
    } else if (pose.emulatedPosition) {
      this.lostFrames = 0;
      this.limitedFrames += 1;
    } else {
      this.lostFrames = 0;
      this.limitedFrames = 0;
    }

    let next = this.trackingState;
    if (pose && !pose.emulatedPosition) {
      next = 'tracking';
    } else if (this.lostFrames >= LOST_AFTER_FRAMES) {
      next = this.trackingState === 'initializing' ? 'initializing' : 'lost';
    } else if (this.limitedFrames >= LIMITED_AFTER_FRAMES) {
      next = this.trackingState === 'initializing' ? 'initializing' : 'limited';
    }

    if (next !== this.trackingState) {
      this.trackingState = next;
      this.emit({ type: 'tracking', state: next });
    }
  }

  // ----- Camera helpers -----

  /** Editing maps the screen through the live camera, so it needs a pose. */
  private get canEdit(): boolean {
    return this.hasPose;
  }

  /** World-space camera position and horizontal forward/right directions. */
  private cameraFrame(): { position: THREE.Vector3; forward: THREE.Vector3; right: THREE.Vector3 } | null {
    if (!this.renderer) return null;
    const cam = this.renderer.xr.getCamera();
    const position = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const quat = new THREE.Quaternion().setFromRotationMatrix(cam.matrixWorld);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
    return { position, forward, right };
  }

  private rayFromScreen(x: number, y: number): THREE.Ray | null {
    if (!this.renderer) return null;
    const cam = this.renderer.xr.getCamera();
    this.raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)), cam);
    return this.raycaster.ray.clone();
  }

  // ----- Objects -----

  /** Creates an object about 1.5 m in front of the user, facing them. */
  spawn(kind: ObjectKind): string | null {
    if (!this.canEdit) return null;
    const cam = this.cameraFrame();
    if (!cam) return null;
    const spec = getModelSpec(kind);

    const position = cam.position.clone().addScaledVector(cam.forward, SPAWN_DISTANCE);
    if (spec.spawn === 'floor') {
      position.y = this.floorY ?? cam.position.y - FLOOR_BELOW_EYE_FALLBACK;
    } else {
      position.y = cam.position.y - TV_SPAWN_BELOW_EYE;
    }
    const quaternion = quatFacing(cam.forward.clone().negate());

    const obj = this.createObject(kind, { position, quaternion, scale: 1 });
    this.pushUndo({ type: 'add', id: obj.id });
    this.selectedId = obj.id;
    this.updateOutlines();
    this.emitObjects();
    return obj.id;
  }

  private createObject(kind: ObjectKind, t: Transform): SceneObject {
    const spec = getModelSpec(kind);
    const root = new THREE.Group();
    root.name = `object-${this.nextId}`;
    const model = spec.build();
    root.add(model);

    // Selection outline: the model's bounding box as yellow edges.
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x + 0.02, size.y + 0.02, size.z + 0.02)),
      this.outlineMaterial,
    );
    outline.position.copy(center);
    outline.visible = false;
    root.add(outline);

    root.position.copy(t.position);
    root.quaternion.copy(t.quaternion);
    root.scale.setScalar(t.scale);
    this.scene.add(root);

    const obj: SceneObject = {
      id: String(this.nextId++),
      kind,
      spawn: spec.spawn,
      root,
      outline,
      anchor: null,
      anchorMatrix: new THREE.Matrix4(),
      offset: new THREE.Matrix4(),
      offsetValid: false,
      needsAnchor: true,
      anchorPending: false,
      untrackedFrames: 0,
    };
    root.userData.objectId = obj.id;
    this.objects.push(obj);
    return obj;
  }

  private findObject(id: string | null): SceneObject | null {
    if (!id) return null;
    return this.objects.find((o) => o.id === id) ?? null;
  }

  private get selected(): SceneObject | null {
    return this.findObject(this.selectedId);
  }

  select(id: string | null): void {
    if (id !== null && !this.findObject(id)) return;
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.updateOutlines();
    this.emitObjects();
  }

  private updateOutlines() {
    for (const o of this.objects) o.outline.visible = o.id === this.selectedId;
  }

  private snapshot(obj: SceneObject): Transform {
    return { position: obj.root.position.clone(), quaternion: obj.root.quaternion.clone(), scale: obj.root.scale.x };
  }

  private applyTransform(obj: SceneObject, t: Transform) {
    obj.root.position.copy(t.position);
    obj.root.quaternion.copy(t.quaternion);
    obj.root.scale.setScalar(t.scale);
    this.touch(obj);
  }

  private clampPosition(obj: SceneObject) {
    const cam = this.cameraFrame();
    if (!cam) return;
    const d = obj.root.position.distanceTo(cam.position);
    if (d > MAX_DISTANCE) {
      obj.root.position.sub(cam.position).multiplyScalar(MAX_DISTANCE / d).add(cam.position);
    }
  }

  /**
   * Moves the selected object by metres along the user's right (x), up (y)
   * and forward (z) directions, so "left" always means the user's left.
   */
  nudge(dx: number, dy: number, dz: number): void {
    const obj = this.selected;
    const cam = this.cameraFrame();
    if (!obj || !cam || !this.canEdit) return;
    this.pushUndo({ type: 'transform', id: obj.id, before: this.snapshot(obj) });
    obj.root.position.addScaledVector(cam.right, dx).addScaledVector(UP, dy).addScaledVector(cam.forward, dz);
    this.clampPosition(obj);
    this.touch(obj);
  }

  /** Rotates the selected object around its vertical axis by degrees. */
  rotate(degrees: number): void {
    const obj = this.selected;
    if (!obj) return;
    this.pushUndo({ type: 'transform', id: obj.id, before: this.snapshot(obj) });
    obj.root.rotateOnWorldAxis(UP, THREE.MathUtils.degToRad(degrees));
    this.touch(obj);
  }

  /** Turns the selected object to face the user squarely. */
  faceUser(): void {
    const obj = this.selected;
    const cam = this.cameraFrame();
    if (!obj || !cam || !this.canEdit) return;
    this.pushUndo({ type: 'transform', id: obj.id, before: this.snapshot(obj) });
    const toCam = cam.position.clone().sub(obj.root.position);
    obj.root.quaternion.copy(quatFacing(toCam));
    this.touch(obj);
  }

  /** Multiplies the selected object's size. */
  scaleBy(factor: number): void {
    const obj = this.selected;
    if (!obj) return;
    this.pushUndo({ type: 'transform', id: obj.id, before: this.snapshot(obj) });
    const s = THREE.MathUtils.clamp(obj.root.scale.x * factor, MIN_SCALE, MAX_SCALE);
    obj.root.scale.setScalar(s);
  }

  /** Copies the selected object beside itself (to the user's right). */
  duplicate(): void {
    const obj = this.selected;
    const cam = this.cameraFrame();
    if (!obj || !cam || !this.canEdit) return;
    const box = new THREE.Box3().setFromObject(obj.root);
    const width = box.getSize(new THREE.Vector3()).x || 0.5;
    const t = this.snapshot(obj);
    t.position.addScaledVector(cam.right, width + 0.1);
    const copy = this.createObject(obj.kind, t);
    this.pushUndo({ type: 'add', id: copy.id });
    this.selectedId = copy.id;
    this.updateOutlines();
    this.emitObjects();
  }

  deleteSelected(): void {
    const obj = this.selected;
    if (!obj) return;
    this.pushUndo({ type: 'delete', id: obj.id, kind: obj.kind, before: this.snapshot(obj) });
    this.removeObject(obj);
    this.selectedId = null;
    this.emitObjects();
  }

  clearAll(): void {
    for (const obj of [...this.objects]) this.removeObject(obj);
    this.selectedId = null;
    this.undoStack = [];
    this.gesture = null;
    this.emitObjects();
  }

  private removeObject(obj: SceneObject) {
    this.scene.remove(obj.root);
    obj.outline.geometry.dispose();
    obj.anchor?.delete();
    obj.anchor = null;
    this.objects = this.objects.filter((o) => o !== obj);
  }

  // ----- Undo -----

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  private pushUndo(entry: UndoEntry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    switch (entry.type) {
      case 'transform': {
        const obj = this.findObject(entry.id);
        if (obj) this.applyTransform(obj, entry.before);
        break;
      }
      case 'add': {
        const obj = this.findObject(entry.id);
        if (obj) {
          this.removeObject(obj);
          if (this.selectedId === obj.id) this.selectedId = null;
        }
        break;
      }
      case 'delete': {
        // Recreate with a fresh id; the old id is gone.
        const obj = this.createObject(entry.kind, entry.before);
        this.selectedId = obj.id;
        this.updateOutlines();
        break;
      }
    }
    this.emitObjects();
  }

  private emitObjects() {
    const objects: ObjectSummary[] = this.objects.map((o) => ({ id: o.id, kind: o.kind }));
    this.emit({ type: 'objects', objects, selectedId: this.selectedId });
  }

  // ----- Gestures -----

  /**
   * One finger: tap an object to select it; drag a selected object to slide
   * it (floor objects on the floor plane, wall objects on a plane facing the
   * user). Tap empty space to deselect.
   * Two fingers, first one on the object: pinch to resize, twist to rotate,
   * move both fingers up/down to push the object away or pull it closer.
   */
  handleGesture(e: GestureEvent): void {
    if (!this.renderer) return;
    // Gestures map the screen through the live camera; pause them while
    // camera tracking is paused. Lifting fingers is still processed.
    if (!this.canEdit && (e.type === 'down' || e.type === 'move')) return;

    if (e.type === 'down') {
      this.pointers.set(e.id, { x: e.x, y: e.y });
      if (this.pointers.size === 1) {
        this.beginOneFinger(e);
      } else if (this.pointers.size === 2) {
        // A two-finger gesture only counts when the first finger landed on
        // the object. Two touches on empty space (hands holding the
        // device) do nothing, and must not deselect either.
        if (this.gesture?.kind === 'drag') this.beginTwoFinger();
        else if (this.gesture?.kind === 'tap-empty') this.gesture.moved = true;
      }
      return;
    }

    if (e.type === 'move') {
      if (!this.pointers.has(e.id)) return;
      this.pointers.set(e.id, { x: e.x, y: e.y });
      if (this.gesture?.kind === 'drag' && this.gesture.pointerId === e.id) this.moveDrag(e);
      else if (this.gesture?.kind === 'two' && this.pointers.size === 2) this.moveTwoFinger();
      else if (this.gesture?.kind === 'tap-empty' && this.gesture.pointerId === e.id) {
        if (Math.hypot(e.x - this.gesture.startX, e.y - this.gesture.startY) > TAP_SLOP) this.gesture.moved = true;
      }
      return;
    }

    // up / cancel
    const wasTapEmpty = this.gesture?.kind === 'tap-empty' && !this.gesture.moved && e.type === 'up';
    const editedId =
      this.gesture?.kind === 'drag' || this.gesture?.kind === 'two' ? this.gesture.objectId : null;
    this.pointers.delete(e.id);
    if (wasTapEmpty) this.select(null);
    if (this.pointers.size === 0) this.gesture = null;
    else if (this.pointers.size === 1 && this.gesture?.kind === 'two') {
      // Lifted one of two fingers: stop the two-finger gesture, no new drag
      // until the remaining finger is lifted too.
      this.gesture = null;
    }
    // Store the new pose against the anchor once the gesture is over.
    if (editedId && !this.isBeingManipulated(editedId)) {
      const obj = this.findObject(editedId);
      if (obj) this.touch(obj);
    }
  }

  private beginOneFinger(e: GestureEvent) {
    const ray = this.rayFromScreen(e.x, e.y);
    if (!ray) return;
    const hitObj = this.pickObject(ray);
    if (!hitObj) {
      this.gesture = { kind: 'tap-empty', pointerId: e.id, startX: e.x, startY: e.y, moved: false };
      return;
    }
    if (hitObj.id !== this.selectedId) this.select(hitObj.id);

    const plane =
      hitObj.spawn === 'floor'
        ? new THREE.Plane(UP.clone(), -hitObj.root.position.y)
        : this.planeFacingUser(hitObj.root.position);
    const hitPoint = new THREE.Vector3();
    if (!ray.intersectPlane(plane, hitPoint)) {
      this.gesture = null;
      return;
    }
    this.gesture = {
      kind: 'drag',
      pointerId: e.id,
      objectId: hitObj.id,
      plane,
      grabOffset: hitPoint.sub(hitObj.root.position),
      startX: e.x,
      startY: e.y,
      moved: false,
      undoPushed: false,
    };
  }

  /** Vertical plane through `point`, perpendicular to the user's view direction. */
  private planeFacingUser(point: THREE.Vector3): THREE.Plane {
    const cam = this.cameraFrame();
    const normal = cam ? cam.forward.clone().negate() : new THREE.Vector3(0, 0, 1);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
  }

  private pickObject(ray: THREE.Ray): SceneObject | null {
    this.raycaster.ray.copy(ray);
    const roots = this.objects.filter((o) => o.root.visible).map((o) => o.root);
    const hits = this.raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && node.userData.objectId === undefined) node = node.parent;
      if (node) {
        const obj = this.findObject(node.userData.objectId as string);
        if (obj) return obj;
      }
    }
    return null;
  }

  private moveDrag(e: GestureEvent) {
    const g = this.gesture;
    if (g?.kind !== 'drag') return;
    const obj = this.findObject(g.objectId);
    if (!obj) return;
    if (!g.moved && Math.hypot(e.x - g.startX, e.y - g.startY) <= TAP_SLOP) return;
    g.moved = true;
    if (!g.undoPushed) {
      this.pushUndo({ type: 'transform', id: obj.id, before: this.snapshot(obj) });
      g.undoPushed = true;
    }
    const ray = this.rayFromScreen(e.x, e.y);
    if (!ray) return;
    const hitPoint = new THREE.Vector3();
    if (!ray.intersectPlane(g.plane, hitPoint)) return;
    obj.root.position.copy(hitPoint.sub(g.grabOffset));
    this.clampPosition(obj);
  }

  private twoFingerStats(): { distance: number; angle: number; midY: number } | null {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return null;
    const dx = (pts[1].x - pts[0].x) * window.innerWidth;
    const dy = (pts[1].y - pts[0].y) * window.innerHeight;
    return { distance: Math.hypot(dx, dy), angle: Math.atan2(dy, dx), midY: (pts[0].y + pts[1].y) / 2 };
  }

  private beginTwoFinger() {
    const obj = this.selected;
    const stats = this.twoFingerStats();
    const cam = this.cameraFrame();
    if (!obj || !stats || !cam) {
      this.gesture = null;
      return;
    }
    this.pushUndo({ type: 'transform', id: obj.id, before: this.snapshot(obj) });
    this.gesture = {
      kind: 'two',
      objectId: obj.id,
      startDistance: Math.max(stats.distance, 1),
      startAngle: stats.angle,
      startMidY: stats.midY,
      startScale: obj.root.scale.x,
      startQuaternion: obj.root.quaternion.clone(),
      startPosition: obj.root.position.clone(),
      forward: cam.forward.clone(),
      scaleOn: false,
      twistOn: false,
      pushOn: false,
    };
  }

  private moveTwoFinger() {
    const g = this.gesture;
    if (g?.kind !== 'two') return;
    const obj = this.findObject(g.objectId);
    const stats = this.twoFingerStats();
    if (!obj || !stats) return;

    // Each component only activates after a clear, deliberate movement, so a
    // twist does not also resize the object and a pinch does not also push it.
    const ratio = stats.distance / g.startDistance;
    const angleDelta = stats.angle - g.startAngle;
    const twist = -Math.atan2(Math.sin(angleDelta), Math.cos(angleDelta));
    const dy = stats.midY - g.startMidY;
    if (!g.scaleOn && Math.abs(ratio - 1) > PINCH_START) g.scaleOn = true;
    if (!g.twistOn && Math.abs(twist) > TWIST_START) g.twistOn = true;
    if (!g.pushOn && Math.abs(dy) > PUSH_START) g.pushOn = true;

    if (g.scaleOn) {
      obj.root.scale.setScalar(THREE.MathUtils.clamp(g.startScale * ratio, MIN_SCALE, MAX_SCALE));
    }
    // Screen y points down, so a clockwise twist on screen is a negative angle here.
    if (g.twistOn) {
      obj.root.quaternion.copy(g.startQuaternion);
      obj.root.rotateOnWorldAxis(UP, twist);
    }
    if (g.pushOn) {
      obj.root.position.copy(g.startPosition).addScaledVector(g.forward, -dy * PUSH_PER_SCREEN);
      this.clampPosition(obj);
    }
  }

  // ----- Session end -----

  private onVisibilityChange = () => {
    if (!this.session) return;
    this.emit({ type: 'visibility', state: this.session.visibilityState });
  };

  private onSessionEnd = () => {
    const session = this.session;
    if (session) {
      session.removeEventListener('end', this.onSessionEnd);
      session.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.session = null;
    this.cleanupSession();
    this.emit({ type: 'ended', reason: this.endedByUser ? 'user' : 'browser' });
  };

  private cleanupSession() {
    // Objects do not survive the session: their poses are relative to this
    // session's tracking origin and anchors die with the session.
    for (const obj of [...this.objects]) this.removeObject(obj);
    this.selectedId = null;
    this.undoStack = [];
    this.pointers.clear();
    this.gesture = null;

    this.hitTestSource?.cancel();
    this.hitTestSource = null;
    this.floorY = null;
    this.hasPose = false;
    this.scene.visible = true;

    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
  }
}
