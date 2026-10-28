import { useEffect, useRef, useState } from 'react';
import type {
  PlacementMode,
  ReticleState,
  SessionInfo,
  TrackingState,
  WallMethod,
  WallSetupState,
} from '../ar/types';

interface ArOverlayProps {
  tracking: TrackingState;
  info: SessionInfo | null;
  visibility: XRVisibilityState;
  /** Rendered frames per second, updated once a second. 0 until measured. */
  fps: number;
  mode: PlacementMode;
  reticle: ReticleState;
  depthAvailable: boolean;
  wallSetup: WallSetupState;
  objectCount: number;
  anchoredCount: number;
  lastWallMethod: WallMethod | null;
  onModeChange: (mode: PlacementMode) => void;
  onPlace: () => void;
  onResetWall: () => void;
  onClear: () => void;
  onExit: () => void;
  /** True when rendered without a session, only to look at the UI. */
  previewMode?: boolean;
}

const TRACKING_LABEL: Record<TrackingState, string> = {
  initializing: 'Initialising',
  tracking: 'Tracking',
  limited: 'Limited',
  lost: 'Lost',
};

const WALL_METHOD_LABEL: Record<WallMethod, string> = {
  'wall-hit': 'detected wall',
  depth: 'depth estimate',
  'wall-line': 'wall set by two floor points',
};

/** Closer than this to the target, ARCore tends to lose its features. */
const TOO_CLOSE = 0.7;

function guidance(
  mode: PlacementMode,
  tracking: TrackingState,
  r: ReticleState,
  wall: WallSetupState,
  hitTest: boolean,
): string {
  if (tracking === 'initializing') return 'Move your phone slowly over the floor to scan the area.';
  if (tracking === 'lost')
    return 'Tracking lost. Step back, point at the floor or furniture, and move slowly until it recovers.';
  if (tracking === 'limited')
    return 'Tracking is limited, usually from being too close to a plain wall. Step back and keep some floor in view.';
  if (!hitTest) return 'This device did not grant hit-testing, so surfaces cannot be detected.';
  if (r.visible && r.distance !== null && r.distance < TOO_CLOSE)
    return 'Too close. Step back a little so the camera can keep tracking.';

  if (mode === 'floor') {
    if (!r.visible) return 'Aim at the floor to place furniture. If nothing appears, move slowly or try another angle.';
    if (r.surface === 'horizontal') return 'Floor detected. Tap the screen or press Place.';
    if (r.surface === 'vertical') return 'That is a wall. Switch to Wall mode for a TV, or aim at the floor.';
    return 'Sloped surface. Aim at a flat floor to place.';
  }

  // Wall mode.
  if (r.visible && r.surface === 'vertical' && r.source === 'hit')
    return 'Wall detected. Tap the screen or press Place to mount the TV.';
  if (r.visible && r.surface === 'vertical' && r.source === 'depth')
    return 'Wall estimated from depth. Hold still for a second, then press Place.';

  if (wall === 'none')
    return 'Stand 2 m back. Aim at the line where the wall meets the floor and press "Set wall point 1".';
  if (wall === 'first-point')
    return 'Now aim further along the same wall base, at least half a metre away, and press "Set wall point 2".';
  if (!r.visible) return 'Wall is set. Aim at the floor near the wall to position the TV.';
  if (r.surface === 'horizontal') return 'Aim at the floor below where you want the TV, then press Place TV. It snaps onto the wall.';
  return 'Aim at the floor near the wall.';
}

function canPlace(mode: PlacementMode, r: ReticleState): boolean {
  if (!r.visible) return false;
  if (mode === 'floor') return r.surface === 'horizontal' && r.source === 'hit';
  return r.surface === 'vertical' || r.surface === 'horizontal';
}

function placeLabel(mode: PlacementMode, r: ReticleState, wall: WallSetupState): string {
  if (mode === 'floor') return 'Place cube';
  if (r.visible && r.surface === 'vertical') return 'Place TV';
  if (wall === 'none') return 'Set wall point 1';
  if (wall === 'first-point') return 'Set wall point 2';
  return 'Place TV';
}

/**
 * UI drawn on top of the camera feed through the WebXR dom-overlay feature.
 * Everything interactive calls preventDefault on "beforexrselect" so taps on
 * buttons never reach the XR session as placement taps.
 */
