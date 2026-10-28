import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArEngine } from './ar/ArEngine';
import { describeArError, type ArError, type SessionInfo, type TrackingState } from './ar/types';
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
  const [tracking, setTracking] = useState<TrackingState>('initializing');
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [visibility, setVisibility] = useState<XRVisibilityState>('visible');

  useEffect(() => {
    return engine.subscribe((e) => {
      switch (e.type) {
        case 'started':
          setInfo(e.info);
          setTracking('initializing');
          setVisibility('visible');
          break;
        case 'tracking':
          setTracking(e.state);
          break;
        case 'visibility':
          setVisibility(e.state);
          break;
        case 'ended':
          setScreen('landing');
          setInfo(null);
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
            onExit={handleExit}
            previewMode={UI_PREVIEW}
          />,
          overlayRoot,
        )}
    </>
  );
}
