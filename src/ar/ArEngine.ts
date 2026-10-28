import * as THREE from 'three';
import {
  describeArError,
  type EngineEvent,
  type EngineListener,
  type SessionInfo,
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

/**
 * Owns the WebXR session, the Three.js renderer and the render loop.
 *
 * It is deliberately not a React component: the render loop runs at device
 * frame rate and must not cause React re-renders. React only hears about
 * discrete changes (session started, tracking state changed, session ended)
 * through the listener API.
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

  /** Phase 2 test object: proves tracking holds while the user walks around. */
  private testCube: THREE.Mesh | null = null;
  private testCubePlaced = false;

  /** Frame counter for the FPS readout in the details panel. */
  private frameCount = 0;
  private fpsWindowStart = 0;

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
    this.testCubePlaced = false;
    this.frameCount = 0;
    this.fpsWindowStart = 0;

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

    renderer.xr.setReferenceSpaceType('local');
    // Render the AR layer at a lower internal resolution on large or very
    // high-DPI screens. Big tablets otherwise push 5+ megapixels per frame.
    const renderScale = computeRenderScale();
    renderer.xr.setFramebufferScaleFactor(renderScale);
    await renderer.xr.setSession(session);

    this.addTestCube();
    renderer.setAnimationLoop(this.onFrame);

    this.emit({ type: 'started', info: this.collectSessionInfo(session, renderScale) });
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
      renderScale,
    };
  }

  private addTestCube() {
    const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const material = new THREE.MeshStandardMaterial({ color: 0x4f8cff, roughness: 0.5 });
    const cube = new THREE.Mesh(geometry, material);
    cube.visible = false;
    this.scene.add(cube);
    this.testCube = cube;
  }

  private placeTestCubeInFrontOfCamera() {
    if (!this.renderer || !this.testCube) return;
    const xrCamera = this.renderer.xr.getCamera();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCamera.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    this.testCube.position.copy(xrCamera.position).addScaledVector(forward, 1.0);
    this.testCube.position.y -= 0.2;
    this.testCube.visible = true;
    this.testCubePlaced = true;
  }

  private onFrame = (_time: number, frame?: XRFrame) => {
    const renderer = this.renderer;
    if (!renderer) return;

    if (frame) this.updateTracking(frame);
    this.countFrame(_time);

    if (this.testCube) this.testCube.rotation.y += 0.01;

    renderer.render(this.scene, this.camera);
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

    if (next === 'tracking' && !this.testCubePlaced) {
      this.placeTestCubeInFrontOfCamera();
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
    }
    this.session = null;
    this.cleanupGpu();
    this.emit({ type: 'ended', reason: this.endedByUser ? 'user' : 'browser' });
  };

  private cleanupGpu() {
    if (this.testCube) {
      this.scene.remove(this.testCube);
      this.testCube.geometry.dispose();
      (this.testCube.material as THREE.Material).dispose();
      this.testCube = null;
    }
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
  }
}
