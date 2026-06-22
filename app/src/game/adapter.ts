import { Rng } from 'digital-boardgame-framework';
import type { GameAdapter, GameResult } from 'digital-boardgame-framework';
import type { GameState, Action, Figure, MissionDef, PlayerSeat } from './types';
import { figureType, effectiveType, CORP_TROOPERS } from './data';
import { MISSIONS, FORCE_CARDS } from './missions';
import { EVENTS, EQUIPMENT, buildEventDeck } from './cards';
import {
  onBoard, figureAt, canStep, dist, hasLineOfSight, resolveAttack,
} from './rules';

const SCHEMA = 2;

// ---------- setup ----------

export interface NewGameOpts {
  missionId: string;
  corporations?: string[];   // override which corps play (default = mission default)
  seed?: number;
  rank?: Record<string, number>;    // campaign carry-in: starting rank per corp
  credits?: Record<string, number>; // campaign carry-in: starting credits per corp
}

let UID = 0;
function nextUid(prefix: string): string {
  return `${prefix}${UID++}`;
}

export function createInitialState(opts: NewGameOpts): GameState {
  const mission: MissionDef = MISSIONS[opts.missionId];
  if (!mission) throw new Error(`unknown mission ${opts.missionId}`);
  UID = 0;
  const corps = opts.corporations ?? mission.corporations;
  const seed = opts.seed ?? 12345;

  const seats: PlayerSeat[] = [
    { id: 'legion', name: 'Dark Legion', isLegion: true },
    ...corps.map((c) => ({ id: c, name: c, isLegion: false })),
  ];

  const rank = Object.fromEntries(corps.map((c) => [c, opts.rank?.[c] ?? 1]));
  const credits = Object.fromEntries(corps.map((c) => [c, opts.credits?.[c] ?? 0]));

  // Place troopers at entrance squares (cycling through entrances).
  const figures: Figure[] = [];
  const entrances = mission.trooperEntrances;
  let ei = 0;
  for (const corp of corps) {
    const ids = mission.troopersPerCorp[corp] ?? CORP_TROOPERS[corp] ?? [];
    for (const tid of ids) {
      const ent = entrances[ei % entrances.length];
      ei++;
      const fig: Figure = {
        uid: nextUid('t'), typeId: tid, owner: corp,
        x: ent.x, y: ent.y, woundsTaken: 0, actionsLeft: 0, alive: true, equipment: [],
      };
      fig.actionsLeft = effectiveType(fig, rank[corp]).actions;
      figures.push(fig);
    }
  }

  // Place objective figures (bosses, doorways, the hunting Ezoghoul).
  for (const p of mission.placements ?? []) {
    figures.push({
      uid: nextUid('o'), typeId: p.typeId, owner: 'legion',
      x: p.x, y: p.y, woundsTaken: 0, actionsLeft: 0, alive: true, tag: p.tag,
    });
  }

  const usesEvents = !!mission.usesEvents;
  const rng = Rng.fromState(seed);
  const eventDeck = usesEvents ? rng.shuffle(buildEventDeck()) : [];

  return {
    schema: SCHEMA,
    missionId: mission.id,
    phase: 'setup',
    seats,
    figures,
    sectors: mission.sectors,
    walls: mission.walls,
    citadel: mission.citadel,
    exits: mission.exits ?? [],
    forceCards: mission.forceCards.map((f) => ({ ...f })),
    legionEntrances: mission.legionEntrances,
    round: 0,
    timeLimitRounds: mission.timeLimitRounds,
    drawOrder: [],
    activeSeat: null,
    promotion: Object.fromEntries(corps.map((c) => [c, 0])),
    legionKills: 0,
    escaped: 0,
    rank,
    credits,
    usesEvents,
    eventDeck,
    pendingEvent: null,
    setupDone: false,
    win: mission.win,
    winners: null,
    rngState: rng.serialize(),
    log: ['Setup. Assign equipment, then Start the mission.'],
  };
}

// ---------- helpers ----------

function clone(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s));
}

function rngFor(s: GameState): Rng {
  return Rng.fromState(s.rngState);
}

function moveRange(s: GameState, fig: Figure): number {
  const ft = figureType(fig.typeId);
  // Mishima troopers move 4; everyone else 3.
  return ft.faction === 'Mishima' && ft.isTrooper ? 4 : 3;
}

/** stepsLeft for an in-progress move is tracked on a side-table keyed by uid,
 *  encoded in actionsLeft fractional? No — we keep it explicit in the figure. */
// We store remaining move steps in a transient map on the state via figure field.
// To avoid changing the Figure shape persisted, we piggyback on a Map rebuilt
// from `_steps` stored in the state.

