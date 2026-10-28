import { useEffect, useRef, useState } from 'react';
import type { PlacementMode, ReticleState, SessionInfo, TrackingState, WallMethod } from '../ar/types';

interface ArOverlayProps {
  tracking: TrackingState;
  info: SessionInfo | null;
  visibility: XRVisibilityState;
  /** Rendered frames per second, updated once a second. 0 until measured. */
  fps: number;
  mode: PlacementMode;
  reticle: ReticleState;
  depthAvailable: boolean;
  objectCount: number;
  anchoredCount: number;
  lastWallMethod: WallMethod | null;
  onModeChange: (mode: PlacementMode) => void;
  onPlace: () => void;
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
  'floor-edge': 'floor-edge manual placement',
};

function guidance(mode: PlacementMode, tracking: TrackingState, r: ReticleState, hitTest: boolean): string {
  if (tracking === 'initializing') return 'Move your phone slowly to scan the area.';
  if (tracking === 'lost') return 'Tracking lost. Move your phone slowly and improve the lighting.';
  if (tracking === 'limited') return 'Tracking is limited. Move slowly and point the camera at textured surfaces.';
  if (!hitTest) return 'This device did not grant hit-testing, so surfaces cannot be detected.';

  if (mode === 'floor') {
    if (!r.visible) return 'Aim at the floor to place furniture. If nothing appears, move slowly or try another angle.';
    if (r.surface === 'horizontal') return 'Floor detected. Tap the screen or press Place.';
    if (r.surface === 'vertical') return 'That is a wall. Switch to Wall mode for a TV, or aim at the floor.';
    return 'Sloped surface. Aim at a flat floor to place.';
  }

  // wall mode
  if (!r.visible) return 'Aim at the wall to position a TV. If nothing appears, aim at the bottom of the wall where it meets the floor.';
  if (r.surface === 'vertical' && r.source === 'hit') return 'Wall detected. Tap the screen or press Place to mount the TV.';
  if (r.surface === 'vertical' && r.source === 'depth')
    return 'Wall estimated from depth (automatic wall detection not available here). Place, then adjust.';
  if (r.surface === 'horizontal')
    return 'No wall detected. Manual mode: aim at the line where the wall meets the floor and press Place. The TV is mounted 1.2 m above that point.';
  return 'Aim at a flat wall.';
}

function canPlace(mode: PlacementMode, r: ReticleState): boolean {
  if (!r.visible) return false;
  if (mode === 'floor') return r.surface === 'horizontal' && r.source === 'hit';
  return r.surface === 'vertical' || r.surface === 'horizontal';
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
  objectCount,
  anchoredCount,
  lastWallMethod,
  onModeChange,
  onPlace,
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
              <div className="hint">Depth sensing: {depthAvailable ? 'active' : 'unavailable'}</div>
              <div className="hint">
                Reticle: {reticle.visible ? `${reticle.surface} via ${reticle.source}` : 'none'}
              </div>
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
          {paused ? 'AR is paused. Return to this tab to continue.' : guidance(mode, tracking, reticle, hitTest)}
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
          <button className="ar-place" disabled={!placeable} onClick={onPlace}>
            {mode === 'floor' ? 'Place cube' : 'Place TV'}
          </button>
        </div>
      </footer>
    </div>
  );
}
