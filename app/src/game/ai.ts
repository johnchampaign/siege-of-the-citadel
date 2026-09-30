import type { PlayerController, ControllerContext } from 'digital-boardgame-framework';
import type { GameState, Action, Figure, FigureType, Weapon, DiceColor } from './types';
import { HIT_THRESHOLD } from './types';
import {
  adapter, canTakeAction, moveRange, boostFor, armorOf, escapeAllowed, getSteps, totalPromotion,
} from './adapter';
import { effectiveType, figureType } from './data';
import { inCitadel, wallBlocksStep, dist, rankSaveColor, canStep } from './rules';
import { DOOM_CARDS } from './cards';

// Tactical AI for either side of Siege of the Citadel.
//
// One call = one atomic engine action (a single step, an attack, a card, a
// pass or end-turn), so the planner is stateless: every call re-plans from the
// state it is handed. It works one figure at a time and looks two actions ahead
// for that figure — "shoot, then duck back into cover", "step out and shoot",
// "run twice toward the exit" — scoring each option with exact dice odds and a
// position score for where the figure ends up:
//
//   position = −(distance to the mission objective)   pursue the objective
//              −(expected damage enemies can deal here) use cover / stay out of sight
//              +(best shot available from here)          set up the next attack
//
// It only reads the state it is given (the server hands it the seat's redacted
// view) and only ever returns an action from the engine's own legalActions().

// ---------- tuning (value units ≈ Promotion Points) ----------
const W_WOUND = 1.5;       // one wound on a Doomtrooper
const W_TKILL = 10;        // eliminating a Doomtrooper
const OBJ_BONUS = 40;      // killing a figure the mission is about (boss, doorway, computer)
const ESCAPE_VALUE = 40;   // a trooper stepping off through an exit
const WIN_VALUE = 200;     // a move that completes the mission outright
const OPP_W = 0.35;        // weight of the shot a square sets up for later
const SHOTS_FIRE = 1.2;    // how many shots an enemy that can see a square is expected to take at it
const SHOTS_MELEE = 1.0;
const TOP_K = 6;           // squares explored for a second move
const EPS = 1e-6;
// Legion creatures are expendable: how much one minds being shot at, and how
// hard it closes in (melee / ranged). Tuned by self-play against the AI
// troopers: halving the caution from 0.6 roughly doubled trooper kills while
// still keeping creatures out of needless lines of fire.
const LEGION_RISK = 0.3;
const LEGION_PUSH = 0.7;
const LEGION_PUSH_RANGED = 0.4;

/** How much a Legion figure matters beyond its Promotion value (its threat). */
const DANGER: Record<string, number> = {
  legionnaire: 1, necromutant: 1.5, centurion: 2, razide: 3, nepharite: 4, ezoghoul: 4, alakhai: 5,
  door: 0, computer: 0,
};

const PHIT: Record<DiceColor, number> = {
  white: HIT_THRESHOLD.white / 6, red: HIT_THRESHOLD.red / 6, black: HIT_THRESHOLD.black / 6,
};

// ---------- dice odds ----------

const binomCache = new Map<number, number[]>();
/** P(k hits) for k = 0..n dice, each hitting with probability p. */
function binom(n: number, p: number): number[] {
  const key = n * 10 + Math.round(p * 6);
  let pmf = binomCache.get(key);
  if (!pmf) {
    pmf = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(pmf.length + 1).fill(0);
      for (let k = 0; k < pmf.length; k++) { next[k] += pmf[k] * (1 - p); next[k + 1] += pmf[k] * p; }
      pmf = next;
    }
    binomCache.set(key, pmf);
  }
  return pmf;
}

interface Outcome { eDmg: number; pKill: number; pAny: number }

/** Exact outcome of one attack roll: `shift` fewer hits land (a blast's edge),
 *  armor soaks, then Kevlarite saves (troopers only, rolled when hits beat armor). */
function outcome(dice: number, color: DiceColor, armor: number, kev: number, saveColor: DiceColor, remaining: number, shift = 0): Outcome {
  const ph = binom(dice, PHIT[color]);
  const ps = kev > 0 ? binom(kev, PHIT[saveColor]) : [1];
  let eDmg = 0, pKill = 0, pAny = 0;
  for (let h = 0; h < ph.length; h++) {
    const hh = h - shift;
    if (hh <= armor) continue;
    for (let sv = 0; sv < ps.length; sv++) {
      const d = hh - armor - sv;
      if (d <= 0) continue;
      const p = ph[h] * ps[sv];
      pAny += p;
      eDmg += p * Math.min(d, remaining);
      if (d >= remaining) pKill += p;
    }
  }
  return { eDmg, pKill, pAny };
}

// ---------- per-decision context ----------

const K = (x: number, y: number) => (y + 4) * 256 + (x + 4);
const KX = (k: number) => (k % 256) - 4;
const KY = (k: number) => Math.floor(k / 256) - 4;

interface ReachNode { k: number; x: number; y: number; d: number; parent: number; escape: boolean }