export default function ArOverlay({
  tracking,
  info,
  visibility,
  fps,
  mode,
  reticle,
  depthAvailable,
  wallSetup,
  objectCount,
  anchoredCount,
  lastWallMethod,
  onModeChange,
  onPlace,
  onResetWall,
  onClear,
  onExit,
  previewMode,
}: ArOverlayProps) {
  const [showInfo, setShowInfo] = useState(false);
  const uiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = uiRef.current;
    if (!el) return;
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener('beforexrselect', stop);
    return () => el.removeEventListener('beforexrselect', stop);
  }, []);

  const paused = visibility !== 'visible';
  const hitTest = info?.hitTestSupported ?? previewMode ?? false;
  const placeable = !paused && tracking === 'tracking' && canPlace(mode, reticle);

  return (
    <div className={`ar-ui${previewMode ? ' preview' : ''}`} ref={uiRef}>
      {previewMode && <div className="ar-banner">UI preview only. No AR session is running.</div>}

      <header className="ar-top">
        <div className={`ar-status ${tracking}`}>
          <span className="dot" />
          {paused ? 'Paused' : TRACKING_LABEL[tracking]}
        </div>
        <div className="ar-top-actions">
          <button className="ar-icon-btn" aria-label="Session details" onClick={() => setShowInfo((s) => !s)}>
            i
          </button>
          <button className="ar-exit" onClick={onExit}>
            Exit AR
          </button>
        </div>
      </header>

      {showInfo && (
        <section className="ar-panel">
          <strong>Session details</strong>
          {info ? (
            <>
              <div className="hint">Granted: {info.enabledFeatures.join(', ')}</div>
              <div className="hint">
                Not granted: {info.missingFeatures.length ? info.missingFeatures.join(', ') : 'none'}
              </div>
              <div className="hint">Hit-test: {info.hitTestSupported ? 'active' : 'unavailable'}</div>
              <div className="hint">
                Anchors: {info.anchorsSupported ? `supported (${anchoredCount}/${objectCount} anchored)` : 'unavailable'}
              </div>
              <div className="hint">Depth sensing: {depthAvailable ? 'active' : 'off'}</div>
              <div className="hint">
                Reticle:{' '}
                {reticle.visible
                  ? `${reticle.surface} via ${reticle.source}${reticle.distance !== null ? `, ${reticle.distance} m` : ''}`
                  : 'none'}
              </div>
              <div className="hint">Wall setup: {wallSetup}</div>
              <div className="hint">
                Last wall placement: {lastWallMethod ? WALL_METHOD_LABEL[lastWallMethod] : 'none yet'}
              </div>
              <div className="hint">Blend mode: {info.environmentBlendMode}</div>
              <div className="hint">Render rate: {fps ? `${fps} fps` : 'measuring'}</div>
              <div className="hint">Render scale: {info.renderScale}</div>
              <div className="hint">
                Screen: {window.innerWidth}x{window.innerHeight} @ {window.devicePixelRatio}x
              </div>
            </>
          ) : (
            <div className="hint">Waiting for session to start.</div>
          )}
        </section>
      )}

      <footer className="ar-bottom">
        <div className="ar-guide">
          {paused ? 'AR is paused. Return to this tab to continue.' : guidance(mode, tracking, reticle, wallSetup, hitTest)}
        </div>
        <div className="ar-mode" role="radiogroup" aria-label="Placement mode">
          <button
            className={mode === 'floor' ? 'active' : ''}
            role="radio"
            aria-checked={mode === 'floor'}
            onClick={() => onModeChange('floor')}
          >
            Floor
          </button>
          <button
            className={mode === 'wall' ? 'active' : ''}
            role="radio"
            aria-checked={mode === 'wall'}
            onClick={() => onModeChange('wall')}
          >
            Wall (TV)
          </button>
        </div>
        <div className="ar-actions">
          {objectCount > 0 && (
            <button className="ar-secondary" onClick={onClear}>
              Clear ({objectCount})
            </button>
          )}
          {mode === 'wall' && wallSetup !== 'none' && (
            <button className="ar-secondary" onClick={onResetWall}>
              Reset wall
            </button>
          )}
          <button className="ar-place" disabled={!placeable} onClick={onPlace}>
            {placeLabel(mode, reticle, wallSetup)}
          </button>
        </div>
      </footer>
    </div>
  );
}
