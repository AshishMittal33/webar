import { useEffect, useRef, useState } from 'react';
import type { ReticleState, SessionInfo, TrackingState } from '../ar/types';

interface ArOverlayProps {
  tracking: TrackingState;
  info: SessionInfo | null;
  visibility: XRVisibilityState;
  /** Rendered frames per second, updated once a second. 0 until measured. */
  fps: number;
  reticle: ReticleState;
  objectCount: number;
  anchoredCount: number;
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

function guidance(tracking: TrackingState, reticle: ReticleState, hitTest: boolean): string {
  if (tracking === 'initializing') return 'Move your phone slowly to scan the area.';
  if (tracking === 'lost') return 'Tracking lost. Move your phone slowly and improve the lighting.';
  if (tracking === 'limited') return 'Tracking is limited. Move slowly and point the camera at textured surfaces.';
  if (!hitTest) return 'This device did not grant hit-testing, so surfaces cannot be detected.';
  if (!reticle.visible) return 'Aim at the floor to place a cube. If nothing appears, move slowly or try another angle.';
  if (reticle.surface === 'horizontal') return 'Floor detected. Tap the screen or press Place.';
  if (reticle.surface === 'vertical') return 'Wall detected. Wall placement comes in the next phase. Aim at the floor.';
  return 'Sloped surface. Aim at a flat floor to place.';
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
  reticle,
  objectCount,
  anchoredCount,
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
  const canPlace = !paused && tracking === 'tracking' && reticle.visible && reticle.surface === 'horizontal';

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
              <div className="hint">Anchors: {info.anchorsSupported ? `supported (${anchoredCount}/${objectCount} anchored)` : 'unavailable'}</div>
              <div className="hint">Reticle surface: {reticle.visible ? reticle.surface : 'none'}</div>
              <div className="hint">Blend mode: {info.environmentBlendMode}</div>
              <div className="hint">Reference space: {info.referenceSpace}</div>
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
          {paused ? 'AR is paused. Return to this tab to continue.' : guidance(tracking, reticle, hitTest)}
        </div>
        <div className="ar-actions">
          {objectCount > 0 && (
            <button className="ar-secondary" onClick={onClear}>
              Clear ({objectCount})
            </button>
          )}
          <button className="ar-place" disabled={!canPlace} onClick={onPlace}>
            Place cube
          </button>
        </div>
      </footer>
    </div>
  );
}
