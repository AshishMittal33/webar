import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { GestureEvent } from '../ar/ArEngine';
import { CATALOGUE, getModelSpec } from '../ar/models';
import type { ObjectKind, ObjectSummary, SessionInfo, TrackingHint, TrackingState } from '../ar/types';
import DebugLogButton from './DebugLogButton';
import {
  AlertIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ChairIcon,
  CheckIcon,
  CloseIcon,
  CloserIcon,
  CopyIcon,
  FaceIcon,
  FartherIcon,
  HandIcon,
  InfoIcon,
  MinusIcon,
  PhoneIcon,
  PlusIcon,
  RestoreIcon,
  RotateLeftIcon,
  RotateRightIcon,
  TableIcon,
  TrashIcon,
  TvIcon,
  UndoIcon,
} from './icons';

interface ArOverlayProps {
  tracking: TrackingState;
  info: SessionInfo | null;
  visibility: XRVisibilityState;
  /** Rendered frames per second, updated once a second. 0 until measured. */
  fps: number;
  floorKnown: boolean;
  /** True until the room scan is complete or skipped. */
  scanning: boolean;
  /** Room scan progress, 0 to 1. */
  scanProgress: number;
  hint: TrackingHint | null;
  objects: ObjectSummary[];
  selectedId: string | null;
  canUndo: boolean;
  /** When false, touching the screen can select objects but never move them. */
  touchEdit: boolean;
  onTouchEditChange: (enabled: boolean) => void;
  onSkipScan: () => void;
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
  /** Put objects whose anchor was lost back in front of the user. */
  onRecoverLost: () => void;
  getDebugLog: () => string;
  onGesture: (e: GestureEvent) => void;
  onExit: () => void;
  /** Called when the details panel opens or closes (fps stats cost redraws). */
  onStatsToggle: (open: boolean) => void;
  /** True when rendered without a session, only to look at the UI. */
  previewMode?: boolean;
}

const TRACKING_LABEL: Record<TrackingState, string> = {
  initializing: 'Starting',
  tracking: 'Tracking',
  limited: 'Weak tracking',
  lost: 'Tracking paused',
};

const HINT_TEXT: Record<TrackingHint, string> = {
  'too-close': 'Very close to the surface. Step back a little to keep tracking.',
  'too-fast': 'Moving too fast. The room map drifts and items can jump. Move the tablet slowly.',
};

const KIND_ICON: Record<ObjectKind, ReactNode> = {
  tv: <TvIcon />,
  chair: <ChairIcon />,
  table: <TableIcon />,
};

/** Fraction of screen width at each side where gripping thumbs rest. */
const GRIP_EDGE = 0.1;
/** Contact size in CSS px above which a touch is treated as a palm. */
const PALM_SIZE_PX = 60;

/** Step sizes for the precise buttons. */
const STEP_M = 0.05;
const STEP_DEG = 10;
const STEP_SCALE = 1.1;

