import { Rng } from 'digital-boardgame-framework';
import type { GameState, Figure, Wall, DiceColor } from './types';
import { HIT_THRESHOLD } from './types';
import { figureType } from './data';

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
    // intervening figure (not the target, not the attacker) blocks
    if (!(gx === bx && gy === by) && !(gx === ax && gy === ay)) {
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

/** Resolve an attack from `attacker` against `target` with the given weapon.
 *  Mutates rng state on the caller side (we pass a live Rng). */
export function resolveAttack(rng: Rng, attacker: Figure, target: Figure, weaponIdx: number): AttackOutcome {
  const at = figureType(attacker.typeId);
  const tt = figureType(target.typeId);
  const weapon = at.weapons[weaponIdx];
  const { dice, hits } = rollDice(rng, weapon.dice, weapon.color);

  let kevlariteSaves = 0;
  if (tt.isTrooper && tt.kevlariteDice && hits > tt.armor) {
    // Kevlarite armor: roll save dice (white), each hit absorbs one wound.
    const save = rollDice(rng, tt.kevlariteDice, 'white');
    kevlariteSaves = save.hits;
  }

  const effective = Math.max(0, hits - tt.armor - kevlariteSaves);
  const remaining = tt.strength - target.woundsTaken - effective;
  const killed = remaining <= 0;
  const label = `${at.name} → ${tt.name}: ${hits} hit${hits === 1 ? '' : 's'} (armor ${tt.armor}${
    kevlariteSaves ? `, ${kevlariteSaves} saved` : ''
  }) = ${effective} wound${effective === 1 ? '' : 's'}${killed ? ' — ELIMINATED' : ''}`;

  return { dice, color: weapon.color, hits, kevlariteSaves, damage: effective, killed, label };
}