function sectorAt(s: GameState, x: number, y: number) {
  return s.sectors.find(
    (sec) => x >= sec.ox && x < sec.ox + sec.size && y >= sec.oy && y < sec.oy + sec.size,
  );
}

/** Reveal a force card when a trooper first enters its sector; spawn creatures. */
function maybeRevealForceCard(s: GameState, x: number, y: number) {
  const sec = sectorAt(s, x, y);
  if (!sec) return;
  const fc = s.forceCards.find((f) => f.sectorId === sec.id && !f.revealed);
  if (!fc) return;
  fc.revealed = true;
  const def = FORCE_CARDS[fc.cardId];
  s.log.push(`Force Card revealed in Sector ${sec.id}: ${def.spawn.length} creature(s) deploy!`);
  // place creatures on empty squares within the sector
  const spots: { x: number; y: number }[] = [];
  for (let yy = sec.oy; yy < sec.oy + sec.size; yy++) {
    for (let xx = sec.ox; xx < sec.ox + sec.size; xx++) {
      if (!figureAt(s, xx, yy) && !(xx === x && yy === y)) spots.push({ x: xx, y: yy });
    }
  }
  // deterministic spread: prefer squares farthest from the trooper
  spots.sort((a, b) => dist(b.x, b.y, x, y) - dist(a.x, a.y, x, y));
  for (const cid of def.spawn) {
    const spot = spots.shift();
    if (!spot) break;
    const ft = figureType(cid);
    s.figures.push({
      uid: nextUid('c'),
      typeId: cid,
      owner: 'legion',
      x: spot.x,
      y: spot.y,
      woundsTaken: 0,
      actionsLeft: 0, // can't act the turn they're revealed
      alive: true,
    });
  }
}

// ---------- turn / round flow ----------

function shuffledSeatOrder(s: GameState): string[] {
  const rng = rngFor(s);
  const order = rng.shuffle(s.seats.map((seat) => seat.id));
  s.rngState = rng.serialize();
  return order;
}

function beginRound(s: GameState) {
  s.round += 1;
  (s as any)._steps = {}; // clear any in-progress move steps

  // Dark Legion event card (if the mission uses events)
  let frenzy = false;
  s.pendingEvent = null;
  if (s.usesEvents && s.eventDeck.length > 0) {
    const id = s.eventDeck.shift()!;
    s.pendingEvent = id;
    const ev = EVENTS[id];
    s.log.push(`Dark Legion event: ${ev.name} — ${ev.blurb}`);
    if (ev.spawn) spawnAtLegionEntrance(s, ev.spawn);
    if (ev.legionFrenzy) frenzy = true;
  }
  (s as any)._frenzy = frenzy;

  // reset actions for all figures (equipment / rank / frenzy folded in)
  for (const f of s.figures) {
    if (f.alive) f.actionsLeft = effectiveType(f, s.rank[f.owner] ?? 1, frenzy).actions;
  }
  s.drawOrder = shuffledSeatOrder(s);
  s.log.push(`— Round ${s.round} — turn order drawn.`);
  revealNextSeat(s);
}

/** Deploy creatures at (or next to) a Dark Legion entrance. */
function spawnAtLegionEntrance(s: GameState, creatures: string[]) {
  for (const cid of creatures) {
    const spot = findOpenNearEntrances(s);
    if (!spot) break;
    s.figures.push({
      uid: nextUid('c'), typeId: cid, owner: 'legion',
      x: spot.x, y: spot.y, woundsTaken: 0, actionsLeft: 0, alive: true,
    });
  }
}

function findOpenNearEntrances(s: GameState): { x: number; y: number } | null {
  for (const e of s.legionEntrances) {
    if (onBoard(s, e.x, e.y) && !figureAt(s, e.x, e.y)) return { x: e.x, y: e.y };
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const x = e.x + dx, y = e.y + dy;
        if (onBoard(s, x, y) && !figureAt(s, x, y)) return { x, y };
      }
  }
  return null;
}

function revealNextSeat(s: GameState) {
  if (s.drawOrder.length === 0) {
    s.activeSeat = null;
    return;
  }
  s.activeSeat = s.drawOrder.shift()!;
  const seat = s.seats.find((x) => x.id === s.activeSeat);
  s.log.push(`${seat?.name}'s turn.`);
}

function endActiveTurn(s: GameState) {
  if (s.drawOrder.length > 0) {
    revealNextSeat(s);
  } else {
    // end of round
    checkWin(s);
    if (s.phase === 'over') return;
    if (s.round >= s.timeLimitRounds) {
      resolveTimeLimit(s);
      return;
    }
    beginRound(s);
  }
}

