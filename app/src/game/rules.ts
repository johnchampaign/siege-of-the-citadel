import { Rng } from 'digital-boardgame-framework';
import type { GameState, Figure, Wall, DiceColor, FigureType } from './types';
import { HIT_THRESHOLD } from './types';

// ---------- board geometry ----------

/** Is (x,y) a real, playable square on some sector of the board? */
export function onBoard(state: GameState, x: number, y: number): boolean {
  for (const s of state.sectors) {
    if (x >= s.ox && x < s.ox + s.size && y >= s.oy && y < s.oy + s.size) return true;
  }
  return false;
}

export function figureAt(state: GameState, x: number, y: number): Figure | undefined {
  return state.figures.find((f) => f.alive && f.x === x && f.y === y);
}

// ---------- Citadel geometry ----------
//
// The Citadel is the big crosshair piece: 16x16 squares centred on a vertex
// where four sectors meet (cx,cy is that grid-line corner). It has a 2x2 base
// straddling the corner and four wings. Each wing is 8 squares long with the
// pattern [3 solid · 2 gap · 3 solid] — an inner segment, a doorway, then the
// outer node. Only the solid squares block movement and line of sight; the two
// gap squares in each wing are open doorways.

/** Distance index d (1..8) out from the centre along an arm → is it solid? */
function armSolid(d: number): boolean {
  return d >= 1 && d <= 8 && d !== 4 && d !== 5;
}

/** Is (x,y) a solid square of the Citadel crosshair? */
export function inCitadel(state: GameState, x: number, y: number): boolean {
  const c = state.citadel;
  if (!c) return false;
  const { cx, cy } = c;
  // vertical bar occupies the two columns straddling the corner (cx-1, cx)
  if (x === cx - 1 || x === cx) {
    const d = y < cy ? cy - y : y - cy + 1; // 1..8 out from the corner line
    if (armSolid(d)) return true;
  }
  // horizontal bar occupies the two rows straddling the corner (cy-1, cy)
  if (y === cy - 1 || y === cy) {
    const d = x < cx ? cx - x : x - cx + 1;
    if (armSolid(d)) return true;
  }
  return false;
}

/** Enumerate the solid Citadel squares (for rendering the fallback shape). */
export function citadelSolidCells(c: { cx: number; cy: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const fake = { citadel: c } as GameState;
  for (let y = c.cy - 8; y <= c.cy + 7; y++)
    for (let x = c.cx - 8; x <= c.cx + 7; x++)
      if (inCitadel(fake, x, y)) out.push({ x, y });
  return out;
}

const DIRS: Record<string, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
};

/** Is there a wall on the edge between (x,y) and the orthogonal neighbor in dir?
 *  Walls are stored once; we check both orientations. */
export function wallBetween(walls: Wall[], x: number, y: number, dir: 'N' | 'E' | 'S' | 'W'): boolean {
  const [dx, dy] = DIRS[dir];
  const nx = x + dx, ny = y + dy;
  const opp: Record<string, 'N' | 'E' | 'S' | 'W'> = { N: 'S', S: 'N', E: 'W', W: 'E' };
  return walls.some(
    (w) =>
      (w.x === x && w.y === y && w.dir === dir) ||
      (w.x === nx && w.y === ny && w.dir === opp[dir]),
  );
}

/** Can a figure step from (x,y) to an adjacent square (8-directional)?
 *  One square per step; cannot pass through walls or figures. Diagonal moves
 *  are blocked if BOTH flanking orthogonal edges are walled (can't squeeze
 *  through a wall corner). */
export function canStep(state: GameState, x: number, y: number, tx: number, ty: number): boolean {
  const dx = tx - x, dy = ty - y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;
  if (!onBoard(state, tx, ty)) return false;
  if (inCitadel(state, tx, ty)) return false; // the Citadel is solid
  if (figureAt(state, tx, ty)) return false;

  if (dx !== 0 && dy === 0) {
    return !wallBetween(state.walls, x, y, dx > 0 ? 'E' : 'W');
  }
  if (dy !== 0 && dx === 0) {
    return !wallBetween(state.walls, x, y, dy > 0 ? 'S' : 'N');
  }
  // diagonal: both component edges must be open
  const hWall = wallBetween(state.walls, x, y, dx > 0 ? 'E' : 'W');
  const vWall = wallBetween(state.walls, x, y, dy > 0 ? 'S' : 'N');
  return !hWall && !vWall;
}

