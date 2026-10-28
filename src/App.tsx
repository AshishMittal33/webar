import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArEngine, type GestureEvent } from './ar/ArEngine';
import {
  describeArError,
  type ArError,
  type ObjectKind,
  type ObjectSummary,
  type SessionInfo,
  type TrackingState,
} from './ar/types';
import ArOverlay from './components/ArOverlay';
import Landing from './components/Landing';

type Screen = 'landing' | 'ar';

const UI_PREVIEW = new URLSearchParams(window.location.search).get('ui') === 'preview';

export default function App() {
  const engineRef = useRef<ArEngine | null>(null);
  if (!engineRef.current) engineRef.current = new ArEngine();
  const engine = engineRef.current;

  const canvasHost = useRef<HTMLDivElement>(null);
  // State, not a ref, so the portal below re-renders once the element exists.
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);

  const [screen, setScreen] = useState<Screen>(UI_PREVIEW ? 'ar' : 'landing');
  const [notice, setNotice] = useState<ArError | null>(null);
  const [tracking, setTracking] = useState<TrackingState>(UI_PREVIEW ? 'tracking' : 'initializing');
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [visibility, setVisibility] = useState<XRVisibilityState>('visible');
  const [fps, setFps] = useState(0);
  const [floorKnown, setFloorKnown] = useState(false);
  const [objects, setObjects] = useState<ObjectSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    return engine.subscribe((e) => {
      switch (e.type) {
        case 'started':
          setInfo(e.info);
          setTracking('initializing');
          setVisibility('visible');
          setFloorKnown(false);
          break;
        case 'tracking':
          setTracking(e.state);
          break;
        case 'visibility':
          setVisibility(e.state);
          break;
        case 'fps':
          setFps(e.fps);
          break;
        case 'floor':
          setFloorKnown(e.known);
          break;
        case 'objects':
          setObjects(e.objects);
          setSelectedId(e.selectedId);
          setCanUndo(engine.canUndo);
          break;
        case 'ended':
          setScreen('landing');
          setInfo(null);
          setObjects([]);
          setSelectedId(null);
          setCanUndo(false);
          if (e.reason === 'browser') {
            setNotice({
              code: 'SessionEnded',
              message: 'The AR session was ended by the browser.',
              hint: 'This happens when you switch apps or lock the phone. Tap Start to begin again.',
            });
          }
          break;
        case 'error':
          setNotice(e.error);
          setScreen('landing');
          break;
      }
    });
  }, [engine]);

  // Called synchronously from the Start button tap so user activation is kept.
  const handleStart = () => {
    if (!canvasHost.current || !overlayRoot) return;
    setNotice(null);
    setScreen('ar');
    engine.start(canvasHost.current, overlayRoot).catch((err) => {
      setNotice(describeArError(err));
      setScreen('landing');
    });
  };

  const handleExit = () => {
    if (UI_PREVIEW) {
      setScreen('landing');
      return;
    }
    void engine.end();
  };

  const handleStatsToggle = useCallback((open: boolean) => engine.setStatsEnabled(open), [engine]);

  // In UI preview mode there is no engine session; fake a small object list
  // so the control pad can be looked at on a desktop.
  const previewSpawn = (kind: ObjectKind) => {
    const id = String(objects.length + 1);
    setObjects((o) => [...o, { id, kind }]);
    setSelectedId(id);
    setCanUndo(true);
  };

  const handleSpawn = (kind: ObjectKind) => (UI_PREVIEW ? previewSpawn(kind) : void engine.spawn(kind));
  const handleDeselect = () => (UI_PREVIEW ? setSelectedId(null) : engine.select(null));
  const handleDelete = () => {
    if (UI_PREVIEW) {
      setObjects((o) => o.filter((x) => x.id !== selectedId));
      setSelectedId(null);
      return;
    }
    engine.deleteSelected();
  };
  const handleClear = () => {
    if (UI_PREVIEW) {
      setObjects([]);
      setSelectedId(null);
      setCanUndo(false);
      return;
    }
    engine.clearAll();
  };

  const afterEdit = () => setCanUndo(engine.canUndo);
  const handleNudge = (dx: number, dy: number, dz: number) => {
    engine.nudge(dx, dy, dz);
    afterEdit();
  };
  const handleRotate = (deg: number) => {
    engine.rotate(deg);
    afterEdit();
  };
  const handleFaceUser = () => {
    engine.faceUser();
    afterEdit();
  };
  const handleScale = (f: number) => {
    engine.scaleBy(f);
    afterEdit();
  };
  const handleUndo = () => {
    if (UI_PREVIEW) return;
    engine.undo();
  };
  const handleGesture = useCallback(
    (e: GestureEvent) => {
      engine.handleGesture(e);
      if (e.type === 'up' || e.type === 'cancel') setCanUndo(engine.canUndo);
    },
    [engine],
  );

  return (
    <>
      {screen === 'landing' && <Landing onStart={handleStart} notice={notice} />}

      {/* Always mounted so the engine can attach a canvas and the overlay root
          exists before requestSession is called. */}
      <div ref={canvasHost} className="ar-canvas-host" />
      <div ref={setOverlayRoot} className="ar-overlay-root" />

      {screen === 'ar' &&
        overlayRoot &&
        createPortal(
          <ArOverlay
            tracking={tracking}
            info={info}
            visibility={visibility}
            fps={fps}
            floorKnown={floorKnown}
            objects={objects}
            selectedId={selectedId}
            canUndo={canUndo}
            onSpawn={handleSpawn}
            onNudge={handleNudge}
            onRotate={handleRotate}
            onFaceUser={handleFaceUser}
            onScale={handleScale}
            onDuplicate={() => engine.duplicate()}
            onDelete={handleDelete}
            onDeselect={handleDeselect}
            onUndo={handleUndo}
            onClear={handleClear}
            onGesture={handleGesture}
            onExit={handleExit}
            onStatsToggle={handleStatsToggle}
            previewMode={UI_PREVIEW}
          />,
          overlayRoot,
        )}
    </>
  );
}
