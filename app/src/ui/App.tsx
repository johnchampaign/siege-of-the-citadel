import React, { useState, useMemo } from 'react';
import { Board } from './Board';
import { useLocalGame } from './useLocalGame';
import { MISSION_LIST, FORCE_CARDS } from '../game/missions';
import { figureType, CORP_SPECIAL } from '../game/data';
import type { Action } from '../game/types';
import { useAssets, VASSAL_MODULE_URL, VASSAL_MODULE_PAGE } from './assets';

export const App: React.FC = () => {
  const [missionId, setMissionId] = useState('trial');
  const game = useLocalGame(missionId);
  const { state, legal, submit } = game;
  const [selected, setSelected] = useState<string | null>(null);
  const [weaponIdx, setWeaponIdx] = useState(0);
  const assets = useAssets();
  const [theme, setTheme] = useState<'designed' | 'art'>('designed');
  const useArt = theme === 'art' && assets.loaded;

  const seatName = state.seats.find((s) => s.id === state.activeSeat)?.name ?? '—';
  const isLegionTurn = state.activeSeat === 'legion';

  const selFig = state.figures.find((f) => f.uid === selected && f.alive) || null;
  const selType = selFig ? figureType(selFig.typeId) : null;

  // weapons available for the selected figure as attacks in legal set
  const selWeapons = useMemo(() => {
    if (!selFig) return [] as number[];
    const set = new Set<number>();
    for (const a of legal) if (a.type === 'attack' && a.uid === selFig.uid) set.add(a.weaponIdx);
    return [...set].sort();
  }, [legal, selFig]);

  function doMove(x: number, y: number) {
    if (!selected) return;
    submit({ type: 'move', uid: selected, x, y });
  }
  function doAttack(targetUid: string) {
    if (!selected) return;
    submit({ type: 'attack', uid: selected, targetUid, weaponIdx });
  }
  function newGame(mid: string) {
    setMissionId(mid);
    setSelected(null);
    game.reset(mid, Math.floor(Math.random() * 100000));
  }

  const lastLog = state.log.slice(-12).reverse();
  const promotionRows = Object.entries(state.promotion);

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, fontFamily: 'system-ui, sans-serif', color: '#ddd', minHeight: '100vh', background: '#161616' }}>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, color: '#e8c349', letterSpacing: 1 }}>
          MUTANT CHRONICLES
        </h1>
        <div style={{ margin: '0 0 12px', color: '#a55', fontSize: 13, letterSpacing: 2 }}>SIEGE OF THE CITADEL</div>
        <div style={{ overflow: 'auto', maxHeight: '82vh', border: '1px solid #333' }}>
        <Board
          state={state}
          legal={legal}
          selected={selected}
          weaponIdx={weaponIdx}
          useArt={useArt}
          onSelect={setSelected}
          onMove={doMove}
          onAttack={doAttack}
        />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
          Click a glowing figure to select it · green squares = move · red-outlined enemies = attack target
        </div>
      </div>

      {/* control panel */}
      <div style={{ flex: '1 1 320px', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Panel title="Mission">
          <select value={missionId} onChange={(e) => newGame(e.target.value)} style={selStyle}>
            {MISSION_LIST.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <p style={{ fontSize: 12, color: '#bbb', margin: '8px 0 4px' }}>{MISSION_LIST.find((m) => m.id === missionId)?.briefing}</p>
          <p style={{ fontSize: 12, color: '#e8c349', margin: '4px 0' }}><b>Objective:</b> {state.win.kind === 'promotion' ? `Earn ${(state.win as any).points} promotion pts, then escape a trooper.` : state.win.kind === 'eliminate-all' ? 'Eliminate every Dark Legion creature.' : state.win.kind === 'escape' ? `Get ${(state.win as any).count} trooper(s) to an exit.` : 'Survive.'}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button style={btn} onClick={() => newGame(missionId)}>↻ New Game</button>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={game.legionAI} onChange={(e) => game.setLegionAI(e.target.checked)} />
              Dark Legion AI
            </label>
          </div>
        </Panel>

        <AssetPanel theme={theme} setTheme={setTheme} />

        <Panel title={`Round ${state.round}${state.timeLimitRounds < 90 ? ` / ${state.timeLimitRounds}` : ''} — ${state.phase.toUpperCase()}`}>
          {state.phase === 'setup' && (
            <button style={{ ...btn, background: '#2a6', fontSize: 16, padding: '8px 16px' }} onClick={() => submit({ type: 'start' })}>
              ▶ Start Mission
            </button>
          )}
          {state.phase === 'play' && (
            <div>
              <div style={{ fontSize: 15, marginBottom: 8 }}>
                Active: <b style={{ color: isLegionTurn ? '#f55' : '#5af' }}>{seatName}</b>
                {isLegionTurn && game.legionAI && <span style={{ color: '#888', marginLeft: 8 }}>(AI thinking…)</span>}
              </div>
              {!(isLegionTurn && game.legionAI) && (
                <button style={btn} onClick={() => submit({ type: 'end-turn' })}>End Turn ⏭</button>
              )}
            </div>
          )}
          {state.phase === 'over' && (
            <div style={{ fontSize: 16, color: '#e8c349' }}>
              🏆 Winner: <b>{state.winners?.map((w) => state.seats.find((s) => s.id === w)?.name).join(', ')}</b>
              <div style={{ marginTop: 8 }}>
                <button style={btn} onClick={() => newGame(missionId)}>Play Again</button>
              </div>
            </div>
          )}
        </Panel>

        {selFig && selType && (
          <Panel title={`Selected: ${selType.name}`}>
            <div style={{ fontSize: 13 }}>
              {selType.faction} · strength {selType.strength - selFig.woundsTaken}/{selType.strength} · armor {selType.armor} · <b>{selFig.actionsLeft} action(s) left</b>
            </div>
            {selWeapons.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: '#aaa' }}>Attack with:</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  {selType.weapons.map((w, i) => (
                    <button
                      key={i}
                      disabled={!selWeapons.includes(i)}
                      onClick={() => setWeaponIdx(i)}
                      style={{ ...btn, opacity: selWeapons.includes(i) ? 1 : 0.35, outline: weaponIdx === i ? '2px solid #e8c349' : 'none' }}
                    >
                      {w.name} ({w.dice}{w.color[0]})
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>Then click a red-outlined enemy.</div>
              </div>
            )}
            <button style={{ ...btn, marginTop: 8 }} onClick={() => { submit({ type: 'pass-figure', uid: selFig.uid }); setSelected(null); }}>
              Done with this figure
            </button>
          </Panel>
        )}

        {state.lastRoll && (
          <Panel title="Last Dice Roll">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {state.lastRoll.dice.map((d, i) => (
                <Die key={i} value={d} color={state.lastRoll!.color} />
              ))}
              <span style={{ marginLeft: 8, color: '#e8c349' }}>{state.lastRoll.hits} hit{state.lastRoll.hits === 1 ? '' : 's'}</span>
            </div>
          </Panel>
        )}

        {promotionRows.length > 0 && (
          <Panel title="Promotion Points">
            {promotionRows.map(([corp, pts]) => (
              <div key={corp} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                <span>{corp} <span style={{ color: '#777', fontSize: 11 }}>({CORP_SPECIAL[corp]?.split(':')[0]})</span></span>
                <b style={{ color: '#e8c349' }}>{pts}</b>
              </div>
            ))}
          </Panel>
        )}

        <Panel title="Force Cards">
          {state.forceCards.map((fc) => (
            <div key={fc.cardId} style={{ fontSize: 12, color: fc.revealed ? '#f88' : '#888' }}>
              Sector {fc.sectorId}: {fc.revealed ? FORCE_CARDS[fc.cardId].spawn.map((c) => figureType(c).name).join(', ') : '🂠 face down'}
            </div>
          ))}
        </Panel>

        <Panel title="Battle Log">
          <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: 12, lineHeight: 1.5 }}>
            {lastLog.map((l, i) => (
              <div key={i} style={{ color: l.includes('ELIMINATED') ? '#f66' : l.startsWith('—') ? '#e8c349' : '#bbb' }}>{l}</div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
};

const AssetPanel: React.FC<{ theme: 'designed' | 'art'; setTheme: (t: 'designed' | 'art') => void }> = ({ theme, setTheme }) => {
  const a = useAssets();
  const inputRef = React.useRef<HTMLInputElement>(null);
  if (!a.ready) return null;
  return (
    <Panel title="Visual Style">
      {/* theme switch — the designed theme needs no download */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button
          onClick={() => setTheme('designed')}
          style={{ ...btn, flex: 1, outline: theme === 'designed' ? '2px solid #e8c349' : 'none', fontWeight: theme === 'designed' ? 700 : 400 }}
        >
          ◈ Designed
        </button>
        <button
          onClick={() => setTheme('art')}
          disabled={!a.loaded}
          title={a.loaded ? 'Use the artwork from your VASSAL module' : 'Load a VASSAL module first'}
          style={{ ...btn, flex: 1, opacity: a.loaded ? 1 : 0.4, outline: theme === 'art' && a.loaded ? '2px solid #e8c349' : 'none', fontWeight: theme === 'art' ? 700 : 400 }}
        >
          🖼 Module art
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
        {theme === 'designed'
          ? 'Original art-free token & tile design — no download needed.'
          : 'Showing artwork from your loaded VASSAL module.'}
      </div>

      {a.loaded ? (
        <div style={{ fontSize: 12, color: '#9c9' }}>
          ✓ Module artwork available ({a.count}/{a.total} images, cached on this device).
          <button style={{ ...btn, marginTop: 8 }} onClick={() => { a.clear(); setTheme('designed'); }}>Remove artwork</button>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#bbb', lineHeight: 1.5 }}>
          The game plays fine with placeholder tokens. For the original board art, download the
          community VASSAL module and load it here — the images are extracted in your browser and
          never leave your device.
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <a href={VASSAL_MODULE_URL} style={{ color: '#5af' }}>⬇ Download module (.vmod)</a>
            <a href={VASSAL_MODULE_PAGE} target="_blank" rel="noreferrer" style={{ color: '#777', fontSize: 11 }}>
              (module page on vassalengine.org)
            </a>
            <button style={{ ...btn, marginTop: 4 }} disabled={a.importing} onClick={() => inputRef.current?.click()}>
              {a.importing ? 'Extracting…' : '📦 Load .vmod file'}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".vmod,.zip,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) a.importModule(f).catch(() => {});
                e.target.value = '';
              }}
            />
          </div>
        </div>
      )}
      {a.error && <div style={{ color: '#f66', fontSize: 11, marginTop: 6 }}>{a.error}</div>}
    </Panel>
  );
};

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ background: '#1f1f1f', border: '1px solid #333', borderRadius: 8, padding: 12 }}>
    <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 8 }}>{title}</div>
    {children}
  </div>
);

const Die: React.FC<{ value: number; color: string }> = ({ value, color }) => {
  const thr = color === 'white' ? 2 : color === 'red' ? 3 : 4;
  const hit = value <= thr;
  const bg = color === 'white' ? '#eee' : color === 'red' ? '#c33' : '#222';
  const fg = color === 'white' ? '#222' : '#fff';
  return (
    <div style={{ width: 30, height: 30, borderRadius: 5, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, border: hit ? '2px solid #6f6' : '2px solid #444', boxShadow: hit ? '0 0 6px #6f6' : 'none' }}>
      {value}
    </div>
  );
};

const btn: React.CSSProperties = {
  background: '#2d2d2d', color: '#eee', border: '1px solid #555', borderRadius: 6,
  padding: '6px 10px', cursor: 'pointer', fontSize: 13,
};
const selStyle: React.CSSProperties = { ...btn, width: '100%', padding: '6px' };