interface Ctx {
  s: GameState;
  actor: string;
  legion: boolean;                  // the actor is the Dark Legion
  enemies: Figure[];                // living figures of the other side
  friends: Figure[];                // living figures on the actor's side (every corp, for troopers)
  open: Set<number>;                // playable squares: on a sector, not the Citadel base
  occ: Map<number, Figure>;
  exits: Set<number>;
  unrevealed: Set<number>;          // sector ids still holding a face-down Force Card
  goal: Map<number, number> | null; // distance field to this side's objective
  goalSrc: { x: number; y: number }[];
  types: Map<string, FigureType>;
  los: Map<number, Map<number, boolean>>;         // vacated square → pair → sight
  pos: Map<string, number>;                       // uid@square → position value
  meleeReach: Map<string, Map<number, number>>;   // enemy uid → steps to each square
}

function typeOf(c: Ctx, f: Figure): FigureType {
  let t = c.types.get(f.uid);
  if (!t) { t = effectiveType(f, c.s.rank[f.owner] ?? 1, boostFor(c.s, f)); c.types.set(f.uid, t); }
  return t;
}

function isObjective(s: GameState, f: Figure): boolean {
  return s.win.kind === 'eliminate-tagged' && f.tag === s.win.tag;
}

// Distance fields depend only on the board and the sources, and the walls
// array is shared by every state of a mission (adapter clone), so memoise per
// walls array: the same objective/enemy field is reused across a whole turn.
const fieldMemo = new WeakMap<object, Map<string, Map<number, number>>>();

/** Multi-source BFS through playable squares (walls block, figures don't). */
function distanceField(c: Ctx, sources: { x: number; y: number }[], start = 0, maxD = Infinity): Map<number, number> {
  let memo = fieldMemo.get(c.s.walls);
  if (!memo) { memo = new Map(); fieldMemo.set(c.s.walls, memo); }
  const key = `${c.s.walls.length}|${start}|${maxD}|${sources.map((p) => K(p.x, p.y)).join(',')}`;
  const hit = memo.get(key);
  if (hit) return hit;
  if (memo.size > 500) memo.clear();
  const d = computeField(c, sources, start, maxD);
  memo.set(key, d);
  return d;
}

function computeField(c: Ctx, sources: { x: number; y: number }[], start: number, maxD: number): Map<number, number> {
  const d = new Map<number, number>();
  const q: number[] = [];
  for (const p of sources) {
    const k = K(p.x, p.y);
    if (!d.has(k)) { d.set(k, start); q.push(k); }
  }
  for (let h = 0; h < q.length; h++) {
    const k = q[h], x = KX(k), y = KY(k), dk = d.get(k)!;
    if (dk >= maxD) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nk = K(x + dx, y + dy);
      if (d.has(nk) || !c.open.has(nk)) continue;
      if (wallBlocksStep(c.s.walls, x, y, x + dx, y + dy, true)) continue;
      d.set(nk, dk + 1);
      q.push(nk);
    }
  }
  return d;
}

function buildCtx(s: GameState, actor: string): Ctx {
  const legion = actor === 'legion';
  const alive = s.figures.filter((f) => f.alive);
  const c: Ctx = {
    s, actor, legion,
    enemies: alive.filter((f) => (f.owner === 'legion') !== legion),
    friends: alive.filter((f) => (f.owner === 'legion') === legion),
    open: new Set(), occ: new Map(), exits: new Set(s.exits.map((e) => K(e.x, e.y))),
    unrevealed: new Set(s.forceCards.filter((f) => !f.revealed).map((f) => f.sectorId)),
    goal: null, goalSrc: [], types: new Map(), los: new Map(), pos: new Map(), meleeReach: new Map(),
  };
  for (const sec of s.sectors)
    for (let y = sec.oy; y < sec.oy + sec.size; y++)
      for (let x = sec.ox; x < sec.ox + sec.size; x++)
        if (!inCitadel(s, x, y)) c.open.add(K(x, y));
  for (const f of alive) c.occ.set(K(f.x, f.y), f);

  if (legion) {
    // Hunt the Doomtroopers.
    c.goalSrc = c.enemies.map((f) => ({ x: f.x, y: f.y }));
  } else {
    const w = s.win;
    const toExits = w.kind === 'escape' || (w.kind === 'promotion' && w.escape && escapeAllowed(s));
    if (toExits) c.goalSrc = [...s.exits];
    else if (w.kind === 'eliminate-tagged') c.goalSrc = c.enemies.filter((f) => f.tag === w.tag);
    else if (w.kind === 'eliminate-all' || w.kind === 'promotion') {
      // Find and fight the Legion: living creatures, plus sectors still hiding a Force Card.
      c.goalSrc = c.enemies.map((f) => ({ x: f.x, y: f.y }));
      for (const sec of s.sectors) {
        if (!c.unrevealed.has(sec.id)) continue;
        for (let y = sec.oy; y < sec.oy + sec.size; y++)
          for (let x = sec.ox; x < sec.ox + sec.size; x++) if (c.open.has(K(x, y))) c.goalSrc.push({ x, y });
      }
    }
  }
  if (c.goalSrc.length) {
    c.goal = distanceField(c, c.goalSrc);
    // Escape missions: the Legion also bars the exits (troopers must come to them).
    if (legion && (s.win.kind === 'escape' || (s.win.kind === 'promotion' && s.win.escape)) && s.exits.length) {
      const guard = distanceField(c, s.exits, 3);
      c.goal = new Map(c.goal); // fields are memoised and shared — merge into a copy
      for (const [k, v] of guard) if (v < (c.goal.get(k) ?? Infinity)) c.goal.set(k, v);
    }
  }
  return c;
}