/** Chebyshev distance — number of squares for diagonal-allowed movement. */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// ---------- line of sight ----------

/** Clear LOS from attacker square to target square: the straight line between
 *  square centers must not cross a wall or pass through another figure's square.
 *  Adjacent squares always have LOS. */
export function hasLineOfSight(state: GameState, ax: number, ay: number, bx: number, by: number): boolean {
  if (ax === bx && ay === by) return true;
  // Canonicalize endpoint order so LOS is symmetric: the sampling/rounding below
  // is direction-dependent, so without this hasLineOfSight(a,b) could disagree
  // with hasLineOfSight(b,a) — letting one figure shoot another that can't shoot
  // back. Both endpoints are excluded from blocking regardless of order.
  if (ax > bx || (ax === bx && ay > by)) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
  // Sample along the segment between centers; step through grid edges.
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 4;
  let px = ax, py = ay;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = ax + (bx - ax) * t;
    const cy = ay + (by - ay) * t;
    const gx = Math.round(cx);
    const gy = Math.round(cy);
    if (gx === px && gy === py) continue;
    // moving from (px,py) to (gx,gy): must not cross a wall
    const ddx = gx - px, ddy = gy - py;
    if (ddx !== 0 && wallBetween(state.walls, px, py, ddx > 0 ? 'E' : 'W')) return false;
    if (ddy !== 0 && wallBetween(state.walls, px, py, ddy > 0 ? 'S' : 'N')) return false;
    // intervening figure or the solid Citadel blocks the line of sight
    if (!(gx === bx && gy === by) && !(gx === ax && gy === ay)) {
      // Off-board: the line strays into a square that isn't part of the board
      // (e.g. the empty north-east of an L-/cross-shaped layout). There's no
      // square to shoot through and the tiles' outer frames wall it off, so the
      // board edge blocks the shot — you can't fire across the void.
      if (!onBoard(state, gx, gy)) return false;
      if (inCitadel(state, gx, gy)) return false;
      const f = figureAt(state, gx, gy);
      if (f) return false;
    }
    px = gx; py = gy;
  }
  return true;
}

// ---------- combat ----------

export function rollDice(rng: Rng, count: number, color: DiceColor): { dice: number[]; hits: number } {
  const dice: number[] = [];
  let hits = 0;
  const thr = HIT_THRESHOLD[color];
  for (let i = 0; i < count; i++) {
    const r = rng.rollDie(6);
    dice.push(r);
    if (r <= thr) hits++;
  }
  return { dice, hits };
}

export interface AttackOutcome {
  dice: number[];
  color: DiceColor;
  hits: number;
  kevlariteSaves: number;
  damage: number;      // wounds applied after armor + kevlarite
  killed: boolean;
  label: string;
}

/** Resolve an attack using the attacker/target *effective* types (equipment,
 *  rank and abilities already folded in). `targetWounds` is the target's current
 *  woundsTaken. The caller passes a live Rng (its state is advanced). */
/** Kevlarite save die colour by the trooper's Rank (better armour at higher rank). */
export function rankSaveColor(rank: number): DiceColor {
  if (rank >= 5) return 'black';
  if (rank >= 3) return 'red';
  return 'white';
}

export function resolveAttack(
  rng: Rng,
  at: FigureType,
  tt: FigureType,
  targetWounds: number,
  weaponIdx: number,
  saveColor: DiceColor = 'white',
): AttackOutcome {
  const weapon = at.weapons[weaponIdx];
  const { dice, hits } = rollDice(rng, weapon.dice, weapon.color);

  let kevlariteSaves = 0;
  if (tt.isTrooper && tt.kevlariteDice && hits > tt.armor) {
    // Kevlarite armor: roll the Rank-colour save die/dice; each hit absorbs one wound.
    const save = rollDice(rng, tt.kevlariteDice, saveColor);
    kevlariteSaves = save.hits;
  }

  const effective = Math.max(0, hits - tt.armor - kevlariteSaves);
  const remaining = tt.strength - targetWounds - effective;
  const killed = remaining <= 0;
  const label = `${at.name} → ${tt.name}: ${hits} hit${hits === 1 ? '' : 's'} (armor ${tt.armor}${
    kevlariteSaves ? `, ${kevlariteSaves} saved` : ''
  }) = ${effective} wound${effective === 1 ? '' : 's'}${killed ? ' — ELIMINATED' : ''}`;

  return { dice, color: weapon.color, hits, kevlariteSaves, damage: effective, killed, label };
}
