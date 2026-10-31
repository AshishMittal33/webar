import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { GestureEvent } from '../ar/ArEngine';
import { CATALOGUE } from '../ar/models';
import type { ObjectKind, ObjectSummary, SessionInfo, TrackingState } from '../ar/types';

interface ArOverlayProps {
  tracking: TrackingState;
  info: SessionInfo | null;
  visibility: XRVisibilityState;
  /** Rendered frames per second, updated once a second. 0 until measured. */
  fps: number;
  floorKnown: boolean;
  objects: ObjectSummary[];
  selectedId: string | null;
  canUndo: boolean;
  /** When false, touching the screen can select objects but never move them. */
  touchEdit: boolean;
  onTouchEditChange: (enabled: boolean) => void;
  onSpawn: (kind: ObjectKind) => void;
  onNudge: (dx: number, dy: number, dz: number) => void;
  onRotate: (degrees: number) => void;
  onFaceUser: () => void;
  onScale: (factor: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDeselect: () => void;
  onUndo: () => void;
  onClear: () => void;
  onGesture: (e: GestureEvent) => void;
  onExit: () => void;
  /** Called when the details panel opens or closes (fps stats cost redraws). */
  onStatsToggle: (open: boolean) => void;
  /** True when rendered without a session, only to look at the UI. */
  previewMode?: boolean;
}

const TRACKING_LABEL: Record<TrackingState, string> = {
  initializing: 'Initialising',
  tracking: 'Tracking',
  limited: 'Limited',
  lost: 'Lost',
};

/** Fraction of screen width at each side where gripping thumbs rest. */
const GRIP_EDGE = 0.1;
/** Contact size in CSS px above which a touch is treated as a palm. */
const PALM_SIZE_PX = 60;

/** Step sizes for the precise buttons. */
const STEP_M = 0.05;
const STEP_DEG = 10;
const STEP_SCALE = 1.1;

function guidance(tracking: TrackingState, hasObjects: boolean, hasSelection: boolean, touchEdit: boolean): string {
  if (tracking === 'initializing') return 'Move your phone slowly over the floor to scan the area.';
  if (tracking === 'lost')
    return 'Camera tracking paused, objects hidden until it resumes. Aim at something with texture and move slowly.';
  if (tracking === 'limited') return 'Tracking is weak here. Move slowly; textured surfaces help.';
  if (!hasObjects) return 'Tap + TV or + Box to add an object in front of you.';
  if (!hasSelection) return 'Tap an object to select it.';
  if (touchEdit)
    return 'Touch move is ON: drag with a finger on the object, add a second finger to pinch, twist or push. Turn it off when done.';
  return 'Locked: touching the screen will not move it. Use the buttons, or turn Touch move on to drag, pinch and twist.';
}

/**
 * UI drawn on top of the camera feed through the WebXR dom-overlay feature.
 * The gesture layer covers the whole screen behind the controls and turns
 * pointer events into engine gestures. Everything here calls preventDefault
 * on "beforexrselect" so taps never reach the XR session.
 */
export default function ArOverlay({
  tracking,
  info,
  visibility,
  fps,
  floorKnown,
  objects,
  selectedId,
  canUndo,
  touchEdit,
  onTouchEditChange,
  onSpawn,
  onNudge,
  onRotate,
  onFaceUser,
  onScale,
  onDuplicate,
  onDelete,
  onDeselect,
  onUndo,
  onClear,
  onGesture,
  onExit,
  onStatsToggle,
  previewMode,
}: ArOverlayProps) {
  const [showInfo, setShowInfo] = useState(false);
  const uiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onStatsToggle(showInfo);
  }, [showInfo, onStatsToggle]);

  useEffect(() => {
    const el = uiRef.current;
    if (!el) return;
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener('beforexrselect', stop);
    return () => el.removeEventListener('beforexrselect', stop);
  }, []);

  const paused = visibility !== 'visible';
  const selected = objects.find((o) => o.id === selectedId) ?? null;
  const selectedIndex = selected ? objects.indexOf(selected) + 1 : 0;

  // Touches from the hands holding the device: thumbs resting near the left
  // and right edges, or a palm (large contact area). These are dropped so
  // walking around with the tablet in both hands never moves an object.
  const ignoredPointers = useRef(new Set<number>());

  const gesture = (type: GestureEvent['type']) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (type === 'down') {
      const w = window.innerWidth;
      const inGripZone = e.clientX < w * GRIP_EDGE || e.clientX > w * (1 - GRIP_EDGE);
      const isPalm = e.pointerType === 'touch' && Math.max(e.width, e.height) > PALM_SIZE_PX;
      if (inGripZone || isPalm) {
        ignoredPointers.current.add(e.pointerId);
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (ignoredPointers.current.has(e.pointerId)) {
      if (type === 'up' || type === 'cancel') ignoredPointers.current.delete(e.pointerId);
      return;
    }
    onGesture({ type, id: e.pointerId, x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
  };

  return (
    <div className={`ar-ui${previewMode ? ' preview' : ''}`} ref={uiRef}>
      <div
        className="ar-gesture"
        onPointerDown={gesture('down')}
        onPointerMove={gesture('move')}
        onPointerUp={gesture('up')}
        onPointerCancel={gesture('cancel')}
      />

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
              <div className="hint">Floor height: {floorKnown ? 'known' : 'not yet (boxes spawn 1.4 m below eye)'}</div>
              <div className="hint">Objects: {objects.length}</div>
              <div className="hint">Anchors: {info.anchorsSupported ? 'supported' : 'unavailable'}</div>
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
          {paused
            ? 'AR is paused. Return to this tab to continue.'
            : guidance(tracking, objects.length > 0, !!selected, touchEdit)}
        </div>

        {selected ? (
          <section className="ar-pad">
            <div className="ar-pad-title">
              <span>
                {selected.kind === 'tv' ? 'TV' : 'Box'} {selectedIndex} of {objects.length}
              </span>
              <div className="ar-pad-title-actions">
                <button
                  className={`ar-chip ${touchEdit ? 'on' : 'off'}`}
                  aria-pressed={touchEdit}
                  onClick={() => onTouchEditChange(!touchEdit)}
                >
                  Touch move: {touchEdit ? 'ON' : 'OFF'}
                </button>
                <button className="ar-chip" onClick={onDeselect}>
                  Done
                </button>
              </div>
            </div>
            <div className="ar-pad-grid">
              <button onClick={() => onNudge(-STEP_M, 0, 0)}>◀ Left</button>
              <button onClick={() => onNudge(0, STEP_M, 0)}>▲ Up</button>
              <button onClick={() => onNudge(STEP_M, 0, 0)}>Right ▶</button>
              <button onClick={() => onNudge(0, 0, -STEP_M)}>Closer</button>
              <button onClick={() => onNudge(0, -STEP_M, 0)}>▼ Down</button>
              <button onClick={() => onNudge(0, 0, STEP_M)}>Farther</button>
              <button onClick={() => onRotate(-STEP_DEG)}>⟲ Rotate</button>
              <button onClick={onFaceUser}>Face me</button>
              <button onClick={() => onRotate(STEP_DEG)}>Rotate ⟳</button>
              <button onClick={() => onScale(1 / STEP_SCALE)}>− Size</button>
              <button onClick={onDuplicate}>Duplicate</button>
              <button onClick={() => onScale(STEP_SCALE)}>+ Size</button>
            </div>
            <div className="ar-pad-row">
              <button className="ar-danger" onClick={onDelete}>
                Delete
              </button>
              <button disabled={!canUndo} onClick={onUndo}>
                Undo
              </button>
            </div>
          </section>
        ) : (
          <div className="ar-actions">
            {CATALOGUE.map((m) => (
              <button key={m.kind} className="ar-place" onClick={() => onSpawn(m.kind)}>
                + {m.label}
              </button>
            ))}
            {canUndo && (
              <button className="ar-secondary" onClick={onUndo}>
                Undo
              </button>
            )}
            {objects.length > 0 && (
              <button className="ar-secondary" onClick={onClear}>
                Clear
              </button>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