function goalDist(c: Ctx, x: number, y: number): number {
  if (!c.goal) return 0;
  const d = c.goal.get(K(x, y));
  if (d !== undefined) return d;
  // Walled off from every objective square: fall back to straight-line distance.
  let best = Infinity;
  for (const p of c.goalSrc) best = Math.min(best, dist(x, y, p.x, p.y));
  return best === Infinity ? 0 : best + 10;
}

// ---------- line of sight (mirrors rules.hasLineOfSight, with the mover's square vacated) ----------

function losRaw(c: Ctx, ax: number, ay: number, bx: number, by: number, vac: number): boolean {
  if (ax === bx && ay === by) return true;
  if (ax > bx || (ax === bx && ay > by)) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 4;
  let px = ax, py = ay;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const gx = Math.round(ax + (bx - ax) * t);
    const gy = Math.round(ay + (by - ay) * t);
    if (gx === px && gy === py) continue;
    if (wallBlocksStep(c.s.walls, px, py, gx, gy)) return false;
    if (!(gx === bx && gy === by) && !(gx === ax && gy === ay)) {
      const k = K(gx, gy);
      if (!c.open.has(k)) return false;
      if (k !== vac && c.occ.has(k)) return false;
    }
    px = gx; py = gy;
  }
  return true;
}

function los(c: Ctx, ax: number, ay: number, bx: number, by: number, vac: number): boolean {
  const a = K(ax, ay), b = K(bx, by);
  const key = a < b ? a * 16384 + b : b * 16384 + a;
  let m = c.los.get(vac);
  if (!m) { m = new Map(); c.los.set(vac, m); }
  let r = m.get(key);
  if (r === undefined) { r = losRaw(c, ax, ay, bx, by, vac); m.set(key, r); }
  return r;
}

/** Test hook: the AI's sight line must agree with the engine's. */
export function aiLineOfSight(s: GameState, ax: number, ay: number, bx: number, by: number): boolean {
  return losRaw(buildCtx(s, 'legion'), ax, ay, bx, by, -1);
}

// ---------- attack values ----------

/** What killing this Legion figure is worth to the Doomtroopers. */
function legionValue(c: Ctx, f: Figure): number {
  const s = c.s;
  let v = figureType(f.typeId).promotion * (s.win.kind === 'promotion' ? 1.5 : 1) + (DANGER[f.typeId] ?? 1);
  if (isObjective(s, f)) v += OBJ_BONUS;
  if (s.win.kind === 'eliminate-all') v += 1;
  return v;
}

/** Value, to the attacker's side, of one attack outcome landing on `t`. */
function hitValue(c: Ctx, attacker: Figure, t: Figure, o: Outcome): number {
  const atkLegion = attacker.owner === 'legion';
  const tLegion = t.owner === 'legion';
  if (atkLegion === tLegion) {
    if (atkLegion || t.uid === attacker.uid) return 0;
    // Friendly fire: the wounds, plus 3 Promotion Points if any land.
    return -(o.eDmg * W_WOUND + o.pKill * W_TKILL + 3 * o.pAny);
  }
  return tLegion ? o.pKill * legionValue(c, t) : o.eDmg * W_WOUND + o.pKill * W_TKILL;
}

function outcomeVs(c: Ctx, w: Weapon, t: Figure, shift = 0): Outcome {
  const tt = typeOf(c, t);
  const armor = armorOf(c.s, t, tt);
  const kev = tt.isTrooper ? tt.kevlariteDice ?? 0 : 0;
  return outcome(w.dice, w.color, armor, kev, rankSaveColor(c.s.rank[t.owner] ?? 1), Math.max(1, tt.strength - t.woundsTaken), shift);
}

/** Expected value of attacker `a` (standing at x,y) attacking `t` with `w`,
 *  including every figure an area weapon would catch. `alive` discounts
 *  targets an earlier attack in the plan may already have killed. */
function attackValue(c: Ctx, a: Figure, x: number, y: number, t: Figure, w: Weapon, vac: number, alive?: Map<string, number>): number {
  const live = (f: Figure) => alive?.get(f.uid) ?? 1;
  if (!w.area) return live(t) * hitValue(c, a, t, outcomeVs(c, w, t));
  let v = 0;
  const others = c.s.figures.filter((g) => g.alive && g.uid !== a.uid);
  if (w.area === 'blast') {
    v += live(t) * hitValue(c, a, t, outcomeVs(c, w, t));
    for (const g of others) if (g.uid !== t.uid && dist(t.x, t.y, g.x, g.y) === 1) v += live(g) * hitValue(c, a, g, outcomeVs(c, w, g, 1));
  } else if (w.area === 'swing') {
    for (const g of others) if (dist(x, y, g.x, g.y) === 1) v += live(g) * hitValue(c, a, g, outcomeVs(c, w, g));
  } else if (w.area === 'line') {
    for (const g of others) {
      const d = dist(x, y, g.x, g.y);
      if (d < 1 || d > w.range) continue;
      const cross = (t.x - x) * (g.y - y) - (t.y - y) * (g.x - x);
      const dot = (g.x - x) * (t.x - x) + (g.y - y) * (t.y - y);
      if (cross !== 0 || dot < 0 || !los(c, x, y, g.x, g.y, vac)) continue;
      v += live(g) * hitValue(c, a, g, outcomeVs(c, w, g));
    }
  } else if (w.area === 'double') {
    v += live(t) * hitValue(c, a, t, outcomeVs(c, w, t));
    const second = c.enemies
      .filter((g) => g.uid !== t.uid && dist(x, y, g.x, g.y) <= w.range && los(c, x, y, g.x, g.y, vac))
      .sort((p, q) => dist(t.x, t.y, p.x, p.y) - dist(t.x, t.y, q.x, q.y))[0];
    if (second) v += live(second) * hitValue(c, a, second, outcomeVs(c, w, second));
  }
  return v;
}