/** A square icon button with a small caption underneath. */
function Tool({
  icon,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'danger' | 'active';
}) {
  return (
    <button className={`tool${tone ? ` ${tone}` : ''}`} onClick={onClick} disabled={disabled} aria-label={label}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ScanPanel({
  progress,
  tracking,
  floorKnown,
  onSkip,
}: {
  progress: number;
  tracking: TrackingState;
  floorKnown: boolean;
  onSkip: () => void;
}) {
  const pct = Math.round(progress * 100);
  const r = 34;
  const circumference = 2 * Math.PI * r;
  return (
    <section className="scan-panel" aria-live="polite">
      <div className="scan-visual">
        <svg viewBox="0 0 80 80" width="92" height="92" className="scan-ring">
          <circle cx="40" cy="40" r={r} className="track" />
          <circle
            cx="40"
            cy="40"
            r={r}
            className="bar"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
          />
        </svg>
        <div className="scan-phone">
          <PhoneIcon width={30} height={30} />
        </div>
      </div>
      <div className="scan-text">
        <strong>{tracking === 'tracking' ? `Scanning room ${pct}%` : 'Getting ready'}</strong>
        <span>
          {floorKnown
            ? 'Floor found. Now slowly sweep across the wall where the TV will go.'
            : 'Point the tablet down at the floor and move it slowly from side to side.'}
        </span>
      </div>
      <button className="link-btn" onClick={onSkip}>
        Skip
      </button>
    </section>
  );
}

/**
 * UI drawn on top of the camera feed through the WebXR dom-overlay feature.
 * The gesture layer covers the whole screen behind the controls and turns
 * pointer events into engine gestures. Everything here calls preventDefault
 * on "beforexrselect" so taps never reach the XR session.
 *
 * Performance note: this layer is composited over the camera every frame,
 * so it uses no backdrop blur and only one small animation (scan phase).
 */
export default function ArOverlay({
  tracking,
  info,
  visibility,
  fps,
  floorKnown,
  scanning,
  scanProgress,
  hint,
  objects,
  selectedId,
  canUndo,
  touchEdit,
  onTouchEditChange,
  onSkipScan,
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
  onRecoverLost,
  getDebugLog,
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
  const lostCount = objects.filter((o) => o.lost).length;
  const canPlace = tracking === 'tracking' && !paused;

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

  const statusClass = paused ? 'limited' : tracking;
  const statusLabel = paused ? 'Paused' : scanning && tracking === 'tracking' ? 'Scanning' : TRACKING_LABEL[tracking];

  let guide: string | null = null;
  if (!scanning && !paused && tracking === 'tracking') {
    if (objects.length === 0) guide = 'Choose an item to place it in front of you.';
    else if (!selected) guide = 'Tap an item in the room to adjust it.';
    else if (touchEdit) guide = 'Touch move on: drag the item with one finger, pinch or twist with two.';
    else guide = 'Item locked to the room. Use the buttons to adjust it.';
  }

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
        <div className={`pill status ${statusClass}`}>
          <span className="dot" />
          {statusLabel}
        </div>
        <div className="ar-top-actions">
          <button
            className={`round-btn${showInfo ? ' active' : ''}`}
            aria-label="Session details"
            onClick={() => setShowInfo((s) => !s)}
          >
            <InfoIcon />
          </button>
          <button className="pill-btn" onClick={onExit}>
            <CloseIcon width={18} height={18} />
            Exit
          </button>
        </div>
      </header>

      {hint && !paused && tracking !== 'lost' && (
        <div className="toast warn" role="status">
          <AlertIcon width={18} height={18} />
          {HINT_TEXT[hint]}
        </div>
      )}

      {showInfo && (
        <section className="ar-panel">
          <div className="panel-head">
            <strong>Session details</strong>
            <button className="round-btn small" aria-label="Close details" onClick={() => setShowInfo(false)}>
              <CloseIcon width={16} height={16} />
            </button>
          </div>
          {info ? (
            <div className="kv">
              <span>Features</span>
              <span>{info.enabledFeatures.join(', ')}</span>
              <span>Anchors</span>
              <span>{info.anchorsSupported ? 'supported' : 'unavailable'}</span>
              <span>Floor</span>
              <span>{floorKnown ? 'found' : 'not yet'}</span>
              <span>Objects</span>
              <span>{objects.length}</span>
              <span>Frame rate</span>
              <span>{fps ? `${fps} fps` : 'measuring'}</span>
              <span>Render scale</span>
              <span>{info.renderScale}</span>
              <span>Screen</span>
              <span>
                {window.innerWidth}×{window.innerHeight} @ {window.devicePixelRatio}x
              </span>
            </div>
          ) : (
            <div className="hint">Waiting for session to start.</div>
          )}
          <DebugLogButton getLog={getDebugLog} />
        </section>
      )}

      {!paused && tracking === 'lost' && !scanning && (
        <section className="center-card" role="status">
          <AlertIcon width={30} height={30} />
          <strong>Tracking paused</strong>
          <span>
            Hold still, then slowly point the tablet back at the area you scanned, from where you were standing. Your
            items come back in their exact place when the tablet recognises it.
          </span>
        </section>
      )}

      <footer className="ar-bottom">
        {paused && <div className="guide">AR is paused. Return to this tab to continue.</div>}

        {!paused && scanning && <ScanPanel progress={scanProgress} tracking={tracking} floorKnown={floorKnown} onSkip={onSkipScan} />}

        {!paused && !scanning && (
          <>
            {lostCount > 0 && (
              <section className="lost-bar">
                <span>
                  {lostCount === 1
                    ? '1 item is waiting to find its place. Slowly point at the area where you put it and hold still. If it does not return, bring it back here.'
                    : `${lostCount} items are waiting to find their place. Slowly point at the area where you put them and hold still. If they do not return, bring them back here.`}
                </span>
                <button className="pill-btn light" disabled={!canPlace} onClick={onRecoverLost}>
                  <RestoreIcon width={18} height={18} />
                  Bring back here
                </button>
              </section>
            )}

            {guide && <div className="guide">{guide}</div>}

            {selected ? (
              <section className="sheet" aria-label={`Adjust ${getModelSpec(selected.kind).label}`}>
                <div className="sheet-head">
                  <div className="sheet-title">
                    <span className="kind-badge">{KIND_ICON[selected.kind]}</span>
                    <div>
                      <strong>
                        {getModelSpec(selected.kind).label} {objects.indexOf(selected) + 1}
                      </strong>
                      <span>{getModelSpec(selected.kind).detail}</span>
                    </div>
                  </div>
                  <button
                    className={`pill-btn toggle${touchEdit ? ' on' : ''}`}
                    aria-pressed={touchEdit}
                    onClick={() => onTouchEditChange(!touchEdit)}
                  >
                    <HandIcon width={18} height={18} />
                    {touchEdit ? 'Touch move on' : 'Touch move off'}
                  </button>
                  <button className="pill-btn primary" onClick={onDeselect}>
                    <CheckIcon width={18} height={18} />
                    Done
                  </button>
                </div>

                <div className="sheet-groups">
                  <div className="group">
                    <span className="group-label">Move</span>
                    <div className="tools grid-3">
                      <Tool icon={<ArrowLeftIcon />} label="Left" onClick={() => onNudge(-STEP_M, 0, 0)} />
                      <Tool icon={<ArrowUpIcon />} label="Up" onClick={() => onNudge(0, STEP_M, 0)} />
                      <Tool icon={<ArrowRightIcon />} label="Right" onClick={() => onNudge(STEP_M, 0, 0)} />
                      <Tool icon={<CloserIcon />} label="Closer" onClick={() => onNudge(0, 0, -STEP_M)} />
                      <Tool icon={<ArrowDownIcon />} label="Down" onClick={() => onNudge(0, -STEP_M, 0)} />
                      <Tool icon={<FartherIcon />} label="Farther" onClick={() => onNudge(0, 0, STEP_M)} />
                    </div>
                  </div>
                  <div className="group">
                    <span className="group-label">Turn and size</span>
                    <div className="tools grid-3">
                      <Tool icon={<RotateLeftIcon />} label="Turn left" onClick={() => onRotate(STEP_DEG)} />
                      <Tool icon={<FaceIcon />} label="Face me" onClick={onFaceUser} />
                      <Tool icon={<RotateRightIcon />} label="Turn right" onClick={() => onRotate(-STEP_DEG)} />
                      <Tool icon={<MinusIcon />} label="Smaller" onClick={() => onScale(1 / STEP_SCALE)} />
                      <Tool icon={<CopyIcon />} label="Duplicate" onClick={onDuplicate} />
                      <Tool icon={<PlusIcon />} label="Bigger" onClick={() => onScale(STEP_SCALE)} />
                    </div>
                  </div>
                </div>

                <div className="sheet-foot">
                  <button className="pill-btn" disabled={!canUndo} onClick={onUndo}>
                    <UndoIcon width={18} height={18} />
                    Undo
                  </button>
                  <button className="pill-btn danger" onClick={onDelete}>
                    <TrashIcon width={18} height={18} />
                    Delete
                  </button>
                </div>
              </section>
            ) : (
              <section className="catalogue" aria-label="Add an item">
                <div className="catalogue-items">
                  {CATALOGUE.map((m) => (
                    <button key={m.kind} className="item-card" disabled={!canPlace} onClick={() => onSpawn(m.kind)}>
                      <span className="item-icon">{KIND_ICON[m.kind]}</span>
                      <span className="item-text">
                        <strong>{m.label}</strong>
                        <span>{m.detail}</span>
                      </span>
                      <span className="item-add">
                        <PlusIcon width={18} height={18} />
                      </span>
                    </button>
                  ))}
                </div>
                {(canUndo || objects.length > 0) && (
                  <div className="catalogue-foot">
                    <button className="pill-btn" disabled={!canUndo} onClick={onUndo}>
                      <UndoIcon width={18} height={18} />
                      Undo
                    </button>
                    {objects.length > 0 && (
                      <button className="pill-btn danger" onClick={onClear}>
                        <TrashIcon width={18} height={18} />
                        Clear all
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
