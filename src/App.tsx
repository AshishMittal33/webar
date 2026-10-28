import { useState } from 'react';
import Landing from './components/Landing';

type Screen = 'landing' | 'ar';

export default function App() {
  const [screen, setScreen] = useState<Screen>('landing');

  if (screen === 'ar') {
    // Phase 2 replaces this placeholder with the real immersive-ar session.
    return (
      <main className="landing">
        <h1>AR session</h1>
        <p>Phase 2 will start the WebXR immersive-ar session here.</p>
        <button className="btn-primary" onClick={() => setScreen('landing')}>
          Back
        </button>
      </main>
    );
  }

  return <Landing onStart={() => setScreen('ar')} />;
}
