import React, { useState, useEffect } from 'react';
import { useAssets } from './assets';

// Interactive wall-tracing tool. Shows each 8x8 tile (the user's own loaded
// VASSAL art) and lets them click cell edges to toggle walls, then exports the
// list. Walls are single square-edge segments. Edge keys:
//   V,i,j  vertical line at column-boundary i (0..8), row j (0..7)
//   H,i,j  horizontal line at row-boundary j (0..8), column i (0..7)
// Tile grid geometry matches the board (90px cells, origin x0=50,y0=43).

const TILES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const N = 8;
const CELL = 58;
const SIZE = N * CELL;
const TILE_PX = 720, TILE_DX = 90, TILE_X0 = 50, TILE_Y0 = 43;
const HOT = 14; // clickable edge thickness
const STORE = 'siege-wall-edits';

type WallSet = Record<number, string[]>;

function load(): WallSet {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
}
function save(w: WallSet) { try { localStorage.setItem(STORE, JSON.stringify(w)); } catch { /* */ } }

export const WallEditor: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const assets = useAssets();
  const [tile, setTile] = useState(1);
  const [walls, setWalls] = useState<WallSet>(() => load());
  useEffect(() => save(walls), [walls]);

  const cur = new Set(walls[tile] ?? []);
  const toggle = (key: string) => {
    setWalls((w) => {
      const s = new Set(w[tile] ?? []);
      s.has(key) ? s.delete(key) : s.add(key);
      return { ...w, [tile]: [...s].sort() };
    });
  };
  const clearTile = () => setWalls((w) => ({ ...w, [tile]: [] }));

  const url = assets.getMap(`map${tile}.jpg`);
  const s = CELL / TILE_DX;
  const imgLeft = CELL / 2 - TILE_X0 * s;
  const imgTop = CELL / 2 - TILE_Y0 * s;

  // build clickable edge hotspots
  const hotspots: React.ReactNode[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i <= N; i++) {
    const key = `V,${i},${j}`; const on = cur.has(key);
    hotspots.push(<div key={key} onClick={() => toggle(key)} title={key}
      style={{ position: 'absolute', left: i * CELL - HOT / 2, top: j * CELL, width: HOT, height: CELL, cursor: 'pointer',
        background: on ? 'rgba(230,190,40,0.001)' : 'transparent' }} />);
  }
  for (let i = 0; i < N; i++) for (let j = 0; j <= N; j++) {
    const key = `H,${i},${j}`;
    hotspots.push(<div key={key} onClick={() => toggle(key)} title={key}
      style={{ position: 'absolute', left: i * CELL, top: j * CELL - HOT / 2, width: CELL, height: HOT, cursor: 'pointer' }} />);
  }

  // drawn wall segments
  const drawn = [...cur].map((key) => {
    const [o, a, b] = key.split(',').map((v, idx) => idx === 0 ? v : Number(v)) as [string, number, number];
    if (o === 'V') return <div key={key} style={{ position: 'absolute', left: a * CELL - 3, top: b * CELL, width: 6, height: CELL, background: '#e8b830', boxShadow: '0 0 4px #000', pointerEvents: 'none' }} />;
    return <div key={key} style={{ position: 'absolute', left: a * CELL, top: b * CELL - 3, width: CELL, height: 6, background: '#e8b830', boxShadow: '0 0 4px #000', pointerEvents: 'none' }} />;
  });

  const exportText = TILES.filter((t) => (walls[t] ?? []).length)
    .map((t) => `map${t}: ${(walls[t] ?? []).join(' ')}`).join('\n') || '(no walls marked yet)';

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif', color: '#ddd', minHeight: '100vh', background: '#161616' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20, color: '#e8c349', letterSpacing: 1 }}>WALL EDITOR</h1>
        <button style={btn} onClick={onBack}>← Back to game</button>
      </div>

      {!assets.loaded && (
        <div style={{ background: '#3a2a14', border: '1px solid #6a4', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13, maxWidth: 560 }}>
          ⚠ Load your VASSAL module first so the tiles show (Back → Visual Style → Load .vmod). You can still mark on the blank grid, but you won't see the art to trace.
        </div>
      )}

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
            {TILES.map((t) => (
              <button key={t} onClick={() => setTile(t)}
                style={{ ...btn, outline: tile === t ? '2px solid #e8c349' : 'none', fontWeight: tile === t ? 700 : 400 }}>
                map{t}{(walls[t] ?? []).length ? ` (${walls[t].length})` : ''}
              </button>
            ))}
          </div>

          {/* tile canvas */}
          <div style={{ position: 'relative', width: SIZE, height: SIZE, background: '#0c1016', border: '1px solid #444' }}>
            {url && <img src={url} alt={`map${tile}`} style={{ position: 'absolute', left: imgLeft, top: imgTop, width: TILE_PX * s, height: TILE_PX * s }} />}
            {/* grid lines */}
            {Array.from({ length: N + 1 }).map((_, i) => (
              <React.Fragment key={'g' + i}>
                <div style={{ position: 'absolute', left: i * CELL, top: 0, width: 1, height: SIZE, background: 'rgba(255,255,0,0.35)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: i * CELL, left: 0, height: 1, width: SIZE, background: 'rgba(255,255,0,0.35)', pointerEvents: 'none' }} />
              </React.Fragment>
            ))}
            {/* coords */}
            {Array.from({ length: N * N }).map((_, k) => {
              const cx = k % N, cy = Math.floor(k / N);
              return <span key={'c' + k} style={{ position: 'absolute', left: cx * CELL + 2, top: cy * CELL + 1, fontSize: 9, color: 'rgba(255,255,120,0.6)', pointerEvents: 'none' }}>{cx},{cy}</span>;
            })}
            {drawn}
            {hotspots}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={btn} onClick={clearTile}>Clear map{tile}</button>
            <span style={{ fontSize: 12, color: '#999', alignSelf: 'center' }}>Click an edge to toggle a wall. {cur.size} wall(s) on this tile.</span>
          </div>
        </div>

        <div style={{ flex: '1 1 320px', maxWidth: 460 }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 6 }}>Export — send this to me</div>
          <textarea readOnly value={exportText} rows={12}
            style={{ width: '100%', boxSizing: 'border-box', background: '#0e0e12', color: '#cde', border: '1px solid #444', borderRadius: 6, padding: 8, fontSize: 12, fontFamily: 'monospace' }} />
          <button style={{ ...btn, marginTop: 6 }} onClick={() => navigator.clipboard?.writeText(exportText)}>📋 Copy export</button>
          <div style={{ fontSize: 12, color: '#999', marginTop: 10, lineHeight: 1.6 }}>
            Marks save automatically on this device. When you've traced the tiles, copy the export and paste it back to me — I'll bake the walls into the engine.
            <br /><br />
            <b>Key:</b> <code style={{ color: '#9c9' }}>V,i,j</code> = vertical wall at the line left of column i, row j. <code style={{ color: '#9c9' }}>H,i,j</code> = horizontal wall at the line above row j, column i.
          </div>
        </div>
      </div>
    </div>
  );
};

const btn: React.CSSProperties = { background: '#2d2d2d', color: '#eee', border: '1px solid #555', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 13 };
