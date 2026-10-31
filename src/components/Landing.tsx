import { useEffect, useState } from 'react';
import { checkWebXrSupport, type SupportReport } from '../ar/support';
import type { ArError } from '../ar/types';
import DebugLogButton from './DebugLogButton';

interface LandingProps {
  onStart: () => void;
  /** Stability test: AR without overlay or extras, like Google's demo. */
  onStartPlain: () => void;
  /** Message from a previous attempt (permission denied, session ended...). */
  notice?: ArError | null;
  /** Present after an AR session, so its log can be copied after exiting. */
  getDebugLog?: () => string;
}

export default function Landing({ onStart, onStartPlain, notice, getDebugLog }: LandingProps) {
  const [report, setReport] = useState<SupportReport | null>(null);
  const [showDiag, setShowDiag] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkWebXrSupport().then((r) => {
      if (!cancelled) setReport(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const checking = report === null;
  const canStart = report?.canStartAr ?? false;

  return (
    <main className="landing">
      <div>
        <h1>WebAR Room Configurator</h1>
        <p style={{ marginTop: 8 }}>
          Place TVs, tables and furniture in your real room using your phone camera.
        </p>
      </div>

      {notice && (
        <section className="card notice">
          <strong>{notice.message}</strong>
          <p className="hint">{notice.hint}</p>
        </section>
      )}

      <section className="card">
        <div className="status-row">
          <strong>Device check</strong>
          <span className={`badge ${checking ? 'pending' : canStart ? 'ok' : 'err'}`}>
            {checking ? 'Checking' : canStart ? 'Ready' : 'Not supported'}
          </span>
        </div>
        <p className="hint">{report?.summary ?? 'Asking the browser about WebXR support.'}</p>
        {report && (
          <button className="btn-ghost" onClick={() => setShowDiag((s) => !s)}>
            {showDiag ? 'Hide details' : 'Show details'}
          </button>
        )}
        {showDiag && report && (
          <div className="check-list">
            {report.checks.map((c) => (
              <div key={c.id}>
                <div className="status-row">
                  <span>{c.label}</span>
                  <span className={`badge ${c.level}`}>
                    {c.level === 'ok' ? 'OK' : c.level === 'warn' ? 'Check' : 'Fail'}
                  </span>
                </div>
                <div className="hint">{c.detail}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <strong>Before you start</strong>
        <ul className="steps">
          <li>Allow camera access when Chrome asks. AR needs the camera to see your room.</li>
          <li>Move your phone slowly over the floor for a few seconds to start tracking.</li>
          <li>Add an object, then drag, pinch and twist it, or use the buttons, to put it where you want.</li>
          <li>Good lighting helps. Keep some floor or furniture in view; blank walls give the camera nothing to track.</li>
        </ul>
      </section>

      <button className="btn-primary" disabled={!canStart} onClick={onStart}>
        Start AR Experience
      </button>

      {!checking && !canStart && (
        <p className="hint">
          Supported: ARCore-certified Android devices running a recent Google Chrome, opened over
          HTTPS.
        </p>
      )}

      <section className="card">
        <strong>Stability test (plain mode)</strong>
        <p className="hint">
          AR with no buttons and no extra processing, the same as Google's demo. Tap the screen to place a TV in
          front of you, then walk around it. Press the tablet's Back button to exit.
        </p>
        <button className="btn-secondary" disabled={!canStart} onClick={onStartPlain}>
          Start plain mode
        </button>
      </section>

      {getDebugLog && (
        <section className="card">
          <strong>Report a problem</strong>
          <p className="hint">Copies what happened during the last AR session, so it can be sent for fixing.</p>
          <DebugLogButton getLog={getDebugLog} label="Copy debug log of last AR session" />
        </section>
      )}
    </main>
  );
}
