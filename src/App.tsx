import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArEngine } from './ar/ArEngine';
import {
  describeArError,
  type ArError,
  type PlacementMode,
  type ReticleState,
  type SessionInfo,
  type TrackingState,
  type WallMethod,
  type WallSetupState,
} from './ar/types';
import ArOverlay from './components/ArOverlay';
import Landing from './components/Landing';

type Screen = 'landing' | 'ar';

const UI_PREVIEW = new URLSearchParams(window.location.search).get('ui') === 'preview';

const NO_RETICLE: ReticleState = { visible: false, surface: null, source: null, distance: null };

const DEPTH_PREF_KEY = 'webar.useDepth';

function readDepthPref(): boolean {
  try {
    return localStorage.getItem(DEPTH_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const engineRef = useRef<ArEngine | null>(null);
  if (!engineRef.current) engineRef.current = new ArEngine();
  const engine = engineRef.current;

  const canvasHost = useRef<HTMLDivElement>(null);
  // State, not a ref, so the portal below re-renders once the element exists.
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);

  const [screen, setScreen] = useState<Screen>(UI_PREVIEW ? 'ar' : 'landing');
  const [notice, setNotice] = useState<ArError | null>(null);
  const [useDepth, setUseDepth] = useState<boolean>(readDepthPref);
  const [tracking, setTracking] = useState<TrackingState>(UI_PREVIEW ? 'tracking' : 'initializing');
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [visibility, setVisibility] = useState<XRVisibilityState>('visible');
  const [fps, setFps] = useState(0);
  const [mode, setMode] = useState<PlacementMode>('floor');
  const [reticle, setReticle] = useState<ReticleState>(
    UI_PREVIEW ? { visible: true, surface: 'horizontal', source: 'hit', distance: 1.5 } : NO_RETICLE,
  );
  const [depthAvailable, setDepthAvailable] = useState(false);
  const [wallSetup, setWallSetup] = useState<WallSetupState>('none');
  const [objectCount, setObjectCount] = useState(0);
  const [anchoredCount, setAnchoredCount] = useState(0);
  const [lastWallMethod, setLastWallMethod] = useState<WallMethod | null>(null);

  useEffect(() => {
    return engine.subscribe((e) => {
      switch (e.type) {
        case 'started':
          setInfo(e.info);
          setDepthAvailable(e.info.depthSensingSupported);
          setTracking('initializing');
          setVisibility('visible');
          setReticle(NO_RETICLE);
          setObjectCount(0);
          setAnchoredCount(0);
          setLastWallMethod(null);
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
        case 'reticle':
          setReticle(e.reticle);
          break;
        case 'depth':
          setDepthAvailable(e.available);
          break;
        case 'wall':
          setWallSetup(e.state);
          break;
        case 'objects':
          setObjectCount(e.count);
          setAnchoredCount(e.anchored);
          setLastWallMethod(e.lastWallMethod);
          break;
        case 'ended':
          setScreen('landing');
          setInfo(null);
          setReticle(NO_RETICLE);
          setWallSetup('none');
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

  const handleDepthChange = (value: boolean) => {
    setUseDepth(value);
    try {
      localStorage.setItem(DEPTH_PREF_KEY, value ? '1' : '0');
    } catch {
      // Private mode or storage blocked: the choice just lasts this visit.
    }
  };

  // Called synchronously from the Start button tap so user activation is kept.
  const handleStart = () => {
    if (!canvasHost.current || !overlayRoot) return;
    setNotice(null);
    setScreen('ar');
    engine.setMode(mode);
    engine.start(canvasHost.current, overlayRoot, { useDepth }).catch((err) => {
      // 'error' event already carried the friendly message; this is a safety net.
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

  const handleModeChange = (next: PlacementMode) => {
    setMode(next);
    engine.setMode(next);
    if (UI_PREVIEW) {
      setReticle({ visible: true, surface: 'horizontal', source: 'hit', distance: 1.5 });
    }
  };

  const handlePlace = () => {
    if (UI_PREVIEW) {
      if (mode === 'wall' && wallSetup === 'none') setWallSetup('first-point');
      else if (mode === 'wall' && wallSetup === 'first-point') setWallSetup('defined');
      else {
        setObjectCount((c) => c + 1);
        if (mode === 'wall') setLastWallMethod('wall-line');
      }
      return;
    }
    engine.requestPlace();
  };

  const handleResetWall = () => {
    if (UI_PREVIEW) {
      setWallSetup('none');
      return;
    }
    engine.resetWall();
  };

  const handleStatsToggle = useCallback((open: boolean) => engine.setStatsEnabled(open), [engine]);

  const handleClear = () => {
    if (UI_PREVIEW) {
      setObjectCount(0);
      setLastWallMethod(null);
      return;
    }
    engine.clearObjects();
  };

  return (
    <>
      {screen === 'landing' && (
        <Landing onStart={handleStart} notice={notice} useDepth={useDepth} onDepthChange={handleDepthChange} />
      )}

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
            mode={mode}
            reticle={reticle}
            depthAvailable={depthAvailable}
            wallSetup={wallSetup}
            objectCount={objectCount}
            anchoredCount={anchoredCount}
            lastWallMethod={lastWallMethod}
            onModeChange={handleModeChange}
            onPlace={handlePlace}
            onResetWall={handleResetWall}
            onClear={handleClear}
            onExit={handleExit}
            onStatsToggle={handleStatsToggle}
            previewMode={UI_PREVIEW}
          />,
          overlayRoot,
        )}
    </>
  );
}
