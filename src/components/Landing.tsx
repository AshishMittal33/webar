import { useEffect, useState } from 'react';
import { checkWebXrSupport, type SupportReport } from '../ar/support';
import type { ArError } from '../ar/types';

interface LandingProps {
  onStart: () => void;
  /** Message from a previous attempt (permission denied, session ended...). */
  notice?: ArError | null;
}

export default function Landing({ onStart, notice }: LandingProps) {
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
          <li>Move your phone slowly to scan the floor and walls.</li>
          <li>Good lighting and textured surfaces help tracking.</li>
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
    </main>
  );
}
