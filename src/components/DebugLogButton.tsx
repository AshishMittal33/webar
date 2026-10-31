import { useState } from 'react';

interface DebugLogButtonProps {
  getLog: () => string;
  label?: string;
}

/**
 * Copies the engine's debug log to the clipboard so the user can paste it
 * into a chat. If the clipboard is unavailable, shows the text so it can be
 * selected and copied by hand.
 */
export default function DebugLogButton({ getLog, label = 'Copy debug log' }: DebugLogButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'show'>('idle');
  const [text, setText] = useState('');

  const copy = async () => {
    const log = getLog();
    setText(log);
    try {
      await navigator.clipboard.writeText(log);
      setState('copied');
    } catch {
      setState('show');
    }
  };

  return (
    <div className="debug-log">
      <button className="ar-chip off" onClick={copy}>
        {state === 'copied' ? 'Copied. Paste it in the chat.' : label}
      </button>
      {state === 'show' && (
        <>
          <p className="hint">Copying was blocked. Select all the text below and copy it.</p>
          <textarea readOnly value={text} rows={8} onFocus={(e) => e.currentTarget.select()} />
        </>
      )}
    </div>
  );
}
