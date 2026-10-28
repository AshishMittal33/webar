import { useEffect, useRef, useState } from 'react';
import type { SessionInfo, TrackingState } from '../ar/types';

interface ArOverlayProps {
  tracking: TrackingState;
  info: SessionInfo | null;
  visibility: XRVisibilityState;
  /** Rendered frames per second, updated once a second. 0 until measured. */
  fps: number;
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

const TRACKING_GUIDE: Record<TrackingState, string> = {
  initializing: 'Move your phone slowly to scan the area.',
  tracking: 'Tracking OK. The blue test cube should stay in place as you walk around it.',
  limited: 'Tracking is limited. Move slowly and point the camera at textured surfaces.',
  lost: 'Tracking lost. Move your phone slowly and improve the lighting.',
};

/**
 * UI drawn on top of the camera feed through the WebXR dom-overlay feature.
 * Everything interactive calls preventDefault on "beforexrselect" so taps on
 * buttons never reach the XR session as placement taps (needed from Phase 3).
 */
export default function ArOverlay({
  tracking,
  info,
  visibility,
  fps,
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
              <div className="hint">Blend mode: {info.environmentBlendMode}</div>
              <div className="hint">Reference space: {info.referenceSpace}</div>
              <div className="hint">Render rate: {fps ? `${fps} fps` : 'measuring'}</div>
              <div className="hint">Screen: {window.innerWidth}x{window.innerHeight} @ {window.devicePixelRatio}x</div>
            </>
          ) : (
            <div className="hint">Waiting for session to start.</div>
          )}
        </section>
      )}

      <footer className="ar-bottom">
        <div className="ar-guide">{paused ? 'AR is paused. Return to this tab to continue.' : TRACKING_GUIDE[tracking]}</div>
      </footer>
    </div>
  );
}
