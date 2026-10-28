export type TrackingState = 'initializing' | 'tracking' | 'limited' | 'lost';

/**
 * Motion-sensor hold readiness.
 * off: no orientation sensor; calibrating: comparing it with the camera;
 * ready: verified and used while camera tracking is paused;
 * unusable: it did not match the camera, so it is never used.
 */
export type MotionHoldState = 'off' | 'calibrating' | 'ready' | 'unusable';

/** Catalogue entries. More kinds are added in models.ts without touching the engine. */
export type ObjectKind = 'tv' | 'cube';

/** What React needs to know about a placed object. Transforms stay in the engine. */
export interface ObjectSummary {
  id: string;
  kind: ObjectKind;
}

/** Facts about the running session, reported once it has started. */
export interface SessionInfo {
  /** Features the browser actually granted (from XRSession.enabledFeatures). */
  enabledFeatures: string[];
  /** Features we asked for but did not get. */
  missingFeatures: string[];
  environmentBlendMode: string;
  referenceSpace: string;
  domOverlaySupported: boolean;
  /** Hit-testing is used only to learn the floor height for spawning. */
  hitTestSupported: boolean;
  /** Anchors re-attach objects to the room after tracking is lost and found. */
  anchorsSupported: boolean;
  /** WebXR framebuffer scale actually used (1 = native, 0.5 = quarter pixels). */
  renderScale: number;
}

export interface ArError {
  code: string;
  message: string;
  hint: string;
}

export type EngineEvent =
  | { type: 'started'; info: SessionInfo }
  | { type: 'tracking'; state: TrackingState }
  | { type: 'visibility'; state: XRVisibilityState }
  | { type: 'fps'; fps: number }
  | { type: 'floor'; known: boolean }
  | { type: 'hold'; active: boolean }
  | { type: 'sensor'; state: MotionHoldState }
  | { type: 'objects'; objects: ObjectSummary[]; selectedId: string | null }
  | { type: 'ended'; reason: 'user' | 'browser' }
  | { type: 'error'; error: ArError };

export type EngineListener = (event: EngineEvent) => void;

/** Turn a thrown value from requestSession into something a user can act on. */
export function describeArError(err: unknown): ArError {
  const e = err as { name?: string; message?: string };
  const name = e?.name ?? 'Error';
  const message = e?.message ?? String(err);

  switch (name) {
    case 'NotAllowedError':
      return {
        code: name,
        message: 'Camera access was denied.',
        hint: 'AR needs the camera. In Chrome tap the lock icon next to the address, open Permissions, allow Camera, then try again.',
      };
    case 'NotSupportedError':
      return {
        code: name,
        message: 'This device or browser cannot start an AR session.',
        hint: 'Install or update "Google Play Services for AR" (ARCore) from the Play Store and make sure your device is ARCore-certified.',
      };
    case 'SecurityError':
      return {
        code: name,
        message: 'AR could not start for security reasons.',
        hint: 'Open the page over HTTPS and start AR by tapping the button directly.',
      };
    case 'InvalidStateError':
      return {
        code: name,
        message: 'An AR session is already running or the page state is invalid.',
        hint: 'Exit the current session or reload the page, then try again.',
      };
    default:
      return {
        code: name,
        message: `AR session failed: ${message}`,
        hint: 'Reload the page and try again. If it keeps failing, check the device details on the start screen.',
      };
  }
}