interface AttackOpt { t: Figure; w: Weapon; idx: number; v: number }

/** Every attack figure `f` could make from (x,y) — the same tests legalActions applies. */
function attackOptions(c: Ctx, f: Figure, x: number, y: number, vac: number, alive?: Map<string, number>): AttackOpt[] {
  const s = c.s;
  const ft = typeOf(c, f);
  const trooper = f.owner !== 'legion';
  const out: AttackOpt[] = [];
  for (const t of c.enemies) {
    if ((alive?.get(t.uid) ?? 1) <= 0.02) continue;
    if (!trooper && s.roundFx.shield?.[t.owner]) continue;
    const d = dist(x, y, t.x, t.y);
    ft.weapons.forEach((w, idx) => {
      if (w.kind === 'close') {
        if (trooper && (s.roundFx.noMelee || s.missionFx.noMeleeVs?.[f.owner]?.includes(t.typeId))) return;
        if (d !== 1 || wallBlocksStep(s.walls, x, y, t.x, t.y)) return;
      } else {
        if (trooper && s.roundFx.noFirearm) return;
        if (d < 1 || d > w.range || !los(c, x, y, t.x, t.y, vac)) return;
      }
      out.push({ t, w, idx, v: attackValue(c, f, x, y, t, w, vac, alive) });
    });
  }
  return out;
}

function bestAttack(c: Ctx, f: Figure, x: number, y: number, vac: number, alive?: Map<string, number>): number {
  let best = 0;
  for (const o of attackOptions(c, f, x, y, vac, alive)) if (o.v > best) best = o.v;
  return best;
}

// ---------- position value ----------

/** Squares enemy `e` can walk to within `maxD` steps (walls block, figures ignored). */
function reachOf(c: Ctx, e: Figure, maxD: number): Map<number, number> {
  let m = c.meleeReach.get(e.uid);
  if (!m) { m = distanceField(c, [{ x: e.x, y: e.y }], 0, maxD); c.meleeReach.set(e.uid, m); }
  return m;
}

/** Expected cost to `f`'s side of standing on (x,y) through the enemies' next
 *  turn: every enemy that can see it and shoot, or walk up and strike. */
function exposure(c: Ctx, f: Figure, x: number, y: number, vac: number): number {
  const s = c.s;
  const ft = typeOf(c, f);
  const cost = (o: Outcome) => (f.owner === 'legion' ? o.pKill * legionValue(c, f) : o.eDmg * W_WOUND + o.pKill * W_TKILL);
  const armor = ft.armor;
  const kev = ft.isTrooper ? ft.kevlariteDice ?? 0 : 0;
  const saveColor = rankSaveColor(s.rank[f.owner] ?? 1);
  const remaining = Math.max(1, ft.strength - f.woundsTaken);
  let total = 0;
  for (const e of c.enemies) {
    const et = typeOf(c, e);
    const actions = figureType(e.typeId).actions;
    if (!actions || !et.weapons.length) continue;
    const d = dist(e.x, e.y, x, y);
    let best = 0;
    for (const w of et.weapons) {
      if (w.kind === 'firearm') {
        if (d > w.range || d < 1 || !los(c, e.x, e.y, x, y, vac)) continue;
        best = Math.max(best, SHOTS_FIRE * cost(outcome(w.dice, w.color, armor, kev, saveColor, remaining)));
      } else {
        const R = moveRange(s, e);
        const maxD = R * (actions - 1) + 1;
        if (d > maxD) continue;
        const steps = reachOf(c, e, maxD).get(K(x, y));
        if (steps === undefined || steps > maxD) continue;
        best = Math.max(best, SHOTS_MELEE * cost(outcome(w.dice, w.color, armor, kev, saveColor, remaining)));
      }
    }
    total += best;
  }
  return total;
}

function sectorIdAt(s: GameState, x: number, y: number): number | null {
  const sec = s.sectors.find((q) => x >= q.ox && x < q.ox + q.size && y >= q.oy && y < q.oy + q.size);
  return sec ? sec.id : null;
}

/** Per-figure weights: how hard it pushes toward the objective, how much it
 *  minds being shot at. */