function livingLegion(s: GameState): Figure[] {
  return s.figures.filter((f) => f.alive && f.owner === 'legion');
}
function livingTroopers(s: GameState): Figure[] {
  return s.figures.filter((f) => f.alive && f.owner !== 'legion');
}

function totalPromotion(s: GameState): number {
  return Object.values(s.promotion).reduce((a, b) => a + b, 0);
}

function setWinner(s: GameState, winners: string[], reason: string) {
  s.phase = 'over';
  s.activeSeat = null;
  s.winners = winners;
  // award mission-completion credits
  const mission = MISSIONS[s.missionId];
  const reward = mission?.reward;
  if (reward) {
    const troopersWon = winners.some((w) => w !== 'legion');
    const amt = troopersWon ? reward.troopers : reward.legion;
    if (troopersWon) {
      for (const c of Object.keys(s.credits)) s.credits[c] += amt;
    }
  }
  s.log.push(`GAME OVER — ${reason}`);
}

/** Has the objective that gates escape been met (for promotion+escape missions)? */
function escapeAllowed(s: GameState): boolean {
  if (s.win.kind === 'escape') return true;
  if (s.win.kind === 'promotion' && s.win.escape) return totalPromotion(s) >= s.win.points;
  return false;
}

function checkWin(s: GameState) {
  if (s.phase === 'over') return;
  const corps = s.seats.filter((x) => !x.isLegion).map((x) => x.id);

  if (livingTroopers(s).length === 0) {
    setWinner(s, ['legion'], 'All Doomtroopers eliminated. The Dark Legion wins.');
    return;
  }

  switch (s.win.kind) {
    case 'eliminate-all': {
      const allRevealed = s.forceCards.every((f) => f.revealed);
      if (allRevealed && livingLegion(s).length === 0) {
        setWinner(s, corps, 'Every Dark Legion creature eliminated. The Doomtroopers win!');
      }
      break;
    }
    case 'promotion': {
      const need = s.win.escape ? s.escaped >= 1 : true;
      if (totalPromotion(s) >= s.win.points && need) {
        setWinner(s, corps, `Objective complete — ${totalPromotion(s)} promotion points earned${s.win.escape ? ' and a trooper escaped' : ''}.`);
      }
      break;
    }
    case 'escape': {
      if (s.escaped >= s.win.count) {
        setWinner(s, corps, `${s.escaped} trooper(s) escaped. The Doomtroopers win!`);
      }
      break;
    }
    case 'eliminate-tagged': {
      const tag = s.win.tag;
      const tagged = s.figures.filter((f) => f.tag === tag);
      const aliveTagged = tagged.filter((f) => f.alive);
      if (tagged.length > 0 && aliveTagged.length === 0) {
        setWinner(s, corps, `${s.win.label} destroyed. The Doomtroopers win!`);
      }
      break;
    }
    // 'survive' resolves only at the time limit (see resolveTimeLimit)
  }
}

function resolveTimeLimit(s: GameState) {
  const corps = s.seats.filter((x) => !x.isLegion).map((x) => x.id);
  if (s.win.kind === 'survive') {
    setWinner(s, corps, `Held the line for ${s.timeLimitRounds} rounds. The Doomtroopers win!`);
  } else {
    setWinner(s, ['legion'], `Time limit (${s.timeLimitRounds} rounds) reached. The Dark Legion holds. Legion wins.`);
  }
}

// ---------- in-progress move steps ----------
// We track per-figure remaining move steps in a transient field stored on the
// state so it survives serialization within a turn.
function getSteps(s: GameState, uid: string): number {
  const m = (s as any)._steps as Record<string, number> | undefined;
  return m?.[uid] ?? 0;
}
function setSteps(s: GameState, uid: string, n: number) {
  const m = ((s as any)._steps ??= {}) as Record<string, number>;
  m[uid] = n;
}

// ---------- the adapter ----------

