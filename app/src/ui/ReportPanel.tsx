import React, { useState } from 'react';
import { submitReport, downloadLog, type Severity } from './api';
import type { GameState } from '../game/types';

// "Report a Problem" + "Upload / Download Log" — mirrors the sibling boardgame
// projects. The panel holds the triggers; the form itself opens in a modal.
// The report carries the full game-state snapshot and battle log so a problem
// can be reproduced; nothing is sent until the player clicks Submit.
export const ReportPanel: React.FC<{
  state: GameState;
  mode: 'local' | 'online';
  gameId?: string;
}> = ({ state, mode, gameId }) => {
  const [open, setOpen] = useState(false);

  function download() {
    downloadLog(`siege-log-${state.missionId}-${Date.now()}.json`, {
      missionId: state.missionId, mode, gameId, savedAt: new Date().toISOString(), state,
    });
  }

  return (
    <Panel title="Report a Problem">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={btn} onClick={() => setOpen(true)}>🐞 Report a Problem</button>
        <button style={btn} onClick={download}>⬇ Download Log</button>
      </div>
      {open && <ReportModal state={state} mode={mode} gameId={gameId} onClose={() => setOpen(false)} onDownload={download} />}
    </Panel>
  );
};

const ReportModal: React.FC<{
  state: GameState;
  mode: 'local' | 'online';
  gameId?: string;
  onClose: () => void;
  onDownload: () => void;
}> = ({ state, mode, gameId, onClose, onDownload }) => {
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

  const done = typeof status === 'object' && 'reportId' in status;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#1c1c20', border: '2px solid #4a4a55', borderRadius: 12, padding: 22, width: 'min(460px, 92vw)', boxShadow: '0 10px 40px #000' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 2, color: '#e8c349' }}>Report a Problem</div>
          <button onClick={onClose} title="Close" style={{ ...btn, padding: '2px 9px', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>

        {done ? (
          <div>
            <div style={{ fontSize: 14, color: '#7d7', lineHeight: 1.6 }}>
              ✓ Thank you! Report received — <code style={{ color: '#9c9' }}>{(status as any).reportId}</code>.
              <div style={{ color: '#bbb', marginTop: 6 }}>People who file problem reports are exactly what make this better — please keep them coming.</div>
            </div>
            <button style={{ ...btn, marginTop: 16, background: '#2a6', padding: '8px 18px', fontSize: 14 }} onClick={onClose}>Done</button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: '#bbb', marginBottom: 8 }}>
              Tell us what went wrong. Your current game state &amp; battle log are attached automatically so we can reproduce it.
            </div>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} style={{ ...btn, width: '100%', marginBottom: 8 }}>
              <option value="bug">Bug — something broke</option>
              <option value="rules-question">Rules question</option>
              <option value="feedback">Feedback / suggestion</option>
            </select>
            <textarea
              autoFocus
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="e.g. Clicking my Doomtrooper did nothing on my turn…"
              rows={5}
              style={{ width: '100%', boxSizing: 'border-box', background: '#161616', color: '#eee', border: '1px solid #444', borderRadius: 6, padding: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button style={{ ...btn, background: '#2a6', padding: '8px 14px' }} disabled={status === 'sending' || !msg.trim()} onClick={send}>
                {status === 'sending' ? 'Sending…' : '📤 Submit + Upload Log'}
              </button>
              <button style={btn} onClick={onDownload}>⬇ Download Log</button>
              <button style={btn} onClick={onClose}>Cancel</button>
            </div>
            {typeof status === 'object' && 'error' in status && (
              <div style={{ fontSize: 12, color: '#f66', marginTop: 10 }}>
                Couldn't send: {(status as any).error}. You can still <button style={{ ...btn, fontSize: 11, padding: '1px 6px' }} onClick={onDownload}>download the log</button> and send it to us.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ background: '#1f1f1f', border: '1px solid #333', borderRadius: 8, padding: 12 }}>
    <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 8 }}>{title}</div>
    {children}
  </div>
);
const btn: React.CSSProperties = { background: '#2d2d2d', color: '#eee', border: '1px solid #555', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 13 };