function weights(c: Ctx, f: Figure): { wObj: number; risk: number } {
  const s = c.s;
  if (f.owner === 'legion') {
    if (isObjective(s, f)) return { wObj: 0.05, risk: 1 };        // the boss keeps its head down
    const ranged = typeOf(c, f).weapons.some((w) => w.kind === 'firearm');
    const risk = LEGION_RISK * (s.win.kind === 'promotion' ? 1.3 : 1); // every kill feeds their Promotion total
    return { wObj: ranged ? LEGION_PUSH_RANGED : LEGION_PUSH, risk };
  }
  const w = s.win;
  let wObj = 0.45, risk = 1;
  if (!c.goal) wObj = 0;                                           // survive: no destination, just live
  else if (w.kind === 'escape' || (w.kind === 'promotion' && escapeAllowed(s))) { wObj = 1.2; risk = 0.5; }
  else if (w.kind === 'eliminate-tagged') wObj = 0.6;
  if (w.kind === 'survive') risk = 1.5;
  // The clock favours the Legion: press harder as the time limit nears.
  if (c.goal && s.timeLimitRounds < 90 && s.timeLimitRounds - s.round < 3) wObj *= 1.5;
  return { wObj, risk };
}

function posValue(c: Ctx, f: Figure, x: number, y: number, vac: number): number {
  const key = `${f.uid}@${K(x, y)}`;
  const hit = c.pos.get(key);
  if (hit !== undefined) return hit;
  const s = c.s;
  const { wObj, risk } = weights(c, f);
  let v = -wObj * goalDist(c, x, y) - risk * exposure(c, f, x, y, vac) + OPP_W * bestAttack(c, f, x, y, vac);
  if (f.owner !== 'legion') {
    // Waking a face-down Force Card is only worth it when the Legion is the objective.
    const sec = sectorIdAt(s, x, y);
    const hunting = s.win.kind === 'eliminate-all' || (s.win.kind === 'promotion' && !escapeAllowed(s));
    if (sec != null && c.unrevealed.has(sec) && !hunting) v -= 3;
    if (s.win.kind === 'survive') {
      // Holding out: stay near a teammate rather than getting picked off alone.
      let near = Infinity;
      for (const g of c.friends) if (g.uid !== f.uid) near = Math.min(near, dist(x, y, g.x, g.y));
      if (near !== Infinity) v -= 0.2 * Math.max(0, near - 2);
    }
  }
  c.pos.set(key, v);
  return v;
}

// ---------- movement ----------

function escapeValue(c: Ctx): number {
  const w = c.s.win;
  if (w.kind === 'escape') return c.s.escaped + 1 >= w.count ? WIN_VALUE : ESCAPE_VALUE;
  if (w.kind === 'promotion' && w.escape && totalPromotion(c.s) >= w.points) return WIN_VALUE;
  return ESCAPE_VALUE;
}

/** Squares `f` can reach from (x,y) in ≤ budget single steps, honouring the
 *  engine's canStep rules. Stepping onto an open exit ends the walk (escape). */
function reach(c: Ctx, f: Figure, x: number, y: number, budget: number, vac: number): Map<number, ReachNode> {
  const s = c.s;
  const phase = s.roundFx.phase === f.owner;
  const canEscape = f.owner !== 'legion' && escapeAllowed(s);
  const start = K(x, y);
  const out = new Map<number, ReachNode>([[start, { k: start, x, y, d: 0, parent: -1, escape: false }]]);
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const n = out.get(q[h])!;
    if (n.d >= budget || n.escape) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = n.x + dx, ny = n.y + dy, nk = K(nx, ny);
      if (out.has(nk) || !c.open.has(nk)) continue;
      if (nk !== vac && c.occ.has(nk)) continue;
      if (!phase && wallBlocksStep(s.walls, n.x, n.y, nx, ny, true)) continue;
      out.set(nk, { k: nk, x: nx, y: ny, d: n.d + 1, parent: n.k, escape: canEscape && c.exits.has(nk) });
      q.push(nk);
    }
  }
  return out;
}

/** The squares walked from the start to `to`, in order (start excluded). */
function pathTo(r: Map<number, ReachNode>, to: ReachNode): Step[] {
  const out: Step[] = [];
  for (let n = to; n.parent !== -1; n = r.get(n.parent)!) out.push({ x: n.x, y: n.y });
  return out.reverse();
}

function firstStep(r: Map<number, ReachNode>, to: ReachNode): ReachNode {
  let n = to;
  while (n.parent !== -1 && r.get(n.parent)!.parent !== -1) n = r.get(n.parent)!;
  return n;
}

// ---------- planning one figure ----------

type Step = { x: number; y: number };
interface Plan { act: Action | null; value: number; stop: number; path?: Step[] }

/** Best next action for `f` with `n` actions to spend and `free` steps left on
 *  a move already paid for. Two-action lookahead; end squares scored by posValue. */
