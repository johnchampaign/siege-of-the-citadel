import React, { useMemo, useState } from 'react';
import { useGame } from 'digital-boardgame-framework/client';
import { Board } from './Board';
import { httpClient, type OnlineParams } from './api';
import { ReportPanel } from './ReportPanel';
import { figureType } from '../game/data';
import type { GameState, Action } from '../game/types';

// Online (server-authoritative) game view. Driven by the framework's useGame
// hook against the deployed API Worker. Polls for the opponent's moves.
export const OnlineGame: React.FC<{ params: OnlineParams }> = ({ params }) => {
  const client = useMemo(() => httpClient(params.gameId, params.token), [params.gameId, params.token]);
  const game = useGame<GameState, Action>(client, { pollMs: 2500, pauseWhenHidden: true });
  const [selected, setSelected] = useState<string | null>(null);
  const [weaponIdx, setWeaponIdx] = useState(0);

  const state = game.view;
  if (!state) {
    return <Centered>{game.error ? `Error: ${game.error.message}` : 'Loading game…'}</Centered>;
  }

  const you = game.you ?? '';
  const yourTurn = game.yourTurn;
  const selFig = state.figures.find((f) => f.uid === selected && f.alive) || null;
  const selType = selFig ? figureType(selFig.typeId) : null;

  const selWeapons = (() => {
    if (!selFig) return [] as number[];
    const set = new Set<number>();
    for (const a of game.legalActions) if (a.type === 'attack' && a.uid === selFig.uid) set.add(a.weaponIdx);
    return [...set].sort();
  })();

  function submit(a: Action) { game.submit(a).catch((e) => console.error(e)); }

  const seatLabel = (id: string) => state!.seats.find((s) => s.id === id)?.name ?? id;

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, fontFamily: 'system-ui, sans-serif', color: '#ddd', minHeight: '100vh', background: '#161616' }}>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <h1 style={{ margin: '0 0 2px', fontSize: 20, color: '#e8c349', letterSpacing: 1 }}>MUTANT CHRONICLES — online</h1>
        <div style={{ margin: '0 0 10px', color: '#a55', fontSize: 12, letterSpacing: 2 }}>SIEGE OF THE CITADEL</div>
        <div style={{ overflow: 'auto', maxHeight: '82vh', border: '1px solid #333' }}>
          <Board
            state={state}
            legal={yourTurn ? game.legalActions : []}
            selected={selected}
            weaponIdx={weaponIdx}
            useArt={false}
            onSelect={setSelected}
            onMove={(x, y) => selected && submit({ type: 'move', uid: selected, x, y })}
            onAttack={(t) => selected && submit({ type: 'attack', uid: selected, targetUid: t, weaponIdx })}
          />
        </div>
      </div>

      <div style={{ flex: '1 1 320px', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Panel title="Your Seat">
          <div style={{ fontSize: 15 }}>You are <b style={{ color: you === 'legion' ? '#f55' : '#5af' }}>{seatLabel(you)}</b></div>
          <div style={{ fontSize: 13, marginTop: 6, color: yourTurn ? '#6f6' : '#aaa' }}>
            {state.phase === 'over' ? '🏁 Game over' : yourTurn ? '● Your turn' : `Waiting for ${seatLabel(state.activeSeat ?? '')}…`}
          </div>
          {game.loading && <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>syncing…</div>}
        </Panel>

        <Panel title={`Round ${state.round} — ${state.phase.toUpperCase()}`}>
          {state.phase === 'setup' && yourTurn && (
            <button style={{ ...btn, background: '#2a6', fontSize: 15, padding: '8px 14px' }} onClick={() => submit({ type: 'start' })}>▶ Start Mission</button>
          )}
          {state.phase === 'setup' && !yourTurn && <div style={{ fontSize: 12, color: '#aaa' }}>Waiting for the Dark Legion to start the mission.</div>}
          {state.phase === 'play' && yourTurn && (
            <button style={btn} onClick={() => submit({ type: 'end-turn' })}>End Turn ⏭</button>
          )}
          {state.phase === 'over' && (
            <div style={{ fontSize: 15, color: '#e8c349' }}>🏆 {state.winners?.map(seatLabel).join(', ')} win!</div>
          )}
        </Panel>

        {selFig && selType && yourTurn && (
          <Panel title={`Selected: ${selType.name}`}>
            <div style={{ fontSize: 13 }}>{selType.faction} · strength {selType.strength - selFig.woundsTaken}/{selType.strength} · armor {selType.armor} · {selFig.actionsLeft} action(s)</div>
            {selWeapons.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {selType.weapons.map((w, i) => (
                  <button key={i} disabled={!selWeapons.includes(i)} onClick={() => setWeaponIdx(i)}
                    style={{ ...btn, opacity: selWeapons.includes(i) ? 1 : 0.35, outline: weaponIdx === i ? '2px solid #e8c349' : 'none' }}>
                    {w.name} ({w.dice}{w.color[0]})
                  </button>
                ))}
              </div>
            )}
            <button style={{ ...btn, marginTop: 8 }} onClick={() => { submit({ type: 'pass-figure', uid: selFig.uid }); setSelected(null); }}>Done with this figure</button>
          </Panel>
        )}

        {state.lastRoll && (
          <Panel title="Last Dice Roll">
            <div style={{ fontSize: 12, color: '#ccc' }}>{state.lastRoll.label}</div>
          </Panel>
        )}

        <Panel title="Battle Log">
          <div style={{ maxHeight: 240, overflowY: 'auto', fontSize: 12, lineHeight: 1.5 }}>
            {state.log.slice(-14).reverse().map((l, i) => (
              <div key={i} style={{ color: l.includes('ELIMINATED') ? '#f66' : l.startsWith('—') ? '#e8c349' : '#bbb' }}>{l}</div>
            ))}
          </div>
        </Panel>

        <Panel title="Share">
          <div style={{ fontSize: 12, color: '#aaa' }}>Send each player their own invite link (from whoever created the game). This link is yours — don't share it.</div>
          <a href={location.origin + location.pathname} style={{ color: '#5af', fontSize: 12 }}>← Back to local game</a>
        </Panel>

        <ReportPanel state={state} mode="online" gameId={params.gameId} />
      </div>
    </div>
  );
};

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#ccc', fontFamily: 'system-ui', background: '#161616' }}>{children}</div>
);
const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ background: '#1f1f1f', border: '1px solid #333', borderRadius: 8, padding: 12 }}>
    <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 8 }}>{title}</div>
    {children}
  </div>
);
const btn: React.CSSProperties = { background: '#2d2d2d', color: '#eee', border: '1px solid #555', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 13 };
