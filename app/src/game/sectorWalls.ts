import type { Wall, SectorPlacement } from './types';

// ---------------------------------------------------------------------------
// Interior + border walls for each tile, traced off the actual tile art with
// the in-app Wall Editor. Stored verbatim in the editor's export format and
// parsed here, so what's encoded is exactly what was marked.
//
// Editor edge format (8x8 cells, 0..7):
//   V,i,j = vertical wall on the line left of column i, at row j   (i: 0..8)
//   H,i,j = horizontal wall on the line above row j, at column i   (j: 0..8)
// i/j of 0 or 8 are the tile's outer border edges.
// ---------------------------------------------------------------------------

const TRACED: Record<number, string> = {
  1: 'H,0,0 H,0,8 H,1,0 H,1,8 H,2,0 H,2,8 H,5,0 H,5,8 H,6,0 H,6,8 H,7,0 H,7,8 V,0,0 V,0,1 V,0,2 V,0,5 V,0,6 V,0,7 V,8,0 V,8,1 V,8,2 V,8,5 V,8,6 V,8,7',
  2: 'H,0,0 H,0,3 H,0,5 H,0,8 H,1,0 H,1,8 H,2,0 H,2,3 H,2,5 H,2,8 H,3,5 H,4,5 H,5,0 H,5,3 H,5,5 H,5,8 H,6,0 H,6,8 H,7,0 H,7,3 H,7,5 H,7,8 V,0,0 V,0,1 V,0,2 V,0,5 V,0,6 V,0,7 V,3,0 V,3,1 V,3,2 V,3,5 V,3,6 V,3,7 V,5,0 V,5,1 V,5,2',
  3: 'H,0,3 H,0,5 H,0,8 H,1,3 H,1,5 H,1,8 H,2,8 H,3,4 H,4,4 H,5,8 H,6,4 H,6,5 H,6,8 H,7,3 H,7,5 H,7,8 V,0,0 V,0,1 V,0,2 V,0,5 V,0,6 V,0,7 V,2,5 V,3,0 V,3,1 V,3,2 V,3,3 V,3,6 V,3,7 V,5,4 V,5,5 V,5,7 V,7,3 V,8,5 V,8,6 V,8,7',
  4: 'H,0,0 H,0,8 H,1,0 H,1,8 H,2,0 H,2,2 H,2,6 H,2,8 H,3,2 H,3,6 H,4,2 H,4,6 H,5,0 H,5,6 H,5,8 H,6,0 H,6,3 H,6,8 H,7,0 H,7,3 H,7,8 V,0,0 V,0,1 V,0,2 V,0,5 V,0,6 V,0,7 V,2,2 V,2,4 V,2,5 V,5,0 V,5,1 V,6,3 V,6,5 V,8,5 V,8,6 V,8,7',
  5: 'H,0,0 H,0,8 H,1,0 H,1,3 H,1,5 H,1,8 H,2,0 H,2,8 H,5,0 H,5,3 H,5,5 H,5,8 H,6,0 H,6,8 H,7,0 H,7,3 H,7,5 H,7,8 V,0,0 V,0,1 V,0,2 V,0,5 V,0,6 V,0,7 V,1,3 V,1,4 V,3,0 V,3,1 V,3,2 V,3,5 V,3,6 V,3,7 V,4,3 V,4,4 V,5,0 V,5,1 V,5,2 V,5,5 V,5,6 V,5,7',
  6: 'H,0,0 H,0,3 H,0,8 H,1,0 H,1,4 H,1,8 H,2,0 H,2,2 H,2,4 H,2,7 H,2,8 H,3,1 H,3,3 H,3,4 H,3,7 H,4,1 H,4,3 H,4,6 H,4,7 H,5,0 H,5,3 H,5,6 H,5,8 H,6,0 H,6,3 H,6,6 H,6,8 H,7,0 H,7,1 H,7,5 H,7,8 V,0,0 V,0,1 V,0,2 V,0,5 V,0,6 V,0,7 V,1,3 V,2,1 V,2,5 V,2,6 V,3,0 V,3,2 V,4,4 V,4,5 V,5,1 V,5,7 V,7,1 V,7,3 V,7,4',
  7: 'H,0,0 H,0,5 H,0,8 H,1,0 H,1,8 H,2,0 H,2,4 H,2,8 H,3,4 H,4,1 H,4,4 H,4,5 H,4,7 H,5,0 H,5,3 H,5,8 H,6,0 H,6,5 H,6,8 H,7,0 H,7,3 H,7,5 H,7,8 V,0,0 V,0,1 V,0,2 V,0,3 V,0,4 V,0,5 V,0,6 V,0,7 V,1,3 V,1,4 V,3,0 V,3,1 V,3,3 V,3,4 V,3,6 V,3,7 V,4,5 V,4,6 V,5,1 V,5,2 V,5,3 V,5,7',
  8: 'H,0,3 H,0,5 H,0,8 H,1,3 H,1,5 H,1,8 H,2,8 H,5,8 H,6,3 H,6,5 H,6,8 H,7,3 H,7,5 H,7,8 V,0,5 V,0,6 V,0,7 V,3,0 V,3,1 V,3,6 V,3,7 V,5,0 V,5,1 V,5,6 V,5,7 V,8,0 V,8,1 V,8,2 V,8,6 V,8,7',
  9: 'H,0,0 H,0,8 H,1,0 H,1,8 H,2,0 H,2,8 H,5,0 H,5,8 H,6,0 H,6,8 H,7,0 H,7,8 V,0,0 V,0,1 V,0,2 V,0,5 V,0,6 V,0,7 V,8,0 V,8,1 V,8,2 V,8,5 V,8,6 V,8,7',
};

/** Parse one editor edge key into a local-cell Wall ({x,y,dir}). */
function parseEdge(key: string): Wall {
  const [o, si, sj] = key.split(',');
  const i = Number(si), j = Number(sj);
  if (o === 'V') return i <= 7 ? { x: i, y: j, dir: 'W' } : { x: 7, y: j, dir: 'E' };
  return j <= 7 ? { x: i, y: j, dir: 'N' } : { x: i, y: 7, dir: 'S' };
}

// local (per-tile) walls keyed by sector/tile id (1..9)
const LOCAL: Record<number, Wall[]> = Object.fromEntries(
  Object.entries(TRACED).map(([id, s]) => [Number(id), s.trim().split(/\s+/).filter(Boolean).map(parseEdge)]),
);

/** Translate a sector's local walls into global coordinates. */
export function wallsForSector(sec: SectorPlacement): Wall[] {
  const local = LOCAL[sec.id] ?? [];
  return local.map((w) => ({ x: w.x + sec.ox, y: w.y + sec.oy, dir: w.dir }));
}

/** All walls for a set of placed sectors. */
export function wallsForSectors(sectors: SectorPlacement[]): Wall[] {
  return sectors.flatMap(wallsForSector);
}
