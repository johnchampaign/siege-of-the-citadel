import React, { useState } from 'react';
import { submitReport, downloadLog, type Severity } from './api';
import type { GameState } from '../game/types';

// "Report a Problem" + "Upload / Download Log" — mirrors the sibling boardgame
// projects. The report carries the full game-state snapshot and battle log so a
// problem can be reproduced; nothing is sent until the player clicks Submit.
export const ReportPanel: React.FC<{
  state: GameState;
  mode: 'local' | 'online';
  gameId?: string;
}> = ({ state, mode, gameId }) => {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [severity, setSeverity] = useState<Severity>('bug');
  const [status, setStatus] = useState<'idle' | 'sending' | { reportId: string } | { error: string }>('idle');

  async function send() {
    if (!msg.trim()) return;
    setStatus('sending');
    try {
      const r = await submitReport({
        message: msg.trim(),
        severity,
        missionId: state.missionId,
        mode,
        gameId,
        state,                              // the uploaded log/state snapshot
        log: state.log?.slice(-400),
      });
      setStatus({ reportId: r.reportId });
      setMsg('');
    } catch (e: any) {
      setStatus({ error: e?.message ?? String(e) });
    }
  }

  function download() {
    downloadLog(`siege-log-${state.missionId}-${Date.now()}.json`, {
      missionId: state.missionId, mode, gameId, savedAt: new Date().toISOString(), state,
    });
  }

  return (
    <Panel title="Report a Problem">
      {!open ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={btn} onClick={() => { setOpen(true); setStatus('idle'); }}>🐞 Report a Problem</button>
          <button style={btn} onClick={download}>⬇ Download Log</button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 12, color: '#bbb', marginBottom: 6 }}>
            Tell us what went wrong. Your current game state &amp; battle log are attached automatically so we can reproduce it.
          </div>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} style={{ ...btn, width: '100%', marginBottom: 6 }}>
            <option value="bug">Bug — something broke</option>
            <option value="rules-question">Rules question</option>
            <option value="feedback">Feedback / suggestion</option>
          </select>
          <textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder="e.g. Clicking my Doomtrooper did nothing on my turn…"
            rows={4}
            style={{ width: '100%', boxSizing: 'border-box', background: '#161616', color: '#eee', border: '1px solid #444', borderRadius: 6, padding: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <button style={{ ...btn, background: '#2a6' }} disabled={status === 'sending' || !msg.trim()} onClick={send}>
              {status === 'sending' ? 'Sending…' : '📤 Submit + Upload Log'}
            </button>
            <button style={btn} onClick={download}>⬇ Download Log</button>
            <button style={btn} onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {typeof status === 'object' && 'reportId' in status && (
            <div style={{ fontSize: 12, color: '#7c7', marginTop: 8 }}>
              ✓ Thank you! Report received — <code style={{ color: '#9c9' }}>{status.reportId}</code>. Reports like yours are exactly what makes this better — please keep sending them.
            </div>
          )}
          {typeof status === 'object' && 'error' in status && (
            <div style={{ fontSize: 12, color: '#f66', marginTop: 8 }}>
              Couldn't send: {status.error}. You can still <button style={{ ...btn, fontSize: 11, padding: '1px 6px' }} onClick={download}>download the log</button> and send it to us.
            </div>
          )}
        </div>
      )}
    </Panel>
  );
};

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ background: '#1f1f1f', border: '1px solid #333', borderRadius: 8, padding: 12 }}>
    <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 8 }}>{title}</div>
    {children}
  </div>
);
const btn: React.CSSProperties = { background: '#2d2d2d', color: '#eee', border: '1px solid #555', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 13 };
