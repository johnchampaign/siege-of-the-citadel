import React, { useMemo } from 'react';
import type { GameState, Action, Figure } from '../game/types';
import { figureType } from '../game/data';
import { useAssets } from './assets';
import { DesignedFigure, DesignedTile } from './designed';

const CELL = 40;

interface Props {
  state: GameState;
  legal: Action[];
  selected: string | null;
  weaponIdx: number;
  useArt: boolean; // true = render loaded VASSAL module art; false = designed theme
  onSelect: (uid: string | null) => void;
  onMove: (x: number, y: number) => void;
  onAttack: (targetUid: string) => void;
}

function boardBounds(s: GameState) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sec of s.sectors) {
    minX = Math.min(minX, sec.ox);
    minY = Math.min(minY, sec.oy);
    maxX = Math.max(maxX, sec.ox + sec.size);
    maxY = Math.max(maxY, sec.oy + sec.size);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export const Board: React.FC<Props> = ({ state, legal, selected, weaponIdx, useArt, onSelect, onMove, onAttack }) => {
  const assets = useAssets();
  const b = useMemo(() => boardBounds(state), [state.sectors]);
  const px = (gx: number) => (gx - b.minX) * CELL;
  const py = (gy: number) => (gy - b.minY) * CELL;

  // legal move/attack targets for the selected figure
  const moveTargets = new Set<string>();
  const attackTargets = new Map<string, number[]>();
  for (const a of legal) {
    if (selected && a.type === 'move' && a.uid === selected) moveTargets.add(`${a.x},${a.y}`);
    if (selected && a.type === 'attack' && a.uid === selected) {
      const arr = attackTargets.get(a.targetUid) ?? [];
      arr.push(a.weaponIdx);
      attackTargets.set(a.targetUid, arr);
    }
  }

  const activeFigs = new Set(
    state.figures.filter((f) => f.alive && f.owner === state.activeSeat).map((f) => f.uid),
  );

  return (
    <div
      style={{
        position: 'relative',
        width: b.w * CELL,
        height: b.h * CELL,
        background: '#0a0a0a',
        boxShadow: '0 0 40px #000 inset',
      }}
    >
      {/* sector backgrounds: module art if loaded + selected, else designed tile */}
      {state.sectors.map((sec) => {
        const url = useArt ? assets.getMap(sec.mapImage) : undefined;
        const common: React.CSSProperties = {
          position: 'absolute',
          left: px(sec.ox),
          top: py(sec.oy),
          width: sec.size * CELL,
          height: sec.size * CELL,
        };
        if (url) {
          return (
            <img key={sec.id + '-' + sec.ox} src={url} alt={`sector ${sec.id}`}
              style={{ ...common, imageRendering: 'auto', opacity: 0.92 }} />
          );
        }
        return (
          <div key={sec.id + '-' + sec.ox} style={common}>
            <DesignedTile id={sec.id} size={sec.size} cell={CELL} />
          </div>
        );
      })}

      {/* grid + clickable cells */}
      {state.sectors.map((sec) =>
        Array.from({ length: sec.size * sec.size }).map((_, i) => {
          const lx = i % sec.size;
          const ly = Math.floor(i / sec.size);
          const gx = sec.ox + lx;
          const gy = sec.oy + ly;
          const key = `${gx},${gy}`;
          const isMove = moveTargets.has(key);
          return (
            <div
              key={key}
              onClick={() => { if (isMove) onMove(gx, gy); }}
              style={{
                position: 'absolute',
                left: px(gx),
                top: py(gy),
                width: CELL,
                height: CELL,
                boxSizing: 'border-box',
                border: '1px solid rgba(255,255,255,0.08)',
                background: isMove ? 'rgba(80,200,120,0.35)' : 'transparent',
                cursor: isMove ? 'pointer' : 'default',
              }}
            />
          );
        }),
      )}

      {/* interior walls */}
      {state.walls.map((w, i) => {
        const lx = px(w.x), ty = py(w.y);
        const T = 4;
        const horiz = w.dir === 'N' || w.dir === 'S';
        const style: React.CSSProperties = {
          position: 'absolute',
          background: '#c9a23a',
          boxShadow: '0 0 3px #000',
          pointerEvents: 'none',
          left: w.dir === 'E' ? lx + CELL - T / 2 : w.dir === 'W' ? lx - T / 2 : lx,
          top: w.dir === 'S' ? ty + CELL - T / 2 : w.dir === 'N' ? ty - T / 2 : ty,
          width: horiz ? CELL : T,
          height: horiz ? T : CELL,
        };
        return <div key={'w' + i} style={style} />;
      })}

      {/* citadel */}
      {state.citadel && (
        <div
          style={{
            position: 'absolute',
            left: px(state.citadel.x),
            top: py(state.citadel.y),
            width: state.citadel.w * CELL,
            height: state.citadel.h * CELL,
            background: 'radial-gradient(circle, #3a0000, #120000)',
            border: '2px solid #7a1010',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#c33',
            fontSize: 10,
            fontWeight: 700,
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          CITADEL
        </div>
      )}

      {/* entrance arrows */}
      {state.legionEntrances.map((e, i) => (
        <div key={'le' + i} style={markerStyle(px(e.x), py(e.y), '#a22')} title="Dark Legion reinforcement">▲</div>
      ))}

      {/* figures */}
      {state.figures.filter((f) => f.alive).map((f) => {
        const ft = figureType(f.typeId);
        const isSel = f.uid === selected;
        const atkWeapons = attackTargets.get(f.uid);
        const canAttack = !!atkWeapons && atkWeapons.includes(weaponIdx);
        const isMine = f.owner === state.activeSeat;
        const canActivate = activeFigs.has(f.uid);
        // Dim figures that can't act/be acted on this turn so the active
        // seat's figures clearly stand out (the rest aren't clickable).
        const inPlay = state.phase === 'play';
        const dim = inPlay && !canActivate && !canAttack && !isSel;
        return (
          <div
            key={f.uid}
            onClick={() => {
              if (canAttack) onAttack(f.uid);
              else if (isMine) onSelect(isSel ? null : f.uid);
            }}
            title={`${ft.name} — ${ft.faction}\nstrength ${ft.strength - f.woundsTaken}/${ft.strength}, armor ${ft.armor}, actions ${f.actionsLeft}${canActivate ? '\n(your figure — click to select)' : ''}`}
            style={{
              position: 'absolute',
              left: px(f.x) + 2,
              top: py(f.y) + 2,
              width: CELL - 4,
              height: CELL - 4,
              borderRadius: 6,
              border: isSel
                ? '3px solid #6f6'
                : canAttack
                ? '3px solid #f44'
                : canActivate
                ? '3px solid #ffd24d'
                : f.owner === 'legion'
                ? '2px solid #b22'
                : '2px solid #28c',
              boxShadow: isSel ? '0 0 10px #6f6' : canActivate ? '0 0 10px #ffd24d' : canAttack ? '0 0 10px #f44' : 'none',
              background: '#111',
              cursor: canAttack || canActivate ? 'pointer' : 'default',
              overflow: 'hidden',
              opacity: dim ? 0.45 : 1,
              filter: dim ? 'grayscale(0.6)' : 'none',
              transition: 'opacity 0.15s, box-shadow 0.15s',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
            }}
          >
            {useArt && assets.getToken(ft.token) ? (
              <img
                src={assets.getToken(ft.token)}
                alt={ft.name}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <DesignedFigure ft={ft} />
            )}
            {/* wound pips */}
            {f.woundsTaken > 0 && (
              <div style={{ position: 'absolute', top: 1, left: 2, color: '#f55', fontSize: 9, fontWeight: 700, textShadow: '0 0 2px #000' }}>
                {'●'.repeat(Math.min(f.woundsTaken, 5))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

function markerStyle(left: number, top: number, color: string): React.CSSProperties {
  return {
    position: 'absolute',
    left,
    top,
    width: CELL,
    height: CELL,
    color,
    fontSize: 18,
    textAlign: 'center',
    lineHeight: `${CELL}px`,
    pointerEvents: 'none',
    opacity: 0.55,
  };
}
