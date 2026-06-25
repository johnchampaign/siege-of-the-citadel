import React, { useState, useMemo, useEffect } from 'react';
import { Board } from './Board';
import { useLocalGame } from './useLocalGame';
import { MISSION_LIST, FORCE_CARDS } from '../game/missions';
import { figureType, effectiveType, CORP_SPECIAL } from '../game/data';
import { EQUIPMENT_LIST, EVENTS, DOOM_CARDS, SECONDARY_MISSIONS } from '../game/cards';
import type { Action, GameState } from '../game/types';
import { useAssets, VASSAL_MODULE_URL, VASSAL_MODULE_PAGE } from './assets';
import { createOnlineGame, fetchPlayCount, createCloudCampaign, saveCloudCampaign, loadCloudCampaign } from './api';
import { ReportPanel } from './ReportPanel';
import { WallEditor } from './WallEditor';
import {
  type CampaignState, loadCampaign, saveCampaign, newCampaign, clearCampaign,
  ranks, recordResult, CAMPAIGN_CORPS, suggestedMission, allMissionsDone,
  campaignWon, leader,
} from '../game/campaign';
import { CAMPAIGN_MISSIONS } from '../game/missions';

export const App: React.FC = () => {
  const [missionId, setMissionId] = useState('trial');
  const game = useLocalGame(missionId);
  const { state, legal, submit } = game;
  const [selected, setSelected] = useState<string | null>(null);
  const [weaponIdx, setWeaponIdx] = useState(0);
  const assets = useAssets();
  // combat-result modal: shown after the player's own attacks
  const [resultModal, setResultModal] = useState<GameState['lastRoll'] | null>(null);
  const pendingResultRef = React.useRef(false);
  useEffect(() => {
    if (pendingResultRef.current) {
      pendingResultRef.current = false;
      if (state.lastRoll) setResultModal(state.lastRoll);
    }
  }, [state]);
  const [theme, setTheme] = useState<'designed' | 'art'>('designed');
  const useArt = theme === 'art' && assets.loaded;
  const [showCoords, setShowCoords] = useState(false);
  const [view, setView] = useState<'play' | 'walls'>('play');
  const [campaign, setCampaign] = useState<CampaignState | null>(() => loadCampaign());
  const [inCampaign, setInCampaign] = useState(false);
  const recordedRef = React.useRef(false);

  // When a campaign mission ends, fold the result into the campaign once.
  useEffect(() => {
    if (inCampaign && campaign && state.phase === 'over' && !recordedRef.current) {
      recordedRef.current = true;
      const next = recordResult(campaign, state);
      setCampaign(next);
      saveCampaign(next);
      // best-effort cloud sync if cross-device save is enabled
      if (next.cloudCode) saveCloudCampaign(next.cloudCode, next).catch(() => {});
    }
  }, [state.phase, inCampaign, campaign, state]);

  // On startup, if this device has a cloud-linked campaign, pull the latest
  // standing (another device may have progressed it). Cloud is source of truth.
  useEffect(() => {
    const code = campaign?.cloudCode;
    if (!code) return;
    loadCloudCampaign(code)
      .then((remote) => {
        if (remote && remote.cloudCode === code) { setCampaign(remote); saveCampaign(remote); }
      })
      .catch(() => {});
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seatName = state.seats.find((s) => s.id === state.activeSeat)?.name ?? '—';
  const isLegionTurn = state.activeSeat === 'legion';

  const selFig = state.figures.find((f) => f.uid === selected && f.alive) || null;
  const selType = selFig ? figureType(selFig.typeId) : null;
  // effective weapons (equipment/rank folded in) for display + kind lookup
  const selEff = selFig ? effectiveType(selFig, state.rank[selFig.owner] ?? 1, (state as any)._frenzy) : null;
  const selWeaponKinds = selEff ? selEff.weapons.map((w) => w.kind) : [];

  // weaponIdx values that have a legal target for the selected figure, and how
  // many distinct enemy targets each weapon kind can hit right now.
  const { selWeapons, meleeTargets, rangedTargets } = useMemo(() => {
    const set = new Set<number>();
    const melee = new Set<string>();
    const ranged = new Set<string>();
    if (selFig) {
      for (const a of legal) {
        if (a.type === 'attack' && a.uid === selFig.uid) {
          set.add(a.weaponIdx);
          if (selWeaponKinds[a.weaponIdx] === 'close') melee.add(a.targetUid);
          else ranged.add(a.targetUid);
        }
      }
    }
    return { selWeapons: [...set].sort(), meleeTargets: melee.size, rangedTargets: ranged.size };
  }, [legal, selFig, selWeaponKinds]);

  // Auto-pick a sensible default weapon when a new figure is selected: prefer a
  // weapon that actually has targets (melee first if adjacent, else ranged).
  useEffect(() => {
    if (!selFig || selWeapons.length === 0) return;
    if (selWeapons.includes(weaponIdx)) return;
    const meleeIdx = selWeapons.find((i) => selWeaponKinds[i] === 'close');
    setWeaponIdx(meleeIdx ?? selWeapons[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selWeapons.join(',')]);

  function doMove(x: number, y: number) {
    if (!selected) return;
    submit({ type: 'move', uid: selected, x, y });
  }
  function doAttack(targetUid: string, idx: number) {
    if (!selected) return;
    pendingResultRef.current = true; // capture the outcome for the result modal
    submit({ type: 'attack', uid: selected, targetUid, weaponIdx: idx });
  }
  function newGame(mid: string) {
    setMissionId(mid);
    setSelected(null);
    setInCampaign(false);
    recordedRef.current = false;
    game.reset(mid, Math.floor(Math.random() * 100000));
  }

  function startCampaign() {
    const c = newCampaign();
    setCampaign(c);
    saveCampaign(c);
    const m = suggestedMission(c);
    if (m) playCampaignMission(c, m.id);
  }
  function playCampaignMission(c: CampaignState, missionId: string) {
    setMissionId(missionId);
    setSelected(null);
    setInCampaign(true);
    recordedRef.current = false;
    game.reset(missionId, Math.floor(Math.random() * 100000), {
      corporations: CAMPAIGN_CORPS,
      rank: ranks(c),          // RAW: Rank is fixed at mission start from accumulated PP
      credits: { ...c.credits }, // Credits carry in
    });
  }
  function resetCampaign() {
    clearCampaign();
    setCampaign(null);
    setInCampaign(false);
  }
  // Enable cross-device save: push the current standing to the cloud, keep the code.
  async function enableCloud(c: CampaignState): Promise<string> {
    const code = await createCloudCampaign(c);
    const next = { ...c, cloudCode: code };
    setCampaign(next);
    saveCampaign(next);
    return code;
  }
  // Resume a campaign from a code typed on another device.
  async function loadFromCode(code: string): Promise<void> {
    const remote = await loadCloudCampaign(code.trim().toUpperCase());
    if (!remote) throw new Error('No campaign found for that code.');
    const next = { ...remote, cloudCode: code.trim().toUpperCase() };
    setCampaign(next);
    saveCampaign(next);
    setInCampaign(false);
  }

  const lastLog = state.log.slice(-12).reverse();
  const promotionRows = Object.entries(state.promotion);

  if (view === 'walls') return <WallEditor onBack={() => setView('play')} />;

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, fontFamily: 'system-ui, sans-serif', color: '#ddd', minHeight: '100vh', background: '#161616' }}>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, color: '#e8c349', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
          MUTANT CHRONICLES
          <button style={{ background: '#2d2d2d', color: '#ccc', border: '1px solid #555', borderRadius: 6, padding: '3px 9px', cursor: 'pointer', fontSize: 12, letterSpacing: 0 }} onClick={() => setView('walls')}>🧱 Wall Editor</button>
        </h1>
        <div style={{ margin: '0 0 12px', color: '#a55', fontSize: 13, letterSpacing: 2 }}>SIEGE OF THE CITADEL <PlayCount /></div>
        <div style={{ overflow: 'auto', maxHeight: '82vh', border: '1px solid #333' }}>
        <Board
          state={state}
          legal={legal}
          selected={selected}
          weaponIdx={weaponIdx}
          useArt={useArt}
          attackKinds={selWeaponKinds}
          showCoords={showCoords}
          onSelect={setSelected}
          onMove={doMove}
          onAttack={doAttack}
        />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#888', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Click a glowing figure · green = move · <span style={{ color: '#f66' }}>red ⚔ melee</span> · <span style={{ color: '#6af' }}>blue 🎯 ranged</span></span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#cc0' }}>
            <input type="checkbox" checked={showCoords} onChange={(e) => setShowCoords(e.target.checked)} />
            Show grid coords (wall-mapping)
          </label>
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
          <p style={{ fontSize: 12, color: '#e8c349', margin: '4px 0' }}><b>Objective:</b> {objectiveText(state)}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button style={btn} onClick={() => newGame(missionId)}>↻ New Game</button>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={game.legionAI} onChange={(e) => game.setLegionAI(e.target.checked)} />
              Dark Legion AI
            </label>
          </div>
        </Panel>

        <CampaignPanel
          campaign={campaign}
          inCampaign={inCampaign}
          phase={state.phase}
          onStart={startCampaign}
          onPlay={(c, mid) => playCampaignMission(c, mid)}
          onReset={resetCampaign}
          onEnableCloud={enableCloud}
          onLoadFromCode={loadFromCode}
        />

        <MultiplayerPanel missionId={missionId} />

        <AssetPanel theme={theme} setTheme={setTheme} />

        {state.phase === 'setup' && <EquipmentPanel state={state} submit={submit} />}

        <Panel title={`Round ${state.round}${state.timeLimitRounds < 90 ? ` / ${state.timeLimitRounds}` : ''} — ${state.phase.toUpperCase()}`}>
          {state.phase === 'play' && state.pendingEvent && (
            <div style={{ fontSize: 12, color: '#f88', background: '#2a1414', border: '1px solid #5a2020', borderRadius: 6, padding: '6px 8px', marginBottom: 8 }}>
              ⚠ Event: <b>{EVENTS[state.pendingEvent]?.name}</b> — {EVENTS[state.pendingEvent]?.blurb}
            </div>
          )}
          {state.phase === 'setup' && (
            <button style={{ ...btn, background: '#2a6', fontSize: 16, padding: '8px 16px' }} onClick={() => submit({ type: 'start' })}>
              ▶ Start Mission
            </button>
          )}
          {state.phase === 'play' && (
            <div>
              <div style={{ fontSize: 15, marginBottom: 6 }}>
                Active: <b style={{ color: isLegionTurn ? '#f55' : '#5af' }}>{seatName}</b>
                {isLegionTurn && game.legionAI && <span style={{ color: '#888', marginLeft: 8 }}>(AI thinking…)</span>}
              </div>
              {isLegionTurn && game.legionAI ? (
                <div style={{ fontSize: 12, color: '#c88' }}>The Dark Legion is taking its turn — please wait a moment.</div>
              ) : isLegionTurn ? (
                <div style={{ fontSize: 12, color: '#c88' }}>Dark Legion's turn — control its glowing figures.</div>
              ) : (
                <div style={{ fontSize: 12, color: '#9c9' }}>
                  Only <b>{seatName}</b>'s figures (gold-outlined &amp; glowing) can act now — others are dimmed.
                </div>
              )}
              {!(isLegionTurn && game.legionAI) && (
                <button style={{ ...btn, marginTop: 8 }} onClick={() => submit({ type: 'end-turn' })}>End Turn ⏭</button>
              )}
            </div>
          )}
          {state.phase === 'over' && (
            <div style={{ fontSize: 16, color: '#e8c349' }}>
              🏆 Winner: <b>{state.winners?.map((w) => state.seats.find((s) => s.id === w)?.name).join(', ')}</b>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!inCampaign && <button style={btn} onClick={() => newGame(missionId)}>Play Again</button>}
                {inCampaign && campaign && campaignWon(campaign) && (
                  <span style={{ fontSize: 13, color: '#e8c349' }}>🏆 {campaign.champion} has won the campaign ({campaign.target} pp)!</span>
                )}
                {inCampaign && campaign && !campaignWon(campaign) && (() => {
                  const next = suggestedMission(campaign);
                  return (
                    <>
                      <button style={{ ...btn }} onClick={() => playCampaignMission(campaign, missionId)}>↻ Replay this mission</button>
                      {next && (
                        <button style={{ ...btn, background: '#2a6' }} onClick={() => playCampaignMission(campaign, next.id)}>
                          ▶ Next: {next.name.replace('Mission ', 'M').split(':')[0]}
                        </button>
                      )}
                      {allMissionsDone(campaign) && (
                        <span style={{ fontSize: 12, color: '#7c7' }}>🎖 All missions cleared — replay any to reach {campaign.target} pp.</span>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </Panel>

        {state.phase === 'play' && !isLegionTurn && state.activeSeat && (
          <TurnAidsPanel state={state} corp={state.activeSeat} submit={submit} />
        )}

        {selFig && selType && (
          <Panel title={`Selected: ${selType.name}`}>
            <div style={{ fontSize: 13 }}>
              {selType.faction} · strength {selType.strength - selFig.woundsTaken}/{selType.strength} · armor {selType.armor} · <b>{selFig.actionsLeft} action(s)</b>
              {selFig.owner !== 'legion' && selFig.actionsLeft === 0 && (state.extraPool[selFig.owner] ?? 0) > 0 && (selFig.actionsTaken ?? 0) < 4 && (
                <span style={{ color: '#e8c349' }}> +pool</span>
              )}
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, color: '#aaa' }}>Targets in reach:</div>
              <div style={{ fontSize: 13, marginTop: 2 }}>
                <span style={{ color: meleeTargets ? '#f66' : '#666' }}>⚔ Melee: {meleeTargets} adjacent</span>
                <span style={{ color: '#555', margin: '0 6px' }}>·</span>
                <span style={{ color: rangedTargets ? '#6af' : '#666' }}>🎯 Ranged: {rangedTargets} in sight</span>
              </div>
              {(selEff?.weapons.length ?? 0) > 0 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {(selEff?.weapons ?? []).map((w, i) => (
                    <button
                      key={i}
                      disabled={!selWeapons.includes(i)}
                      onClick={() => setWeaponIdx(i)}
                      title={(w.kind === 'close' ? 'Close combat — must be adjacent' : `Firearm — range ${w.range}, needs line of sight`) + (w.area ? ` · area: ${w.area}` : '')}
                      style={{ ...btn, opacity: selWeapons.includes(i) ? 1 : 0.35, outline: weaponIdx === i ? '2px solid #e8c349' : 'none' }}
                    >
                      {w.kind === 'close' ? '⚔' : '🎯'} {w.name} ({w.dice}{w.color[0]}){w.area ? ' 💥' : ''}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                {selWeapons.length > 0
                  ? 'Click a highlighted enemy — red = melee, blue = ranged. (It auto-uses the right weapon.)'
                  : 'No enemies in reach. Move closer or get line of sight for a firearm shot.'}
              </div>
            </div>
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
          <Panel title="Teams — Rank · Credits · Promotion">
            {promotionRows.map(([corp, pts]) => (
              <div key={corp} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span>{corp} <span style={{ color: '#777', fontSize: 11 }}>({CORP_SPECIAL[corp]?.split(':')[0]})</span></span>
                <span>
                  <span style={{ color: '#7cf' }} title="Rank">R{state.rank[corp] ?? 1}</span>
                  {' · '}
                  <span style={{ color: '#7c7' }} title="Credits">{state.credits[corp] ?? 0}c</span>
                  {' · '}
                  <b style={{ color: '#e8c349' }} title="Promotion points this mission">{pts}pp</b>
                </span>
              </div>
            ))}
          </Panel>
        )}

        <Panel title="Force Cards">
          {state.forceCards.map((fc) => (
            <div key={fc.cardId} style={{ fontSize: 12, color: fc.revealed ? '#f88' : '#888' }}>
              Sector {fc.sectorId}: {fc.revealed ? (FORCE_CARDS[fc.cardId].spawn.length ? FORCE_CARDS[fc.cardId].spawn.map((c) => figureType(c).name).join(', ') : `${FORCE_CARDS[fc.cardId].name} (decoy — no creatures)`) : '🂠 face down'}
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

        <ReportPanel state={state} mode="local" />
      </div>

      {resultModal && <CombatResultModal roll={resultModal} onClose={() => setResultModal(null)} />}
    </div>
  );
};

function objectiveText(state: GameState): string {
  const w = state.win;
  switch (w.kind) {
    case 'promotion': return `Earn ${w.points} promotion pts${w.escape ? ', then escape a trooper.' : '.'}`;
    case 'eliminate-all': return 'Eliminate every Dark Legion figure.';
    case 'escape': return `Get ${w.count} trooper(s) to an exit.`;
    case 'eliminate-tagged': return `Destroy ${w.label}.`;
    case 'survive': return `Hold out for all ${state.timeLimitRounds} rounds.`;
  }
}

const CombatResultModal: React.FC<{ roll: NonNullable<GameState['lastRoll']>; onClose: () => void }> = ({ roll, onClose }) => {
  const thr = roll.color === 'white' ? 2 : roll.color === 'red' ? 3 : 4;
  // Build a plain-English explanation of what happened.
  const lines: { text: string; tone?: 'good' | 'bad' | 'plain' }[] = [];
  if (roll.area) {
    lines.push({ text: `Area attack (${roll.area}) — rolled ${roll.hits} hit${roll.hits === 1 ? '' : 's'}.` });
    lines.push({ text: 'Each figure caught in the area is checked against its own armor — see the Battle Log for the full breakdown.', tone: 'plain' });
  } else {
    lines.push({ text: `${roll.attackerName ?? 'Your figure'} attacked ${roll.targetName ?? 'the target'}${roll.weapon ? ` with ${roll.weapon}` : ''}.` });
    lines.push({ text: `Rolled ${roll.hits} hit${roll.hits === 1 ? '' : 's'} (a die "hits" on ${roll.color === 'white' ? '1–2' : roll.color === 'red' ? '1–3' : '1–4'}).` });
    if ((roll.armor ?? 0) > 0) {
      lines.push({ text: `${roll.targetName}'s armor (Factor ${roll.armor}) soaked ${roll.armor} hit${roll.armor === 1 ? '' : 's'}.`, tone: 'plain' });
    }
    if ((roll.saves ?? 0) > 0) {
      lines.push({ text: `Kevlarite armor absorbed ${roll.saves} more.`, tone: 'plain' });
    }
    if (roll.killed) {
      lines.push({ text: `💀 ${roll.targetName} was ELIMINATED!`, tone: 'good' });
    } else if ((roll.damage ?? 0) > 0) {
      lines.push({ text: `${roll.damage} wound${roll.damage === 1 ? '' : 's'} got through.`, tone: 'good' });
    } else {
      lines.push({ text: `No damage got through — you need MORE hits than the target's armor to wound it.`, tone: 'bad' });
    }
  }
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#1c1c20', border: '2px solid #4a4a55', borderRadius: 12, padding: 22, maxWidth: 420, boxShadow: '0 10px 40px #000' }}>
        <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 2, color: '#e8c349', marginBottom: 12 }}>Combat Result</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {roll.dice.map((d, i) => {
            const hit = d <= thr;
            const bg = roll.color === 'white' ? '#eee' : roll.color === 'red' ? '#c33' : '#222';
            const fg = roll.color === 'white' ? '#222' : '#fff';
            return (
              <div key={i} style={{ width: 40, height: 40, borderRadius: 7, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, border: hit ? '3px solid #6f6' : '3px solid #555', boxShadow: hit ? '0 0 8px #6f6' : 'none' }}>
                {d}
              </div>
            );
          })}
          <div style={{ display: 'flex', alignItems: 'center', marginLeft: 6, color: '#e8c349', fontWeight: 700 }}>
            {roll.hits} hit{roll.hits === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ color: l.tone === 'good' ? '#7d7' : l.tone === 'bad' ? '#f88' : '#cdd', marginBottom: 3 }}>{l.text}</div>
          ))}
        </div>
        <button style={{ ...btn, marginTop: 16, background: '#2a6', padding: '8px 18px', fontSize: 14 }} onClick={onClose}>Got it</button>
      </div>
    </div>
  );
};

const PlayCount: React.FC = () => {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { fetchPlayCount().then(setCount); }, []);
  if (count == null) return null;
  return <span style={{ color: '#777', fontSize: 11, letterSpacing: 0 }}>· {count.toLocaleString()} games played</span>;
};

const TurnAidsPanel: React.FC<{ state: GameState; corp: string; submit: (a: Action) => void }> = ({ state, corp, submit }) => {
  const pool = state.extraPool[corp] ?? 0;
  const hand = state.doomHands[corp] ?? [];
  const secId = state.secondary[corp];
  const sec = secId && secId !== 'hidden' ? SECONDARY_MISSIONS[secId] : null;

  function play(cardId: string) {
    const card = DOOM_CARDS[cardId];
    if (card?.needsTarget) {
      // auto-target the most-wounded friendly trooper
      const wounded = state.figures
        .filter((f) => f.owner === corp && f.alive && f.woundsTaken > 0)
        .sort((a, b) => b.woundsTaken - a.woundsTaken)[0];
      if (!wounded) return;
      submit({ type: 'play-doom-card', corp, cardId, targetUid: wounded.uid });
    } else {
      submit({ type: 'play-doom-card', corp, cardId });
    }
  }

  return (
    <Panel title={`${corp} — Turn Resources`}>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        ⚡ Extra Action pool: <b style={{ color: pool > 0 ? '#e8c349' : '#777' }}>{pool}</b>
        <span style={{ color: '#888', fontSize: 11 }}> (spend to act past 2/turn, max 4/figure)</span>
      </div>
      {hand.length > 0 ? (
        <div>
          <div style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>Doomtrooper Cards (one-shot):</div>
          {hand.map((cid, i) => {
            const c = DOOM_CARDS[cid];
            if (!c) return null;
            const targetable = !c.needsTarget || state.figures.some((f) => f.owner === corp && f.alive && f.woundsTaken > 0);
            return (
              <div key={cid + i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <button style={{ ...btn, fontSize: 11, padding: '3px 7px' }} disabled={!targetable} onClick={() => play(cid)} title={c.blurb}>▶ {c.name}</button>
                <span style={{ fontSize: 11, color: '#999' }}>{c.blurb}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#777' }}>No Doomtrooper Cards left.</div>
      )}
      {sec && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#b9a', borderTop: '1px solid #333', paddingTop: 6 }}>
          🎯 Secondary Mission: <b>{sec.name}</b> — {sec.blurb}
          <span style={{ color: '#888' }}> (+{sec.bonusPromotion} PP{sec.bonusCredits ? `, +${sec.bonusCredits}c` : ''})</span>
        </div>
      )}
    </Panel>
  );
};

const MultiplayerPanel: React.FC<{ missionId: string }> = ({ missionId }) => {
  const [invites, setInvites] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function create() {
    setBusy(true); setErr(null); setInvites(null);
    try {
      const r = await createOnlineGame(missionId);
      setInvites(r.invites);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Multiplayer (online)">
      <div style={{ fontSize: 12, color: '#bbb' }}>
        Create a server-hosted game and send each player their own private link. Turns are
        server-authoritative — opponents can't see your hidden cards. Play across devices.
      </div>
      <button style={{ ...btn, marginTop: 8 }} disabled={busy} onClick={create}>
        {busy ? 'Creating…' : '➕ Create Online Game'}
      </button>
      {err && <div style={{ color: '#f66', fontSize: 11, marginTop: 6 }}>{err}</div>}
      {invites && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: '#7c7', marginBottom: 4 }}>One link per seat — give each to a different player:</div>
          {Object.entries(invites).map(([seat, url]) => (
            <div key={seat} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 11, width: 64, color: seat === 'legion' ? '#f88' : '#8bf' }}>{seat}</span>
              <button
                style={{ ...btn, fontSize: 10, padding: '2px 6px', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                onClick={() => { navigator.clipboard?.writeText(url); setCopied(seat); }}
                title={url}
              >
                {copied === seat ? '✓ copied!' : '📋 copy link'}
              </button>
              <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#5af' }}>open</a>
            </div>
          ))}
          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>Open your own seat's link to play. Setup equipment is local-only; online games start unequipped.</div>
        </div>
      )}
    </Panel>
  );
};

const CampaignPanel: React.FC<{
  campaign: CampaignState | null;
  inCampaign: boolean;
  phase: string;
  onStart: () => void;
  onPlay: (c: CampaignState, missionId: string) => void;
  onReset: () => void;
  onEnableCloud: (c: CampaignState) => Promise<string>;
  onLoadFromCode: (code: string) => Promise<void>;
}> = ({ campaign, inCampaign, phase, onStart, onPlay, onReset, onEnableCloud, onLoadFromCode }) => {
  const busy = inCampaign && phase !== 'over'; // a campaign mission is mid-play
  const [codeInput, setCodeInput] = useState('');
  const [cloudMsg, setCloudMsg] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  return (
    <Panel title="Campaign">
      {!campaign ? (
        <div style={{ fontSize: 12, color: '#bbb' }}>
          A points race. Play the 10 missions in any order — or replay earlier ones — carrying
          your Rank, Promotion Points and Credits forward. First corporation to reach the points
          target wins.
          <button style={{ ...btn, marginTop: 8, background: '#2a6', fontWeight: 700 }} onClick={onStart}>▶ Start Campaign</button>
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #333' }}>
            <div style={{ color: '#999', marginBottom: 4 }}>Resume on this device with a campaign code:</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="e.g. K7QP2M" maxLength={6}
                style={{ flex: 1, background: '#111', color: '#ddd', border: '1px solid #444', borderRadius: 4, padding: '4px 6px', textTransform: 'uppercase', fontFamily: 'monospace' }} />
              <button style={btn} disabled={cloudBusy || codeInput.trim().length < 6} onClick={async () => {
                setCloudBusy(true); setCloudMsg(null);
                try { await onLoadFromCode(codeInput); } catch (e: any) { setCloudMsg(e?.message ?? 'Load failed.'); } finally { setCloudBusy(false); }
              }}>Resume</button>
            </div>
            {cloudMsg && <div style={{ color: '#e88', marginTop: 4 }}>{cloudMsg}</div>}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12 }}>
          {campaignWon(campaign) && (
            <div style={{ color: '#e8c349', fontWeight: 700, marginBottom: 6 }}>
              🏆 {campaign.champion} wins the campaign! ({campaign.target} pp reached)
            </div>
          )}
          {/* standings — leader highlighted */}
          <div style={{ marginBottom: 6 }}>
            {CAMPAIGN_CORPS.map((c) => {
              const lead = leader(campaign) === c;
              return (
                <div key={c} style={{ display: 'flex', justifyContent: 'space-between', color: lead ? '#fff' : '#aaa' }}>
                  <span>{lead ? '★ ' : ''}{c}</span>
                  <span>
                    <span style={{ color: '#7cf' }}>R{ranks(campaign)[c]}</span> ·{' '}
                    <span style={{ color: '#7c7' }}>{campaign.credits[c]}c</span> ·{' '}
                    <span style={{ color: '#e8c349' }}>{campaign.promotion[c]}/{campaign.target}pp</span>
                  </span>
                </div>
              );
            })}
          </div>
          {/* mission picker — play or replay any mission */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 230, overflowY: 'auto', marginBottom: 6 }}>
            {CAMPAIGN_MISSIONS.map((m, i) => {
              const done = !!campaign.completed[m.id];
              const isNext = suggestedMission(campaign)?.id === m.id;
              return (
                <button
                  key={m.id}
                  disabled={busy}
                  onClick={() => onPlay(campaign, m.id)}
                  title={done ? 'Completed — click to replay' : 'Not yet completed'}
                  style={{
                    ...btn, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    opacity: busy ? 0.5 : 1, background: isNext ? '#244' : undefined,
                    border: isNext ? '1px solid #2a6' : btn.border,
                  }}
                >
                  <span style={{ color: done ? '#7c7' : '#ddd' }}>
                    {done ? '✓' : '▸'} M{i + 1} {m.name.split(':')[1]?.trim() ?? m.name}
                  </span>
                  <span style={{ fontSize: 10, color: '#888' }}>{done ? 'replay' : isNext ? 'next' : 'play'}</span>
                </button>
              );
            })}
          </div>
          {busy && <div style={{ fontSize: 11, color: '#7c7', marginBottom: 6 }}>● Mission in progress — finish it to update standings.</div>}
          {allMissionsDone(campaign) && !campaignWon(campaign) && (
            <div style={{ fontSize: 11, color: '#7c7', marginBottom: 6 }}>🎖 All missions cleared — replay any to grow toward {campaign.target} pp.</div>
          )}
          {/* cross-device cloud save */}
          <div style={{ marginTop: 6, paddingTop: 8, borderTop: '1px solid #333' }}>
            {campaign.cloudCode ? (
              <div style={{ color: '#9c9' }}>
                ☁ Cross-device code: <b style={{ color: '#7cf', fontFamily: 'monospace', letterSpacing: 1 }}>{campaign.cloudCode}</b>
                <button style={{ ...btn, padding: '1px 6px', marginLeft: 6 }} onClick={() => { navigator.clipboard?.writeText(campaign.cloudCode!); setCloudMsg('Copied!'); }}>copy</button>
                <div style={{ color: '#888', marginTop: 2 }}>Enter this code on another device to continue. Synced after each mission.</div>
              </div>
            ) : (
              <button style={btn} disabled={cloudBusy} onClick={async () => {
                setCloudBusy(true); setCloudMsg(null);
                try { const code = await onEnableCloud(campaign); setCloudMsg(`Cloud code: ${code}`); }
                catch (e: any) { setCloudMsg(e?.message ?? 'Could not enable cloud save.'); }
                finally { setCloudBusy(false); }
              }}>☁ Enable cross-device save</button>
            )}
            {cloudMsg && <div style={{ color: '#9c9', marginTop: 4 }}>{cloudMsg}</div>}
          </div>
          <button style={{ ...btn, marginTop: 6 }} onClick={onReset}>Reset campaign</button>
        </div>
      )}
    </Panel>
  );
};

const EquipmentPanel: React.FC<{ state: GameState; submit: (a: Action) => void }> = ({ state, submit }) => {
  const corps = state.seats.filter((s) => !s.isLegion).map((s) => s.id);
  const [openCorp, setOpenCorp] = useState(corps[0]);
  const troopers = state.figures.filter((f) => f.owner === openCorp);
  const rank = state.rank[openCorp] ?? 1;
  return (
    <Panel title="Equip Doomtroopers (setup)">
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {corps.map((c) => (
          <button key={c} onClick={() => setOpenCorp(c)} style={{ ...btn, fontSize: 11, padding: '3px 7px', outline: openCorp === c ? '2px solid #e8c349' : 'none' }}>
            {c} ({state.credits[c] ?? 0}c)
          </button>
        ))}
      </div>
      {troopers.map((t) => (
        <div key={t.uid} style={{ marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #2a2a2a' }}>
          <div style={{ fontSize: 12, color: '#cde', fontWeight: 600 }}>{figureType(t.typeId).name}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {EQUIPMENT_LIST.map((e) => {
              const has = (t.equipment ?? []).includes(e.id);
              const locked = e.kind === 'weapon' && rank < e.rank;
              return (
                <button
                  key={e.id}
                  disabled={locked}
                  title={`${e.blurb}${e.kind === 'weapon' ? ` (needs Rank ${e.rank})` : ` (${e.cost} credit${e.cost === 1 ? '' : 's'})`}`}
                  onClick={() => submit({ type: 'equip', corp: openCorp, trooperUid: t.uid, cardId: e.id })}
                  style={{
                    ...btn, fontSize: 10, padding: '2px 6px',
                    opacity: locked ? 0.35 : 1,
                    background: has ? '#2a5a3a' : '#2d2d2d',
                    outline: has ? '1px solid #5c5' : 'none',
                  }}
                >
                  {e.name}{e.kind === 'gear' ? ` ·${e.cost}c` : ` ·R${e.rank}`}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: '#888' }}>Weapons are Rank-gated; gear costs Credits. Click again to remove.</div>
    </Panel>
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
          {a.count < a.total ? (
            <div style={{ background: '#3a2a14', border: '1px solid #a83', borderRadius: 6, padding: 8, marginBottom: 8, color: '#fc8' }}>
              ⚠ {a.total - a.count} new image(s) added since you loaded the module (e.g. the Citadel marker).
              Click <b>Update artwork</b> to re-extract them from your .vmod.
            </div>
          ) : (
            <>✓ Module artwork available ({a.count}/{a.total} images, cached on this device).</>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={btn} onClick={() => { a.clear(); }} title="Remove cached images, then Load .vmod again to re-extract">
              {a.count < a.total ? '↻ Update artwork (remove → reload .vmod)' : 'Remove artwork'}
            </button>
          </div>
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
