import * as THREE from 'three';
import { createCube, createTv } from './models';
import {
  describeArError,
  type EngineEvent,
  type EngineListener,
  type PlacementMode,
  type ReticleSource,
  type ReticleState,
  type SessionInfo,
  type SurfaceType,
  type TrackingState,
  type WallMethod,
} from './types';

/**
 * Features we ask the browser for. Only "local" tracking is required so the
 * session can start on every ARCore device; everything else is optional and
 * reported back through SessionInfo so the UI can say what is really active.
 */
const OPTIONAL_FEATURES = ['dom-overlay', 'hit-test', 'anchors', 'light-estimation', 'depth-sensing'];

/** Pixel budget per AR frame, roughly 1080p. Above this we scale down. */
const TARGET_PIXELS = 2_000_000;

/** Floor-edge fallback: height of the TV mounting point above the floor. */
const WALL_TV_HEIGHT = 1.2;

/** Depth estimates outside this range are treated as "no wall here". */
const DEPTH_MIN = 0.3;
const DEPTH_MAX = 8;

/** Frames a degraded pose must persist before the status changes (~60 fps). */
const LIMITED_AFTER_FRAMES = 20;
const LOST_AFTER_FRAMES = 45;

/**
 * Depth samples across the screen centre line, as normalized x positions.
 * Several points let us fit the wall's direction instead of assuming it
 * faces the user.
 */
const DEPTH_SAMPLE_XS = [0.3, 0.4, 0.5, 0.6, 0.7];
/** Max distance of a sample from the fitted wall line to accept the fit. */
const WALL_FIT_TOLERANCE = 0.06;
/** Minimum horizontal spread of samples for a meaningful direction. */
const WALL_FIT_MIN_SPAN = 0.2;
/** Reticle smoothing factor per frame (0 = frozen, 1 = raw). */
const RETICLE_SMOOTHING = 0.25;
/** A jump larger than this resets smoothing (user aimed somewhere else). */
const RETICLE_RESET_DISTANCE = 0.3;

const UP = new THREE.Vector3(0, 1, 0);

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

/** Classify a surface by the direction of its normal. */
function classifyNormal(normal: THREE.Vector3): SurfaceType {
  if (normal.y > 0.75) return 'horizontal';
  if (Math.abs(normal.y) < 0.35) return 'vertical';
  return 'other';
}