function planFigure(c: Ctx, f: Figure, n: number, free: number): Plan {
  const vac = K(f.x, f.y);
  const R = moveRange(c.s, f);
  const stop = posValue(c, f, f.x, f.y, vac);
  let best: Plan = { act: null, value: stop, stop };
  const consider = (act: Action, v: number, path?: Step[]) => { if (v > best.value + EPS) best = { act, value: v, stop, path }; };

  const squareValue = (node: ReachNode) => (node.escape ? escapeValue(c) : posValue(c, f, node.x, node.y, vac));
  const here = (n >= 1 || free > 0) ? reach(c, f, f.x, f.y, free > 0 ? free : R, vac) : null;
  const fresh = free > 0 ? null : here; // squares one full move action away from here

  /** Value after spending an action at (x,y) with k actions still to use. */
  const follow = (x: number, y: number, k: number, alive?: Map<string, number>, r?: Map<number, ReachNode> | null): number => {
    const stay = posValue(c, f, x, y, vac);
    if (k <= 0) return stay;
    let v = stay + bestAttack(c, f, x, y, vac, alive);
    const moves = r ?? reach(c, f, x, y, R, vac);
    for (const node of moves.values()) if (node.d > 0) v = Math.max(v, squareValue(node));
    return v;
  };

  // 1) Attack from where it stands (then shoot again, or duck into cover).
  if (n >= 1) {
    for (const o of attackOptions(c, f, f.x, f.y, vac)) {
      const alive = new Map([[o.t.uid, 1 - outcomeVs(c, o.w, o.t).pKill]]);
      consider({ type: 'attack', uid: f.uid, targetUid: o.t.uid, weaponIdx: o.idx }, o.v + follow(f.x, f.y, n - 1, alive, fresh));
    }
  }

  // 2) Move somewhere (then attack from there, or keep going).
  if (here) {
    const after = free > 0 ? n : n - 1;
    // A trooper's move into (or within) a sector with a face-down Force Card
    // flips it — standing there isn't enough, so reward the move itself when
    // the Legion is what we're hunting.
    const hunting = f.owner !== 'legion'
      && (c.s.win.kind === 'eliminate-all' || (c.s.win.kind === 'promotion' && !escapeAllowed(c.s)));
    const cands: { node: ReachNode; v: number }[] = [];
    for (const node of here.values()) {
      if (node.d === 0) continue;
      if (node.escape) { cands.push({ node, v: escapeValue(c) }); continue; }
      let v = posValue(c, f, node.x, node.y, vac);
      if (hunting) { const sec = sectorIdAt(c.s, node.x, node.y); if (sec != null && c.unrevealed.has(sec)) v += 3; }
      if (after >= 1) v += bestAttack(c, f, node.x, node.y, vac);
      cands.push({ node, v });
    }
    if (after >= 1) {
      // Worth a second move? Explore the most promising squares, and the ones
      // that get furthest toward the objective (a run passes through exposed squares).
      const byV = [...cands].sort((a, b) => b.v - a.v).slice(0, TOP_K);
      const byGoal = [...cands].sort((a, b) => goalDist(c, a.node.x, a.node.y) - goalDist(c, b.node.x, b.node.y)).slice(0, TOP_K);
      for (const cand of new Set([...byV, ...byGoal])) {
        if (cand.node.escape) continue;
        const r2 = reach(c, f, cand.node.x, cand.node.y, R, vac);
        for (const node of r2.values()) if (node.d > 0) cand.v = Math.max(cand.v, squareValue(node));
      }
    }
    for (const cand of cands) {
      const step = firstStep(here, cand.node);
      consider({ type: 'move', uid: f.uid, x: step.x, y: step.y }, cand.v, pathTo(here, cand.node));
    }
  }
  return best;
}

// ---------- Doomtrooper Cards ----------

function toughestLegion(s: GameState): Figure | undefined {
  return s.figures.filter((f) => f.alive && f.owner === 'legion')
    .sort((a, b) => figureType(b.typeId).armor - figureType(a.typeId).armor)[0];
}

/** Play a card when its (auto-targeted) effect clearly helps. Sabotage powers
 *  aimed at other corporations are never played — AI corps cooperate. */