export const adapter: GameAdapter<GameState, Action, string> = {
  schemaVersion: SCHEMA,

  currentActor(s) {
    if (s.phase === 'setup') return s.seats[0].id; // anyone may press Start
    if (s.phase === 'over') return null;
    return s.activeSeat;
  },

  result(s): GameResult<string> | null {
    if (s.phase === 'over' && s.winners) {
      return { winners: s.winners, reason: s.log[s.log.length - 1] };
    }
    return null;
  },

  viewFor(s, viewer) {
    if (!s) return s;
    const v: GameState = JSON.parse(JSON.stringify(s));
    // Never leak the RNG state to any client — it would let them predict rolls.
    v.rngState = 0;
    if (viewer === 'legion') return v; // the Dark Legion sees everything
    // Corporations cannot see unrevealed Force Card contents or the event deck.
    v.forceCards = v.forceCards.map((fc) => (fc.revealed ? fc : { ...fc, cardId: 'hidden' }));
    v.eventDeck = v.eventDeck.map(() => 'hidden');
    return v;
  },

  legalActions(s, actor) {
    const actions: Action[] = [];
    if (s.phase === 'setup') {
      if (actor === s.seats[0].id) actions.push({ type: 'start' });
      return actions;
    }
    if (s.phase === 'over' || actor !== s.activeSeat) return actions;

    const mine = s.figures.filter((f) => f.alive && f.owner === actor);
    for (const f of mine) {
      const stepsLeft = getSteps(s, f.uid);
      const canMove = stepsLeft > 0 || f.actionsLeft > 0;
      if (canMove) {
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            if (canStep(s, f.x, f.y, f.x + dx, f.y + dy))
              actions.push({ type: 'move', uid: f.uid, x: f.x + dx, y: f.y + dy });
          }
      }
      if (f.actionsLeft > 0) {
        const ft = effectiveType(f, s.rank[f.owner] ?? 1, (s as any)._frenzy);
        for (const target of s.figures) {
          if (!target.alive) continue;
          const enemy = (f.owner === 'legion') !== (target.owner === 'legion');
          if (!enemy) continue;
          ft.weapons.forEach((w, idx) => {
            const d = dist(f.x, f.y, target.x, target.y);
            if (w.kind === 'close') {
              if (d === 1) actions.push({ type: 'attack', uid: f.uid, targetUid: target.uid, weaponIdx: idx });
            } else {
              if (d >= 1 && d <= w.range && hasLineOfSight(s, f.x, f.y, target.x, target.y))
                actions.push({ type: 'attack', uid: f.uid, targetUid: target.uid, weaponIdx: idx });
            }
          });
        }
      }
      actions.push({ type: 'pass-figure', uid: f.uid });
    }
    actions.push({ type: 'end-turn' });
    return actions;
  },

  applyAction(state, action, actor) {
    const r = this.tryApplyAction!(state, action, actor);
    if (!r.ok) throw new Error(r.reason ?? 'illegal action');
    return r.state;
  },

  tryApplyAction(state, action, actor) {
    const s = clone(state);

    if (s.phase === 'over') return { state, ok: false, reason: 'game over' };

    if (action.type === 'equip') {
      if (s.phase !== 'setup') return { state, ok: false, reason: 'equipment locked' };
      const fig = s.figures.find((x) => x.uid === action.trooperUid && x.owner === action.corp);
      if (!fig) return { state, ok: false, reason: 'no such trooper' };
      const e = EQUIPMENT[action.cardId];
      if (!e) return { state, ok: false, reason: 'no such card' };
      const rank = s.rank[action.corp] ?? 1;
      if (e.kind === 'weapon' && rank < e.rank) return { state, ok: false, reason: `needs rank ${e.rank}` };
      fig.equipment ??= [];
      if (fig.equipment.includes(action.cardId)) {
        // toggle off — refund gear credits
        fig.equipment = fig.equipment.filter((c) => c !== action.cardId);
        if (e.kind === 'gear') s.credits[action.corp] += e.cost;
      } else {
        if (e.kind === 'weapon' && fig.equipment.some((c) => EQUIPMENT[c]?.kind === 'weapon'))
          return { state, ok: false, reason: 'one special weapon per trooper' };
        if (e.kind === 'gear' && (s.credits[action.corp] ?? 0) < e.cost)
          return { state, ok: false, reason: 'not enough credits' };
        fig.equipment.push(action.cardId);
        if (e.kind === 'gear') s.credits[action.corp] -= e.cost;
      }
      // refresh starting actions to reflect equipment
      fig.actionsLeft = effectiveType(fig, rank).actions;
      return { state: s, ok: true };
    }

    if (action.type === 'finish-setup') {
      s.setupDone = true;
      return { state: s, ok: true };
    }

    if (action.type === 'start') {
      if (s.phase !== 'setup') return { state, ok: false, reason: 'already started' };
      s.phase = 'play';
      s.setupDone = true;
      beginRound(s);
      return { state: s, ok: true };
    }

    if (s.phase !== 'play') return { state, ok: false, reason: 'not in play' };
    if (actor !== s.activeSeat) return { state, ok: false, reason: 'not your turn' };

    if (action.type === 'end-turn') {
      endActiveTurn(s);
      return { state: s, ok: true };
    }

    if (action.type === 'pass-figure') {
      const f = s.figures.find((x) => x.uid === action.uid);
      if (!f || f.owner !== actor) return { state, ok: false, reason: 'not your figure' };
      f.actionsLeft = 0;
      setSteps(s, f.uid, 0);
      autoAdvance(s);
      return { state: s, ok: true };
    }

    if (action.type === 'move') {
      const f = s.figures.find((x) => x.uid === action.uid && x.alive);
      if (!f || f.owner !== actor) return { state, ok: false, reason: 'not your figure' };
      if (!canStep(s, f.x, f.y, action.x, action.y))
        return { state, ok: false, reason: 'blocked' };
      let steps = getSteps(s, f.uid);
      if (steps <= 0) {
        if (f.actionsLeft <= 0) return { state, ok: false, reason: 'no actions left' };
        f.actionsLeft -= 1;
        steps = moveRange(s, f);
      }
      f.x = action.x;
      f.y = action.y;
      setSteps(s, f.uid, steps - 1);

      // trooper escaping via an exit?
      if (f.owner !== 'legion' && s.exits.some((e) => e.x === f.x && e.y === f.y) && escapeAllowed(s)) {
        f.alive = false;
        s.escaped += 1;
        s.log.push(`${figureType(f.typeId).name} escaped off the board!`);
      } else if (f.owner !== 'legion') {
        maybeRevealForceCard(s, f.x, f.y);
      }
      checkWin(s);
      autoAdvance(s);
      return { state: s, ok: true };
    }

    if (action.type === 'attack') {
      const f = s.figures.find((x) => x.uid === action.uid && x.alive);
      if (!f || f.owner !== actor) return { state, ok: false, reason: 'not your figure' };
      if (f.actionsLeft <= 0) return { state, ok: false, reason: 'no actions left' };
      const target = s.figures.find((x) => x.uid === action.targetUid && x.alive);
      if (!target) return { state, ok: false, reason: 'no target' };
      const enemy = (f.owner === 'legion') !== (target.owner === 'legion');
      if (!enemy) return { state, ok: false, reason: 'cannot attack ally' };
      const ft = effectiveType(f, s.rank[f.owner] ?? 1, (s as any)._frenzy);
      const tt = effectiveType(target, s.rank[target.owner] ?? 1, (s as any)._frenzy);
      const w = ft.weapons[action.weaponIdx];
      if (!w) return { state, ok: false, reason: 'bad weapon' };
      const d = dist(f.x, f.y, target.x, target.y);
      if (w.kind === 'close' && d !== 1) return { state, ok: false, reason: 'not adjacent' };
      if (w.kind === 'firearm') {
        if (d < 1 || d > w.range) return { state, ok: false, reason: 'out of range' };
        if (!hasLineOfSight(s, f.x, f.y, target.x, target.y))
          return { state, ok: false, reason: 'no line of sight' };
      }

      f.actionsLeft -= 1;
      setSteps(s, f.uid, 0); // attacking ends any in-progress move
      const rng = rngFor(s);
      const out = resolveAttack(rng, ft, tt, target.woundsTaken, action.weaponIdx);
      s.rngState = rng.serialize();
      s.lastRoll = { dice: out.dice, color: out.color, hits: out.hits, label: out.label };
      s.log.push(out.label);

      target.woundsTaken += out.damage;
      if (out.killed) {
        target.alive = false;
        if (target.owner === 'legion' && f.owner !== 'legion') {
          const pp = figureType(target.typeId).promotion;
          s.promotion[f.owner] = (s.promotion[f.owner] ?? 0) + pp;
          s.log.push(`${actor} earns ${pp} Promotion Point(s) (total ${s.promotion[f.owner]}).`);
        } else if (target.owner !== 'legion') {
          s.legionKills += 1;
        }
      }
      checkWin(s);
      autoAdvance(s);
      return { state: s, ok: true };
    }

    return { state, ok: false, reason: 'unknown action' };
  },
};

/** If the active seat has no figure with actions remaining, auto-advance the turn. */
function autoAdvance(s: GameState) {
  if (s.phase !== 'play' || !s.activeSeat) return;
  const mine = s.figures.filter((f) => f.alive && f.owner === s.activeSeat);
  const anyLeft = mine.some((f) => f.actionsLeft > 0 || getSteps(s, f.uid) > 0);
  if (!anyLeft) {
    s.log.push('No actions remaining — turn passes.');
    endActiveTurn(s);
  }
}