/** Rotation whose +Y axis is `normal`; used for the flat reticle ring. */
function quatWithUpAxis(normal: THREE.Vector3): THREE.Quaternion {
  const helper = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : UP;
  const right = new THREE.Vector3().crossVectors(helper, normal).normalize();
  const forward = new THREE.Vector3().crossVectors(right, normal).normalize();
  const m = new THREE.Matrix4().makeBasis(right, normal, forward);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** Rotation for an upright object whose front (+Z) points along `normal`. */
function quatFacing(normal: THREE.Vector3): THREE.Quaternion {
  const n = new THREE.Vector3(normal.x, 0, normal.z).normalize();
  const right = new THREE.Vector3().crossVectors(UP, n).normalize();
  const m = new THREE.Matrix4().makeBasis(right, UP, n);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

interface PlacedObject {
  /** Root whose matrix is the object pose; model children hang off it. */
  root: THREE.Group;
  anchor: XRAnchor | null;
  kind: 'cube' | 'tv';
  wallMethod: WallMethod | null;
}

/** The reticle's current real-world target, refreshed every frame. */
interface Target {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  surface: SurfaceType;
  source: ReticleSource;
  /** Present only for real hit-test results (lets us anchor to the plane). */
  hit: XRHitTestResult | null;
}

// Parts of the WebXR API that @types/webxr may not declare on this version.
type AnchorCapableHit = XRHitTestResult & { createAnchor?: () => Promise<XRAnchor> };
type AnchorCapableFrame = XRFrame & {
  createAnchor?: (pose: XRRigidTransform, space: XRSpace) => Promise<XRAnchor>;
};
interface CpuDepthInformation {
  getDepthInMeters(x: number, y: number): number;
}
type DepthCapableFrame = XRFrame & {
  getDepthInformation?: (view: XRView) => CpuDepthInformation | null;
};
type DepthCapableSession = XRSession & { depthUsage?: string; enabledFeatures?: string[] };

/**
 * Owns the WebXR session, the Three.js renderer and the render loop.
 *
 * It is deliberately not a React component: the render loop runs at device
 * frame rate and must not cause React re-renders. React only hears about
 * discrete changes (session started, tracking state changed, reticle found
 * or lost, object placed, session ended) through the listener API.
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
  private lostFrames = 0;
  private limitedFrames = 0;

  // Surface finding
  private hitTestSource: XRHitTestSource | null = null;
  private anchorsAvailable = false;
  private depthAvailable = false;
  private mode: PlacementMode = 'floor';

  // Reticle
  private readonly reticle: THREE.Group;
  private readonly reticleRing: THREE.Mesh;
  private reticleState: ReticleState = { visible: false, surface: null, source: null };
  private target: Target | null = null;
  /** Lowest floor height seen from hit-testing this session, if any. */
  private floorY: number | null = null;

  // Placement
  private placeRequested = false;
  private placed: PlacedObject[] = [];
  private lastWallMethod: WallMethod | null = null;

  constructor() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x667799, 1.0);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(0.5, 1, 0.25);
    this.scene.add(hemi, dir);

    // Reticle: flat ring lying on the surface plane. RingGeometry is in XY,
    // so rotate it into XZ where +Y is the surface normal.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.08, 32),
      new THREE.MeshBasicMaterial({ color: 0x37c978, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.01, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    );
    dot.rotation.x = -Math.PI / 2;
    this.reticle = new THREE.Group();
    this.reticle.add(ring, dot);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.reticleRing = ring;
    this.scene.add(this.reticle);
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

  /**
   * Must be called synchronously from a user gesture (button tap): Chrome
   * only allows requestSession with transient user activation, so nothing
   * here awaits before requestSession is invoked.
   */
  async start(canvasHost: HTMLElement, overlayRoot: HTMLElement): Promise<void> {
    if (this.session) throw new DOMException('Session already running', 'InvalidStateError');
    const xr = navigator.xr;
    if (!xr) throw new DOMException('WebXR not available', 'NotSupportedError');

    const init: XRSessionInit & { depthSensing?: unknown } = {
      requiredFeatures: ['local'],
      optionalFeatures: OPTIONAL_FEATURES,
      domOverlay: { root: overlayRoot },
      // CPU access is required to read a single depth value at the centre.
      depthSensing: {
        usagePreference: ['cpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32'],
      },
    };
    const sessionPromise = xr.requestSession('immersive-ar', init);

    this.endedByUser = false;
    this.trackingState = 'initializing';
    this.lostFrames = 0;
    this.limitedFrames = 0;
    this.frameCount = 0;
    this.fpsWindowStart = 0;
    this.placeRequested = false;
    this.lastWallMethod = null;

    let session: XRSession;
    try {
      session = await sessionPromise;
    } catch (err) {
      const error = describeArError(err);
      this.emit({ type: 'error', error });
      throw err;
    }

    this.session = session;
    const renderer = this.createRenderer(canvasHost);
    this.renderer = renderer;

    session.addEventListener('end', this.onSessionEnd);
    session.addEventListener('visibilitychange', this.onVisibilityChange);
    session.addEventListener('select', this.onSelect);

    renderer.xr.setReferenceSpaceType('local');
    // Render the AR layer at a lower internal resolution on large or very
    // high-DPI screens. Big tablets otherwise push 5+ megapixels per frame.
    const renderScale = computeRenderScale();
    renderer.xr.setFramebufferScaleFactor(renderScale);
    await renderer.xr.setSession(session);

    const info = this.collectSessionInfo(session, renderScale);
    this.anchorsAvailable = info.anchorsSupported;
    this.depthAvailable = info.depthSensingSupported;
    await this.setupHitTest(session, info);

    renderer.setAnimationLoop(this.onFrame);
    this.emit({ type: 'started', info });
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

  setMode(mode: PlacementMode): void {
    this.mode = mode;
  }

  /** Ask to place an object at the reticle on the next frame. */
  requestPlace(): void {
    this.placeRequested = true;
  }

  /** Remove every placed object and its anchor. */
  clearObjects(): void {
    for (const obj of this.placed) {
      this.scene.remove(obj.root);
      obj.anchor?.delete();
    }
    this.placed = [];
    this.lastWallMethod = null;
    this.emitObjects();
  }

  private createRenderer(host: HTMLElement): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      // MSAA is expensive on mobile GPUs; edges are acceptable without it.
      antialias: false,
      alpha: true,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    renderer.setSize(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
    renderer.xr.enabled = true;
    // No shadow maps: mid-range phones and real-time shadows do not mix.
    renderer.shadowMap.enabled = false;
    host.appendChild(renderer.domElement);
    return renderer;
  }

  private collectSessionInfo(session: XRSession, renderScale: number): SessionInfo {
    const s = session as DepthCapableSession;
    const enabled = s.enabledFeatures ?? ['(enabledFeatures not reported by this browser)'];
    const missing = OPTIONAL_FEATURES.filter((f) => !enabled.includes(f));
    const depthCpu = enabled.includes('depth-sensing') && (s.depthUsage === undefined || s.depthUsage === 'cpu-optimized');
    return {
      enabledFeatures: enabled,
      missingFeatures: missing,
      environmentBlendMode: session.environmentBlendMode,
      referenceSpace: 'local',
      domOverlaySupported: enabled.includes('dom-overlay'),
      hitTestSupported: enabled.includes('hit-test') && typeof session.requestHitTestSource === 'function',
      anchorsSupported: enabled.includes('anchors'),
      depthSensingSupported: depthCpu,
      renderScale,
    };
  }

  /**
   * A viewer-space hit-test source casts a ray from the centre of the screen
   * every frame; the first result is where the reticle goes.
   */
  private async setupHitTest(session: XRSession, info: SessionInfo) {
    if (!info.hitTestSupported) return;
    try {
      const viewerSpace = await session.requestReferenceSpace('viewer');
      const source = await session.requestHitTestSource!({ space: viewerSpace });
      this.hitTestSource = source ?? null;
    } catch {
      this.hitTestSource = null;
      info.hitTestSupported = false;
    }
  }

  private onFrame = (time: number, frame?: XRFrame) => {
    const renderer = this.renderer;
    if (!renderer) return;

    if (frame) {
      const refSpace = renderer.xr.getReferenceSpace();
      const viewerPose = (refSpace ? frame.getViewerPose(refSpace) : null) ?? null;
      this.updateTracking(viewerPose);
      if (refSpace) {
        this.updateTarget(frame, refSpace, viewerPose);
        if (this.placeRequested) {
          this.placeRequested = false;
          if (this.target && viewerPose) this.placeAtTarget(frame, refSpace, viewerPose);
        }
        this.updateAnchoredObjects(frame, refSpace);
      }
    }
    this.countFrame(time);

    renderer.render(this.scene, this.camera);
  };

  /**
   * Decides what the reticle points at this frame, depending on mode:
   *
   * floor mode: first hit-test result (green when horizontal).
   * wall mode:  1. a vertical hit-test result (real wall detection)
   *             2. else a depth-sensing estimate at the screen centre
   *             3. else a horizontal hit, for the floor-edge fallback
   */
  private updateTarget(frame: XRFrame, refSpace: XRReferenceSpace, viewerPose: XRViewerPose | null) {
    let hitTarget: Target | null = null;
    if (this.hitTestSource) {
      const results = frame.getHitTestResults(this.hitTestSource);
      const pose = results.length > 0 ? results[0].getPose(refSpace) : null;
      if (pose) {
        const q = pose.transform.orientation;
        const normal = UP.clone().applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
        const p = pose.transform.position;
        hitTarget = {
          position: new THREE.Vector3(p.x, p.y, p.z),
          normal,
          surface: classifyNormal(normal),
          source: 'hit',
          hit: results[0],
        };
      }
    }

    // Remember the floor height so depth estimates can tell floor from wall.
    if (hitTarget?.surface === 'horizontal') {
      this.floorY = this.floorY === null ? hitTarget.position.y : Math.min(this.floorY, hitTarget.position.y);
    }

    let target: Target | null = hitTarget;
    if (this.mode === 'wall' && (!hitTarget || hitTarget.surface !== 'vertical')) {
      const depthTarget = viewerPose ? this.estimateWallFromDepth(frame, viewerPose) : null;
      if (depthTarget) target = depthTarget;
    }

    this.target = this.smoothTarget(target);
    this.applyReticle(this.target);
  }

  /** Grabs CPU depth info for this frame, or null. Disables depth on failure. */
  private getDepth(frame: XRFrame, view: XRView): CpuDepthInformation | null {
    if (!this.depthAvailable) return null;
    try {
      return (frame as DepthCapableFrame).getDepthInformation?.(view) ?? null;
    } catch {
      // Device said yes to depth-sensing but cannot deliver CPU data.
      this.depthAvailable = false;
      this.emit({ type: 'depth', available: false });
      return null;
    }
  }

  /**
   * Converts a depth sample at normalized view coords (origin top-left) into
   * a world-space point. Depth is the distance along the camera's view axis.
   */
  private unprojectDepth(
    depth: CpuDepthInformation,
    x: number,
    y: number,
    invProjection: THREE.Matrix4,
    viewToWorld: THREE.Matrix4,
  ): THREE.Vector3 | null {
    let meters: number;
    try {
      meters = depth.getDepthInMeters(x, y);
    } catch {
      return null;
    }
    if (!Number.isFinite(meters) || meters < DEPTH_MIN || meters > DEPTH_MAX) return null;
    // Point on the view ray in camera space, then scaled to the sampled depth.
    const p = new THREE.Vector3(2 * x - 1, 1 - 2 * y, 0.5).applyMatrix4(invProjection);
    if (p.z >= 0) return null;
    p.multiplyScalar(meters / -p.z);
    return p.applyMatrix4(viewToWorld);
  }

  /**
   * Fits a vertical plane through depth samples along the screen's centre
   * line and returns its normal, pointing toward the camera. Null when the
   * samples do not line up (corner, furniture in the way, too few samples).
   */
  private fitWallNormal(
    depth: CpuDepthInformation,
    invProjection: THREE.Matrix4,
    viewToWorld: THREE.Matrix4,
    camPos: THREE.Vector3,
  ): THREE.Vector3 | null {
    const pts: THREE.Vector3[] = [];
    for (const x of DEPTH_SAMPLE_XS) {
      const p = this.unprojectDepth(depth, x, 0.5, invProjection, viewToWorld);
      if (p) pts.push(p);
    }
    if (pts.length < 3) return null;

    // 2D principal direction in the XZ (floor) plane.
    let mx = 0;
    let mz = 0;
    for (const p of pts) {
      mx += p.x;
      mz += p.z;
    }
    mx /= pts.length;
    mz /= pts.length;
    let sxx = 0;
    let sxz = 0;
    let szz = 0;
    for (const p of pts) {
      const dx = p.x - mx;
      const dz = p.z - mz;
      sxx += dx * dx;
      sxz += dx * dz;
      szz += dz * dz;
    }
    const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const dir = new THREE.Vector2(Math.cos(theta), Math.sin(theta));
    const perp = new THREE.Vector2(-dir.y, dir.x);

    let minT = Infinity;
    let maxT = -Infinity;
    for (const p of pts) {
      const dx = p.x - mx;
      const dz = p.z - mz;
      if (Math.abs(dx * perp.x + dz * perp.y) > WALL_FIT_TOLERANCE) return null;
      const t = dx * dir.x + dz * dir.y;
      minT = Math.min(minT, t);
      maxT = Math.max(maxT, t);
    }
    if (maxT - minT < WALL_FIT_MIN_SPAN) return null;

    const normal = new THREE.Vector3(perp.x, 0, perp.y).normalize();
    // Face the camera.
    if (normal.dot(new THREE.Vector3(camPos.x - mx, 0, camPos.z - mz)) < 0) normal.negate();
    return normal;
  }

  /**
   * Estimates a wall under the screen centre from depth sensing. Checks that
   * the surface is upright (not the floor) and fits its direction from
   * several samples so the TV lies flat on the wall whatever the viewing
   * angle. Falls back to "facing the user" when the fit is unreliable.
   */
  private estimateWallFromDepth(frame: XRFrame, viewerPose: XRViewerPose): Target | null {
    const view = viewerPose.views[0];
    if (!view) return null;
    const depth = this.getDepth(frame, view);
    if (!depth) return null;

    const invProjection = new THREE.Matrix4().fromArray(view.projectionMatrix).invert();
    const viewToWorld = new THREE.Matrix4().fromArray(view.transform.matrix);
    const t = viewerPose.transform.position;
    const camPos = new THREE.Vector3(t.x, t.y, t.z);

    const center = this.unprojectDepth(depth, 0.5, 0.5, invProjection, viewToWorld);
    if (!center) return null;

    // Reject the floor: anything close to the known floor height is not a wall.
    if (this.floorY !== null && center.y < this.floorY + 0.25) return null;

    // Reject non-upright surfaces: points above and below the centre must be
    // stacked vertically, not spread out in depth like a floor or table.
    const top = this.unprojectDepth(depth, 0.5, 0.35, invProjection, viewToWorld);
    const bottom = this.unprojectDepth(depth, 0.5, 0.65, invProjection, viewToWorld);
    if (top && bottom) {
      const v = bottom.clone().sub(top);
      const len = v.length();
      if (len > 1e-3 && Math.abs(v.y) / len < 0.7) return null;
    }

    let normal = this.fitWallNormal(depth, invProjection, viewToWorld, camPos);
    if (!normal) {
      normal = new THREE.Vector3(camPos.x - center.x, 0, camPos.z - center.z);
      if (normal.lengthSq() < 1e-4) return null;
      normal.normalize();
    }
    return { position: center, normal, surface: 'vertical', source: 'depth', hit: null };
  }

  /** Wall direction from depth for the floor-edge fallback, if measurable. */
  private wallNormalFromDepth(frame: XRFrame, viewerPose: XRViewerPose): THREE.Vector3 | null {
    const view = viewerPose.views[0];
    if (!view) return null;
    const depth = this.getDepth(frame, view);
    if (!depth) return null;
    const invProjection = new THREE.Matrix4().fromArray(view.projectionMatrix).invert();
    const viewToWorld = new THREE.Matrix4().fromArray(view.transform.matrix);
    const t = viewerPose.transform.position;
    return this.fitWallNormal(depth, invProjection, viewToWorld, new THREE.Vector3(t.x, t.y, t.z));
  }

  /**
   * Blends the new target into the previous one so the reticle, and the
   * pose used for placement, do not jitter with per-frame depth noise.
   */
  private smoothTarget(next: Target | null): Target | null {
    const prev = this.target;
    if (!next) return null;
    if (
      prev &&
      prev.source === next.source &&
      prev.surface === next.surface &&
      prev.position.distanceTo(next.position) < RETICLE_RESET_DISTANCE
    ) {
      prev.position.lerp(next.position, RETICLE_SMOOTHING);
      prev.normal.lerp(next.normal, RETICLE_SMOOTHING).normalize();
      prev.hit = next.hit;
      return prev;
    }
    return next;
  }

  private applyReticle(target: Target | null) {
    let next: ReticleState = { visible: false, surface: null, source: null };
    if (target) {
      const q = quatWithUpAxis(target.normal);
      this.reticle.matrix.compose(target.position, q, new THREE.Vector3(1, 1, 1));
      next = { visible: true, surface: target.surface, source: target.source };
    }
    this.reticle.visible = next.visible;

    const changed =
      next.visible !== this.reticleState.visible ||
      next.surface !== this.reticleState.surface ||
      next.source !== this.reticleState.source;
    if (!changed) return;

    this.reticleState = next;
    const mat = this.reticleRing.material as THREE.MeshBasicMaterial;
    const placeable = this.isPlaceable(next);
    // Green: ready. Blue: depth estimate. Amber: not the surface this mode wants.
    mat.color.setHex(next.source === 'depth' ? 0x4f8cff : placeable ? 0x37c978 : 0xf5b942);
    this.emit({ type: 'reticle', reticle: next });
  }

  private isPlaceable(r: ReticleState): boolean {
    if (!r.visible) return false;
    if (this.mode === 'floor') return r.surface === 'horizontal' && r.source === 'hit';
    // Wall mode accepts a wall (real or estimated) or the floor-edge fallback.
    return r.surface === 'vertical' || r.surface === 'horizontal';
  }

  private placeAtTarget(frame: XRFrame, refSpace: XRReferenceSpace, viewerPose: XRViewerPose) {
    const target = this.target!;
    if (!this.isPlaceable(this.reticleState)) return;

    if (this.mode === 'floor') {
      const root = new THREE.Group();
      root.matrixAutoUpdate = false;
      root.matrix.compose(target.position, quatWithUpAxis(target.normal), new THREE.Vector3(1, 1, 1));
      root.add(createCube());
      this.addPlaced({ root, anchor: null, kind: 'cube', wallMethod: null });
      this.anchorToHit(target.hit, this.placed[this.placed.length - 1]);
      return;
    }

    // Wall mode: work out the mounting pose and how we got it.
    let position: THREE.Vector3;
    let normal: THREE.Vector3;
    let method: WallMethod;
    if (target.surface === 'vertical') {
      position = target.position.clone();
      normal = target.normal.clone();
      method = target.source === 'hit' ? 'wall-hit' : 'depth';
    } else {
      // Floor-edge fallback: the reticle is on the floor where it meets the
      // wall. Mount the TV above that point. Use the wall direction from
      // depth when it can be measured, otherwise face the user.
      const fitted = this.wallNormalFromDepth(frame, viewerPose);
      if (fitted) {
        normal = fitted;
      } else {
        const t = viewerPose.transform.position;
        normal = new THREE.Vector3(t.x - target.position.x, 0, t.z - target.position.z);
        if (normal.lengthSq() < 1e-4) return;
        normal.normalize();
      }
      position = target.position.clone().add(new THREE.Vector3(0, WALL_TV_HEIGHT, 0));
      method = 'floor-edge';
    }

    const quat = quatFacing(normal);
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    root.matrix.compose(position, quat, new THREE.Vector3(1, 1, 1));
    root.add(createTv());
    const obj: PlacedObject = { root, anchor: null, kind: 'tv', wallMethod: method };
    this.lastWallMethod = method;
    this.addPlaced(obj);

    if (method === 'wall-hit') {
      // A plane-attached anchor: the TV follows ARCore's refinements of the wall.
      // Its pose is the hit pose, so re-express the TV pose relative to it.
      this.anchorToHit(target.hit, obj, { position, quat });
    } else {
      this.anchorToPose(frame, refSpace, obj, position, quat);
    }
  }

  private addPlaced(obj: PlacedObject) {
    this.scene.add(obj.root);
    this.placed.push(obj);
    this.emitObjects();
  }

  /**
   * Anchors `obj` to a hit-test result. When the object's pose differs from
   * the hit pose, the model is re-parented with the offset so that the root
   * can track the anchor directly.
   */
  private anchorToHit(
    hit: XRHitTestResult | null,
    obj: PlacedObject,
    desired?: { position: THREE.Vector3; quat: THREE.Quaternion },
  ) {
    const anchorable = hit as AnchorCapableHit | null;
    if (!this.anchorsAvailable || !anchorable || typeof anchorable.createAnchor !== 'function') return;

    if (desired) {
      // root will follow the anchor (hit pose); put the model under an inner
      // group carrying the offset from hit pose to desired pose.
      const hitPose = new THREE.Matrix4().copy(obj.root.matrix);
      const desiredM = new THREE.Matrix4().compose(desired.position, desired.quat, new THREE.Vector3(1, 1, 1));
      const offset = new THREE.Matrix4().copy(hitPose).invert().multiply(desiredM);
      const inner = new THREE.Group();
      inner.matrixAutoUpdate = false;
      inner.matrix.copy(offset);
      for (const child of [...obj.root.children]) inner.add(child);
      obj.root.add(inner);
    }

    anchorable
      .createAnchor()
      .then((anchor) => this.attachAnchor(obj, anchor))
      .catch(() => {
        // Anchor failed: the object keeps its static pose.
      });
  }

  /** Anchors `obj` at an arbitrary pose (depth or floor-edge placements). */
  private anchorToPose(
    frame: XRFrame,
    refSpace: XRReferenceSpace,
    obj: PlacedObject,
    position: THREE.Vector3,
    quat: THREE.Quaternion,
  ) {
    const f = frame as AnchorCapableFrame;
    if (!this.anchorsAvailable || typeof f.createAnchor !== 'function') return;
    try {
      const transform = new XRRigidTransform(
        { x: position.x, y: position.y, z: position.z, w: 1 },
        { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
      );
      f.createAnchor(transform, refSpace)
        .then((anchor) => this.attachAnchor(obj, anchor))
        .catch(() => {
          // Keep static pose.
        });
    } catch {
      // XRRigidTransform or createAnchor unavailable: keep static pose.
    }
  }

  private attachAnchor(obj: PlacedObject, anchor: XRAnchor) {
    if (!this.placed.includes(obj)) {
      anchor.delete();
      return;
    }
    obj.anchor = anchor;
    this.emitObjects();
  }

  private updateAnchoredObjects(frame: XRFrame, refSpace: XRReferenceSpace) {
    for (const obj of this.placed) {
      if (!obj.anchor) continue;
      const pose = frame.getPose(obj.anchor.anchorSpace, refSpace);
      // If the anchor is momentarily untracked we keep the last pose rather
      // than hiding the object: flicker is worse than a brief drift.
      if (pose) obj.root.matrix.fromArray(pose.transform.matrix);
    }
  }

  private emitObjects() {
    this.emit({
      type: 'objects',
      count: this.placed.length,
      anchored: this.placed.filter((o) => o.anchor !== null).length,
      lastWallMethod: this.lastWallMethod,
    });
  }

  private onSelect = () => {
    // Screen tap outside the overlay controls (controls call preventDefault
    // on beforexrselect, so they never reach here).
    this.placeRequested = true;
  };

  private countFrame(time: number) {
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
   * Tracking state with hysteresis: a good pose switches to "tracking" at
   * once, but "limited" and "lost" only after the condition persists for a
   * number of frames, so a brief dropout near a plain wall does not flash
   * the status and alarm the user.
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

  private onVisibilityChange = () => {
    if (!this.session) return;
    this.emit({ type: 'visibility', state: this.session.visibilityState });
  };

  private onSessionEnd = () => {
    const session = this.session;
    if (session) {
      session.removeEventListener('end', this.onSessionEnd);
      session.removeEventListener('visibilitychange', this.onVisibilityChange);
      session.removeEventListener('select', this.onSelect);
    }
    this.session = null;
    this.cleanupSession();
    this.emit({ type: 'ended', reason: this.endedByUser ? 'user' : 'browser' });
  };

  private cleanupSession() {
    // Placed objects do not survive the session: their poses are relative
    // to this session's tracking origin and anchors die with the session.
    for (const obj of this.placed) {
      this.scene.remove(obj.root);
      obj.anchor?.delete();
    }
    this.placed = [];
    this.lastWallMethod = null;

    this.hitTestSource?.cancel();
    this.hitTestSource = null;
    this.target = null;
    this.floorY = null;
    this.reticle.visible = false;
    this.reticleState = { visible: false, surface: null, source: null };

    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
  }
}