function pickCard(c: Ctx, legal: Action[], mine: Figure[]): Action | null {
  const s = c.s;
  const legionStillToAct = s.drawOrder.includes('legion');
  const attacks = legal.filter((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack');
  const turnStart = mine.every((f) => (f.actionsTaken ?? 0) === 0);
  type CardAction = Extract<Action, { type: 'play-doom-card' }>;
  const cardActions = legal.filter((a): a is CardAction => a.type === 'play-doom-card');
  const effectOf = (a: CardAction) => DOOM_CARDS[a.cardId]?.powers[a.power]?.effect;
  // Powers aimed at a "freely chosen Legion figure" arrive as one action per
  // target: score each target, play the best if it clears `min`.
  const targetOf = (a: CardAction) => (a.targetUid ? s.figures.find((g) => g.uid === a.targetUid) : toughestLegion(s));
  const bestTarget = (effect: string, score: (t: Figure) => number, min: number): CardAction | null => {
    let best: CardAction | null = null, bestV = min;
    for (const a of cardActions) {
      if (effectOf(a) !== effect) continue;
      const t = targetOf(a);
      if (!t) continue;
      const v = score(t);
      if (v >= bestV) { best = a; bestV = v; }
    }
    return best;
  };
  const near = (t: Figure) => mine.some((f) => dist(f.x, f.y, t.x, t.y) <= 10);
  for (const a of cardActions) {
    const p = DOOM_CARDS[a.cardId]?.powers[a.power];
    if (!p) continue;
    let pick: CardAction | null = null;
    switch (p.effect) {
      case 'attack-legion':
        // Control Defense System: 3 black dice at whichever figure is worth most
        // to kill (the boss, the dangerous shooter) — not armor it can't beat.
        pick = bestTarget('attack-legion', (t) =>
          outcome(3, 'black', armorOf(s, t, typeOf(c, t)), 0, 'white', 1).pKill * legionValue(c, t), 1);
        if (pick) return pick;
        break;
      case 'mind-control':
        // Commanding Voice: two Actions with a Legion figure — worth it for a kill
        // it can make on its own side, or to march a dangerous one away from us.
        pick = bestTarget('mind-control', (t) => Math.max(commandKillValue(c, t), near(t) ? DANGER[t.typeId] ?? 0 : 0), 2);
        if (pick) return pick;
        break;
      case 'heal':
        if (mine.some((f) => f.woundsTaken >= 2)) return a;
        break;
      case 'extra-actions':
        if (turnStart && (attacks.length > 0 || mine.some((f) => goalDist(c, f.x, f.y) <= 10))) return a;
        break;
      case 'shield':
        if (legionStillToAct && mine.reduce((n, f) => n + exposure(c, f, f.x, f.y, -1), 0) >= 4) return a;
        break;
      case 'dud':
        if (legionStillToAct && mine.reduce((n, f) => n + exposure(c, f, f.x, f.y, -1), 0) >= 3) return a;
        break;
      case 'armor-down':
        // Weak Spot: on the most valuable armored figure we can attack right now.
        pick = bestTarget('armor-down', (t) =>
          (typeOf(c, t).armor >= 1 && attacks.some((x) => x.targetUid === t.uid) ? legionValue(c, t) : 0), 1);
        if (pick) return pick;
        break;
      case 'reroll':
        if (attacks.some((x) => { const t = s.figures.find((g) => g.uid === x.targetUid); return !!t && isObjective(s, t); })) return a;
        break;
      default: break;
    }
  }
  return null;
}

// ---------- Commanding Voice: directing a Legion figure ----------

/** Value (to the Doomtroopers) of `f`'s best kill on another Legion figure: one
 *  it can reach and strike, or shoot from where it stands. */
function commandKillValue(c: Ctx, f: Figure): number {
  const ft = typeOf(c, f);
  const R = moveRange(c.s, f);
  let best = 0;
  for (const g of c.enemies) {
    if (g.uid === f.uid) continue;
    const d = dist(f.x, f.y, g.x, g.y);
    for (const w of ft.weapons) {
      const reachable = w.kind === 'close' ? d <= R + 1 : d >= 1 && d <= w.range && los(c, f.x, f.y, g.x, g.y, -1);
      if (!reachable) continue;
      const armor = armorOf(c.s, g, typeOf(c, g));
      best = Math.max(best, outcome(w.dice, w.color, armor, 0, 'white', 1).pKill * legionValue(c, g));
    }
  }
  return best;
}

/** While in command: strike another Legion figure if a shot is worth it;
 *  otherwise walk it where it can strike next, or else as far from our
 *  troopers as it can get; release it when neither helps. */
function commandeerChoice(c: Ctx, legal: Action[]): Action {
  const s = c.s, cmd = s.commandeer!;
  const f = s.figures.find((g) => g.uid === cmd.uid && g.alive);
  const release = legal.find((a) => a.type === 'pass-figure') ?? legal[legal.length - 1];
  if (!f) return release;
  const ft = typeOf(c, f);
  const killValue = (a: Extract<Action, { type: 'attack' }>) => {
    const t = s.figures.find((g) => g.uid === a.targetUid)!;
    const w = ft.weapons[a.weaponIdx];
    return outcome(w.dice, w.color, armorOf(s, t, typeOf(c, t)), 0, 'white', 1).pKill * legionValue(c, t);
  };
  let bestAtk: Action | null = null, bestV = 0.3;
  for (const a of legal) if (a.type === 'attack') { const v = killValue(a); if (v > bestV) { bestAtk = a; bestV = v; } }
  if (bestAtk) return bestAtk;

  const steps = getSteps(s, f.uid);
  if (steps <= 0 && cmd.actionsLeft <= 0) return release;
  const vac = K(f.x, f.y);
  const after = steps > 0 ? cmd.actionsLeft : cmd.actionsLeft - 1;
  const r = reach(c, f, f.x, f.y, steps > 0 ? steps : moveRange(s, f), vac);
  const away = distanceField(c, c.friends.map((g) => ({ x: g.x, y: g.y })));
  const score = (n: ReachNode) => {
    let v = 0.2 * Math.min(12, away.get(n.k) ?? 12);
    if (after >= 1) {
      for (const g of c.enemies) {
        if (g.uid === f.uid) continue;
        for (const w of ft.weapons) {
          const d = dist(n.x, n.y, g.x, g.y);
          const ok = w.kind === 'close' ? d === 1 && !wallBlocksStep(s.walls, n.x, n.y, g.x, g.y) : d >= 1 && d <= w.range && los(c, n.x, n.y, g.x, g.y, vac);
          if (ok) v = Math.max(v, 0.2 * Math.min(12, away.get(n.k) ?? 12) + outcome(w.dice, w.color, armorOf(s, g, typeOf(c, g)), 0, 'white', 1).pKill * legionValue(c, g));
        }
      }
    }
    return v;
  };
  const start = r.get(vac)!;
  let best = start, bestS = score(start) + 0.05; // only move for a real gain
  for (const n of r.values()) { if (n.d === 0) continue; const v = score(n); if (v > bestS) { best = n; bestS = v; } }
  if (best === start) return release;
  const step = firstStep(r, best);
  const mv: Action = { type: 'move', uid: f.uid, x: step.x, y: step.y };
  return legal.some((a) => sameAction(a, mv)) ? mv : release;
}

// ---------- the controller ----------

const sameAction = (a: Action, b: Action) => JSON.stringify(a) === JSON.stringify(b);

/** Choose the next action for `actor`. Always returns one of legalActions(). */
export function chooseAction(state: GameState, actor: string): Action {
  return decide(state, actor).act;
}

/** chooseAction, plus the whole walk when the action is a move's first step. */
function decide(state: GameState, actor: string): { act: Action; path?: Step[] } {
  const legal = adapter.legalActions(state, actor);
  if (!legal.length) throw new Error(`SiegeAI: no legal actions for ${actor}`);
  if (state.phase !== 'play') return { act: legal[0] };
  const endTurn: Action = { type: 'end-turn' };
  const isLegal = (a: Action) => legal.some((l) => sameAction(l, a));

  const c = buildCtx(state, actor);
  const s = state;
  const mine = s.figures.filter((f) => f.alive && f.owner === actor);
  if (s.commandeer?.corp === actor) return { act: commandeerChoice(c, legal) };

  if (actor !== 'legion') {
    const card = pickCard(c, legal, mine);
    if (card) return { act: card };
  }

  // Figures still holding base actions (or mid-move) act first: mid-move ones,
  // then those with the best shot on offer, then whoever is nearest the objective
  // (front-runners clear the way for the rest).
  const shotNow = new Map<string, number>();
  for (const f of mine) shotNow.set(f.uid, bestAttack(c, f, f.x, f.y, K(f.x, f.y)));
  const order = (fs: Figure[]) => [...fs].sort((a, b) =>
    (getSteps(s, b.uid) > 0 ? 1 : 0) - (getSteps(s, a.uid) > 0 ? 1 : 0)
    || shotNow.get(b.uid)! - shotNow.get(a.uid)!
    || goalDist(c, a.x, a.y) - goalDist(c, b.x, b.y)
    || (a.uid < b.uid ? -1 : 1));
  const baseFigs = mine.filter((f) => (f.actionsLeft > 0 && canTakeAction(s, f)) || getSteps(s, f.uid) > 0);
  for (const f of order(baseFigs)) {
    const n = f.actionsLeft > 0 && canTakeAction(s, f) ? f.actionsLeft : 0;
    const plan = planFigure(c, f, n, getSteps(s, f.uid));
    if (plan.act && isLegal(plan.act)) return { act: plan.act, path: plan.path };
    return { act: { type: 'pass-figure', uid: f.uid } };
  }

  // Doomtroopers: then spend the team's shared Extra Action pool where it helps most.
  if (actor !== 'legion' && (s.extraPool[actor] ?? 0) > 0) {
    let best: Plan | null = null;
    for (const f of order(mine.filter((g) => canTakeAction(s, g)))) {
      const n = Math.min(s.extraPool[actor], 4 - (f.actionsTaken ?? 0));
      const plan = planFigure(c, f, n, getSteps(s, f.uid));
      if (plan.act && isLegal(plan.act) && (!best || plan.value - plan.stop > best.value - best.stop)) best = plan;
    }
    if (best && best.value - best.stop > 0.05) return { act: best.act!, path: best.path };
  }
  return { act: isLegal(endTurn) ? endTurn : legal[legal.length - 1] };
}

/** Everything a planned walk depends on besides the walker: the other
 *  figures, the round, flipped Force Cards, walls. */
function boardSig(s: GameState, walker: string): string {
  let sig = `${s.round}|${s.activeSeat}|${s.walls.length}|${s.forceCards.filter((f) => f.revealed).length}|`;
  for (const f of s.figures) if (f.uid !== walker) sig += `${f.uid}${f.alive ? f.x + ',' + f.y : 'x'};`;
  return sig;
}

/** Framework controller: plug into GameServer aiControllers or drive a local seat.
 *  Remembers the walk it just started: while nothing else on the board has
 *  changed, the next steps of a paid-for move are taken without re-planning
 *  (they're the plan's own continuation) — roughly halving the AI's CPU per
 *  turn, which matters inside a Worker request. */
export class SiegeAI implements PlayerController<GameState, Action, string> {
  private walk: { actor: string; uid: string; path: Step[]; sig: string } | null = null;

  async selectAction(ctx: ControllerContext<GameState, Action, string>): Promise<Action> {
    const s = ctx.state, actor = ctx.actor;
    const w = this.walk;
    this.walk = null;
    if (w && w.actor === actor && s.phase === 'play' && s.activeSeat === actor && w.path.length) {
      const f = s.figures.find((g) => g.uid === w.uid && g.alive && g.owner === actor);
      const next = w.path[0];
      if (f && getSteps(s, f.uid) > 0 && boardSig(s, f.uid) === w.sig && canStep(s, f.x, f.y, next.x, next.y)) {
        this.remember(actor, f.uid, w.path.slice(1), s);
        return { type: 'move', uid: f.uid, x: next.x, y: next.y };
      }
    }
    const d = decide(s, actor);
    if (d.act.type === 'move' && d.path && d.path.length > 1) this.remember(actor, d.act.uid, d.path.slice(1), s);
    return d.act;
  }

  private remember(actor: string, uid: string, path: Step[], s: GameState) {
    // The signature excludes the walker, so it still matches after its own step.
    if (path.length) this.walk = { actor, uid, path, sig: boardSig(s, uid) };
  }
}
