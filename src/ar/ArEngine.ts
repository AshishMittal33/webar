import * as THREE from 'three';
import {
  describeArError,
  type EngineEvent,
  type EngineListener,
  type ReticleState,
  type SessionInfo,
  type SurfaceType,
  type TrackingState,
} from './types';

/**
 * Features we ask the browser for. Only "local" tracking is required so the
 * session can start on every ARCore device; everything else is optional and
 * reported back through SessionInfo so later phases can decide what to use.
 */
const OPTIONAL_FEATURES = ['dom-overlay', 'hit-test', 'anchors', 'light-estimation'];

/** Pixel budget per AR frame, roughly 1080p. Above this we scale down. */
const TARGET_PIXELS = 2_000_000;

/** Phase 3 placeholder object: a 15 cm cube that sits on the surface. */
const CUBE_SIZE = 0.15;

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

/** Classify a hit pose by the direction its +Y axis (surface normal) points. */
function classifySurface(orientation: DOMPointReadOnly): SurfaceType {
  const q = new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);
  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  if (normal.y > 0.75) return 'horizontal';
  if (Math.abs(normal.y) < 0.35) return 'vertical';
  return 'other';
}

interface PlacedObject {
  /** Root whose matrix is the surface pose; children are offset from it. */
  root: THREE.Group;
  anchor: XRAnchor | null;
  surface: SurfaceType;
}

type XRAnchorCapableHit = XRHitTestResult & {
  createAnchor?: () => Promise<XRAnchor>;
};

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

  // Hit-testing and placement
  private hitTestSource: XRHitTestSource | null = null;
  private anchorsAvailable = false;
  private readonly reticle: THREE.Group;
  private readonly reticleRing: THREE.Mesh;
  private reticleState: ReticleState = { visible: false, surface: null };
  private placeRequested = false;
  private placed: PlacedObject[] = [];

  // Shared GPU resources for placeholder cubes (reused across objects)
  private readonly cubeGeometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
  private readonly cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x4f8cff, roughness: 0.6 });

  constructor() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x667799, 1.0);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(0.5, 1, 0.25);
    this.scene.add(hemi, dir);

    // Reticle: flat ring lying on the surface plane. RingGeometry is in XY,
    // so rotate it into XZ where +Y is the surface normal from the hit pose.
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

    const sessionPromise = xr.requestSession('immersive-ar', {
      requiredFeatures: ['local'],
      optionalFeatures: OPTIONAL_FEATURES,
      domOverlay: { root: overlayRoot },
    });

    this.endedByUser = false;
    this.trackingState = 'initializing';
    this.frameCount = 0;
    this.fpsWindowStart = 0;
    this.placeRequested = false;

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
    const withFeatures = session as XRSession & { enabledFeatures?: string[] };
    const enabled = withFeatures.enabledFeatures ?? ['(enabledFeatures not reported by this browser)'];
    const missing = OPTIONAL_FEATURES.filter((f) => !enabled.includes(f));
    return {
      enabledFeatures: enabled,
      missingFeatures: missing,
      environmentBlendMode: session.environmentBlendMode,
      referenceSpace: 'local',
      domOverlaySupported: enabled.includes('dom-overlay'),
      hitTestSupported: enabled.includes('hit-test') && typeof session.requestHitTestSource === 'function',
      anchorsSupported: enabled.includes('anchors'),
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
      this.updateTracking(frame);
      const refSpace = renderer.xr.getReferenceSpace();
      if (refSpace) {
        const hit = this.updateReticle(frame, refSpace);
        if (this.placeRequested) {
          this.placeRequested = false;
          if (hit) this.placeObject(hit, refSpace);
        }
        this.updateAnchoredObjects(frame, refSpace);
      }
    }
    this.countFrame(time);

    renderer.render(this.scene, this.camera);
  };

  /** Moves the reticle to the first hit and returns that hit, or null. */
  private updateReticle(frame: XRFrame, refSpace: XRReferenceSpace): XRHitTestResult | null {
    if (!this.hitTestSource) return null;

    const results = frame.getHitTestResults(this.hitTestSource);
    let next: ReticleState = { visible: false, surface: null };
    let hit: XRHitTestResult | null = null;

    if (results.length > 0) {
      const pose = results[0].getPose(refSpace);
      if (pose) {
        hit = results[0];
        this.reticle.matrix.fromArray(pose.transform.matrix);
        next = { visible: true, surface: classifySurface(pose.transform.orientation) };
      }
    }

    this.reticle.visible = next.visible;
    if (next.visible !== this.reticleState.visible || next.surface !== this.reticleState.surface) {
      this.reticleState = next;
      const mat = this.reticleRing.material as THREE.MeshBasicMaterial;
      // Green: placeable floor. Amber: wall or slope (wall placement is Phase 4).
      mat.color.setHex(next.surface === 'horizontal' ? 0x37c978 : 0xf5b942);
      this.emit({ type: 'reticle', reticle: next });
    }
    return hit;
  }

  private placeObject(hit: XRHitTestResult, refSpace: XRReferenceSpace) {
    const pose = hit.getPose(refSpace);
    if (!pose) return;
    const surface = classifySurface(pose.transform.orientation);
    // Phase 3 scope: floor only. Walls come in Phase 4 with their own rules.
    if (surface !== 'horizontal') return;

    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    root.matrix.fromArray(pose.transform.matrix);

    const cube = new THREE.Mesh(this.cubeGeometry, this.cubeMaterial);
    cube.position.y = CUBE_SIZE / 2; // sit on the surface, not inside it
    root.add(cube);
    this.scene.add(root);

    const obj: PlacedObject = { root, anchor: null, surface };
    this.placed.push(obj);
    this.emitObjects();

    // Anchors let ARCore keep refining the object's real-world position as
    // its understanding of the room improves. Must be created while the hit
    // result's frame is still active, i.e. inside this animation frame.
    const anchorable = hit as XRAnchorCapableHit;
    if (this.anchorsAvailable && typeof anchorable.createAnchor === 'function') {
      anchorable
        .createAnchor()
        .then((anchor) => {
          if (!this.placed.includes(obj)) {
            anchor.delete();
            return;
          }
          obj.anchor = anchor;
          this.emitObjects();
        })
        .catch(() => {
          // Anchor failed: the object simply keeps its static pose.
        });
    }
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

  private updateTracking(frame: XRFrame) {
    const renderer = this.renderer!;
    const refSpace = renderer.xr.getReferenceSpace();
    if (!refSpace) return;

    const pose = frame.getViewerPose(refSpace);
    let next: TrackingState;
    if (!pose) {
      next = this.trackingState === 'initializing' ? 'initializing' : 'lost';
    } else if (pose.emulatedPosition) {
      next = 'limited';
    } else {
      next = 'tracking';
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

    this.hitTestSource?.cancel();
    this.hitTestSource = null;
    this.reticle.visible = false;
    this.reticleState = { visible: false, surface: null };

    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
  }
}
