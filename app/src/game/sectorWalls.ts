import type { Wall, SectorPlacement } from './types';

// ---------------------------------------------------------------------------
// Interior walls per sector (8x8 local grid). These are designed room/corridor
// layouts aligned to the play grid — faithful in spirit to the original boards'
// chambers without pixel-tracing the (copyrighted) artwork. Walls travel with a
// sector wherever a mission places it.
//
// Helpers build runs of wall edges with deliberate gaps left as doorways.
// ---------------------------------------------------------------------------

type LW = Wall;

/** Vertical wall on the West edge of column `x`, rows y0..y1 inclusive (skip `gap` rows). */
function vRun(x: number, y0: number, y1: number, gaps: number[] = []): LW[] {
  const out: LW[] = [];
  for (let y = y0; y <= y1; y++) if (!gaps.includes(y)) out.push({ x, y, dir: 'W' });
  return out;
}
/** Horizontal wall on the North edge of row `y`, cols x0..x1 inclusive (skip `gap` cols). */
function hRun(y: number, x0: number, x1: number, gaps: number[] = []): LW[] {
  const out: LW[] = [];
  for (let x = x0; x <= x1; x++) if (!gaps.includes(x)) out.push({ x, y, dir: 'N' });
  return out;
}

// Local wall layouts keyed by sector id (1..9). Each leaves doorways so every
// square stays reachable.
const LOCAL: Record<number, LW[]> = {
  1: [ // a central room with two doorways
    ...hRun(2, 1, 6, [3]), ...hRun(5, 1, 6, [4]),
    ...vRun(2, 2, 4, [3]), ...vRun(6, 3, 4, [3]),
  ],
  2: [ // corridor down the middle
    ...vRun(3, 0, 3, [1]), ...vRun(5, 4, 7, [6]),
    ...hRun(4, 0, 2), ...hRun(4, 5, 7),
  ],
  3: [ // L-shaped chambers
    ...hRun(3, 0, 4, [2]), ...vRun(4, 0, 2),
    ...hRun(5, 3, 7, [5]), ...vRun(3, 5, 7, [6]),
  ],
  4: [ // two side rooms
    ...vRun(2, 1, 6, [3, 4]), ...vRun(6, 1, 6, [3, 4]),
  ],
  5: [ // cross of corridors
    ...hRun(4, 0, 2), ...hRun(4, 5, 7),
    ...vRun(4, 0, 2), ...vRun(4, 5, 7),
  ],
  6: [ // labyrinth-ish staggered walls
    ...hRun(2, 0, 3), ...hRun(3, 4, 7),
    ...hRun(5, 0, 3), ...hRun(6, 4, 7),
    ...vRun(4, 0, 1), ...vRun(4, 6, 7),
  ],
  7: [ // narrow alley
    ...vRun(2, 0, 7, [3, 4]), ...vRun(6, 0, 7, [3, 4]),
  ],
  8: [ // stair-stepped chambers
    ...hRun(2, 1, 3), ...hRun(4, 3, 5), ...hRun(6, 5, 7),
    ...vRun(3, 2, 3), ...vRun(5, 4, 5),
  ],
  9: [ // dual halls
    ...hRun(3, 0, 7, [3, 4]), ...hRun(5, 0, 7, [3, 4]),
  ],
};

/** Translate a sector's local interior walls into global coordinates. */
export function wallsForSector(sec: SectorPlacement): Wall[] {
  const local = LOCAL[sec.id] ?? [];
  return local.map((w) => ({ x: w.x + sec.ox, y: w.y + sec.oy, dir: w.dir }));
}

/** All interior walls for a set of placed sectors. */
export function wallsForSectors(sectors: SectorPlacement[]): Wall[] {
  return sectors.flatMap(wallsForSector);
}
