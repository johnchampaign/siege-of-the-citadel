import { Rng, upgradeProseLog } from 'digital-boardgame-framework';
import type { GameAdapter, GameResult } from 'digital-boardgame-framework';
import { logEvent } from './log';
import type { GameState, Action, Figure, MissionDef, PlayerSeat } from './types';
import { figureType, effectiveType, extraActionPoolSize, CORP_TROOPERS } from './data';
import { MISSIONS, FORCE_CARDS } from './missions';
import { EVENTS, EQUIPMENT, DOOM_CARDS, SECONDARY_MISSIONS, buildEventDeck, dealDoomHands, assignSecondaries } from './cards';
import type { DoomPower } from './cards';
import type { SectorPlacement } from './types';
import {
  onBoard, figureAt, canStep, dist, hasLineOfSight, resolveAttack, rankSaveColor, rollDice, inCitadel,
  wallBlocksStep, wallBetween,
} from './rules';
import type { Weapon, FigureType } from './types';

const SCHEMA = 3; // v3: structured log (GameLogEntry[] instead of string[])

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
        x: ent.x, y: ent.y, woundsTaken: 0, actionsLeft: 0, actionsTaken: 0, alive: true, equipment: [],
      };
      fig.actionsLeft = effectiveType(fig, rank[corp]).actions;
      figures.push(fig);
    }
  }

  // Place objective figures (bosses, doorways, the hunting Ezoghoul).
  for (const p of mission.placements ?? []) {
    figures.push({
      uid: nextUid('o'), typeId: p.typeId, owner: 'legion',
      x: p.x, y: p.y, woundsTaken: 0, actionsLeft: 0, actionsTaken: 0, alive: true, tag: p.tag,
    });
  }

  const usesEvents = !!mission.usesEvents;
  const rng = Rng.fromState(seed);
  const eventDeck = usesEvents ? rng.shuffle(buildEventDeck()) : [];
  // Doomtrooper Cards (Capitol draws 3, others 2); Secondary Missions when 2+ corps.
  const doomHands = dealDoomHands(corps, rng);
  const secondary = corps.length >= 2 ? assignSecondaries(corps, rng) : {};

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
    extraPool: Object.fromEntries(corps.map((c) => [c, extraActionPoolSize(rank[c] ?? 1)])),
    doomHands,
    secondary,
    secondaryDone: Object.fromEntries(corps.map((c) => [c, false])),
    firearmKills: Object.fromEntries(corps.map((c) => [c, 0])),
    usesEvents,
    eventDeck,
    pendingEvent: null,
    roundFx: {},
    missionFx: {},
    setupDone: false,
    win: mission.win,
    winners: null,
    rngState: rng.serialize(),
    log: [{ seq: 0, turn: 0, phase: 'setup', kind: 'setup', msg: 'Setup. Assign equipment, then Start the mission.', payload: { missionId: mission.id, corps } }],
  };
}

// ---------- helpers ----------

/** Copy for a new state, deep except for two big, effectively immutable parts:
 *  - `walls` is shared: fixed for the mission, and the only changes (Remote
 *    Controlled Door placed/destroyed) replace the array, never mutate it.
 *  - `log` gets a new array of the SAME entry objects: entries are never edited
 *    once written (appendGameLog only pushes and trims the array), and by the
 *    late game the log is ~75% of the state — deep-copying it twice per engine
 *    step was most of a server AI turn's CPU. */
function clone(s: GameState): GameState {
  const { walls, log, ...rest } = s;
  const c = JSON.parse(JSON.stringify(rest)) as GameState;
  c.walls = walls;
  c.log = log.slice();
  return c;
}

/** Can this figure begin another action — from its base actions, or (troopers
 *  only) by drawing from the team Extra Action pool up to the 4-action cap? */
export function canTakeAction(s: GameState, f: Figure): boolean {
  if (f.passed) return false;
  // Combat Neurosis / Misinterpreted Orders cap a corporation's actions this round.
  const cap = s.roundFx.cap?.[f.owner];
  if (cap) {
    if (cap.perFig != null && (f.actionsTaken ?? 0) >= cap.perFig) return false;
    if (cap.total != null) {
      const used = s.figures.filter((g) => g.owner === f.owner).reduce((n, g) => n + (g.actionsTaken ?? 0), 0);
      if (used >= cap.total) return false;
    }
  }
  if (f.actionsLeft > 0) return true;
  const ft = figureType(f.typeId);
  return ft.isTrooper && (s.extraPool[f.owner] ?? 0) > 0 && (f.actionsTaken ?? 0) < 4;
}
/** Spend one action: base first, else an Extra Action from the team pool. */
function consumeAction(s: GameState, f: Figure) {
  if (f.actionsLeft > 0) f.actionsLeft -= 1;
  else s.extraPool[f.owner] = (s.extraPool[f.owner] ?? 0) - 1;
  f.actionsTaken = (f.actionsTaken ?? 0) + 1;
}

function rngFor(s: GameState): Rng {
  return Rng.fromState(s.rngState);
}

export function moveRange(s: GameState, fig: Figure): number {
  const ft = figureType(fig.typeId);
  // Mishima troopers move 4; everyone else 3. Hurt Leg slows a figure.
  const base = ft.faction === 'Mishima' && ft.isTrooper ? 4 : 3;
  return Math.max(1, base - (fig.moveDebuff ?? 0));
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
  logEvent(s, 'force.reveal', `Force Card revealed in Sector ${sec.id}: ${def.spawn.length} creature(s) deploy!`, { sector: sec.id, cardId: fc.cardId, spawn: def.spawn });
  // place creatures on empty squares within the sector
  const spots: { x: number; y: number }[] = [];
  for (let yy = sec.oy; yy < sec.oy + sec.size; yy++) {
    for (let xx = sec.ox; xx < sec.ox + sec.size; xx++) {
      if (!figureAt(s, xx, yy) && !inCitadel(s, xx, yy) && !(xx === x && yy === y)) spots.push({ x: xx, y: yy });
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
      actionsTaken: 0,
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

/** Apply a drawn Event card's round effect (reinforcements are spawned separately). */
function applyEventEffect(s: GameState, ev: { effect: string; boost?: string[] }) {
  switch (ev.effect) {
    case 'boost': s.roundFx.boost = ev.boost ?? []; break;
    case 'no-firearm': s.roundFx.noFirearm = true; break;
    case 'no-melee': s.roundFx.noMelee = true; break;
    case 'reroll-melee': s.roundFx.reroll = { legion: 'melee' }; break;
    case 'reroll-all': s.roundFx.reroll = { legion: 'all' }; break;
    case 'pair-cap': { // Misinterpreted Orders: a corporation's pair gets 2 actions total
      const corp = Object.keys(s.doomHands).filter((c) => s.figures.some((f) => f.alive && f.owner === c))
        .sort((a, b) => (s.promotion[b] ?? 0) - (s.promotion[a] ?? 0))[0];
      if (corp) { (s.roundFx.cap ??= {})[corp] = { ...(s.roundFx.cap?.[corp]), total: 2 }; logEvent(s, 'event.effect', `${corp}'s pair may take only 2 actions this round.`, { depth: 1, effect: 'pair-cap', corp, total: 2 }); }
      break;
    }
    case 'legion-teleport': { // Dark Teleportation: a Legion figure blinks next to a Doomtrooper
      const troopers = s.figures.filter((f) => f.alive && f.owner !== 'legion');
      const legion = s.figures.filter((f) => f.alive && f.owner === 'legion'
        && !troopers.some((t) => dist(f.x, f.y, t.x, t.y) === 1));
      if (troopers.length && legion.length) {
        // the legion figure nearest a trooper, moved to an empty square beside it
        let best: { f: Figure; x: number; y: number; d: number } | null = null;
        for (const f of legion) for (const t of troopers) {
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const x = t.x + dx, y = t.y + dy;
            if (!onBoard(s, x, y) || figureAt(s, x, y) || inCitadel(s, x, y)) continue;
            const d = dist(f.x, f.y, x, y);
            if (!best || d < best.d) best = { f, x, y, d };
          }
        }
        if (best) { best.f.x = best.x; best.f.y = best.y; logEvent(s, 'event.effect', `${figureType(best.f.typeId).name} teleports into the fight.`, { depth: 1, effect: 'legion-teleport', uid: best.f.uid, x: best.x, y: best.y }); }
      }
      break;
    }
    case 'direct-damage': {
      // Strike one Doomtrooper with three black dice (auto-targets the most wounded).
      const target = s.figures.filter((f) => f.alive && f.owner !== 'legion')
        .sort((a, b) => b.woundsTaken - a.woundsTaken)[0];
      const atk = s.figures.find((f) => f.alive && f.owner === 'legion') ?? target;
      if (target) {
        const rng = rngFor(s);
        const { hits } = rollDice(rng, 3, 'black');
        logEvent(s, 'event.effect', `Temporary Defense fires 3 black dice at ${figureType(target.typeId).name} — ${hits} hit(s).`, { depth: 1, effect: 'direct-damage', dice: 3, color: 'black', hits, targetUid: target.uid });
        applyHits(s, atk, target, hits, rng, false);
        s.rngState = rng.serialize();
      }
      break;
    }
    default: break; // spawn-only / flavor — reinforcements (if any) already placed
  }
}

/** Does figure `fig` get the round's +1-action boost (from an Event/boost card)? */
export function boostFor(s: GameState, fig: Figure): boolean {
  return !!s.roundFx.boost && s.roundFx.boost.includes(fig.typeId);
}

/** How many attack dice may `attacker` re-roll this round (Heroic Luck / Close
 *  Combat Frenzy / Dark Energy Wave)? */
function rerollFor(s: GameState, attacker: Figure, kind: string): number {
  const rr = s.roundFx.reroll;
  if (!rr) return 0;
  if (attacker.owner !== 'legion') return rr.team === attacker.owner ? 1 : 0;
  if (rr.legion === 'all') return 1;
  if (rr.legion === 'melee' && kind === 'close') return 1;
  return 0;
}

/** A figure's effective Armor for this round (Weak Spot lowers a Legion figure). */
export function armorOf(s: GameState, fig: Figure, tt: { armor: number }): number {
  return Math.max(0, tt.armor - (s.roundFx.armorDown?.includes(fig.uid) ? 1 : 0));
}

function beginRound(s: GameState) {
  s.round += 1;
  (s as any)._steps = {}; // clear any in-progress move steps
  s.roundFx = {}; // transient card effects reset every round

  // Dark Legion event card (if the mission uses events)
  s.pendingEvent = null;
  if (s.usesEvents && s.eventDeck.length > 0) {
    const id = s.eventDeck.shift()!;
    s.pendingEvent = id;
    const ev = EVENTS[id];
    logEvent(s, 'event.draw', `Dark Legion event: ${ev.name} — ${ev.blurb}`, { eventId: id, name: ev.name, spawn: ev.spawn ?? [] }, 'legion');
    if (ev.spawn) spawnAtLegionEntrance(s, ev.spawn);
    applyEventEffect(s, ev);
  }

  // reset actions for all figures (equipment / boost folded in) and refill the
  // corporations' shared Extra Action pools from their Rank.
  for (const f of s.figures) {
    if (!f.alive) continue;
    f.actionsLeft = effectiveType(f, s.rank[f.owner] ?? 1, boostFor(s, f)).actions;
    f.actionsTaken = 0;
    delete f.passed;
  }
  for (const c of Object.keys(s.extraPool)) s.extraPool[c] = extraActionPoolSize(s.rank[c] ?? 1);
  s.drawOrder = shuffledSeatOrder(s);
  logEvent(s, 'round.start', `— Round ${s.round} — turn order drawn.`, { round: s.round });
  revealNextSeat(s);
}

/** Deploy creatures at (or next to) a Dark Legion entrance. */
function spawnAtLegionEntrance(s: GameState, creatures: string[]) {
  for (const cid of creatures) {
    const spot = findOpenNearEntrances(s);
    if (!spot) break;
    s.figures.push({
      uid: nextUid('c'), typeId: cid, owner: 'legion',
      x: spot.x, y: spot.y, woundsTaken: 0, actionsLeft: 0, actionsTaken: 0, alive: true,
    });
  }
}

function findOpenNearEntrances(s: GameState): { x: number; y: number } | null {
  for (const e of s.legionEntrances) {
    if (onBoard(s, e.x, e.y) && !figureAt(s, e.x, e.y) && !inCitadel(s, e.x, e.y)) return { x: e.x, y: e.y };
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const x = e.x + dx, y = e.y + dy;
        if (onBoard(s, x, y) && !figureAt(s, x, y) && !inCitadel(s, x, y)) return { x, y };
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
  logEvent(s, 'turn.start', `${seat?.name}'s turn.`, { seat: s.activeSeat }, s.activeSeat);
}

function endActiveTurn(s: GameState) {
  delete s.commandeer; // control of a commandeered figure never outlives the turn
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

export function totalPromotion(s: GameState): number {
  return Object.values(s.promotion).reduce((a, b) => a + b, 0);
}

/** Total credit-cost of all gear currently checked out by a corporation's troopers. */
function teamGearCost(s: GameState, corp: string): number {
  let sum = 0;
  for (const f of s.figures) {
    if (f.owner !== corp) continue;
    for (const id of f.equipment ?? []) {
      const e = EQUIPMENT[id];
      if (e?.kind === 'gear') sum += e.cost;
    }
  }
  return sum;
}

function setWinner(s: GameState, winners: string[], reason: string) {
  s.phase = 'over';
  s.activeSeat = null;
  s.winners = winners;
  logEvent(s, 'mission.end', `GAME OVER — ${reason}`, { winners, reason });
  const troopersWon = winners.some((w) => w !== 'legion');

  // award mission-completion credits — RAW: a team only gains Credits if it
  // completed the mission AND has at least one Doomtrooper alive at the end.
  const reward = MISSIONS[s.missionId]?.reward;
  if (reward && troopersWon) {
    for (const c of Object.keys(s.credits)) {
      if (s.figures.some((f) => f.owner === c && f.alive)) s.credits[c] += reward.troopers;
    }
  }

  // resolve each corporation's secret Secondary Mission
  for (const corp of Object.keys(s.secondary)) {
    const def = SECONDARY_MISSIONS[s.secondary[corp]];
    if (!def) continue;
    const total = s.figures.filter((f) => f.owner === corp).length;
    const alive = s.figures.filter((f) => f.owner === corp && f.alive).length;
    const ok = def.check({
      corp, promotion: s.promotion[corp] ?? 0, firearmKills: s.firearmKills[corp] ?? 0,
      troopersAlive: alive, troopersTotal: total, escaped: s.escaped, troopersWon,
    });
    s.secondaryDone[corp] = ok;
    if (ok) {
      s.promotion[corp] = (s.promotion[corp] ?? 0) + def.bonusPromotion;
      s.credits[corp] = (s.credits[corp] ?? 0) + def.bonusCredits;
      logEvent(s, 'mission.secondary', `${corp} completed Secondary Mission "${def.name}" — +${def.bonusPromotion} PP, +${def.bonusCredits} credit(s).`, { corp, mission: s.secondary[corp], name: def.name, pp: def.bonusPromotion, credits: def.bonusCredits }, corp);
    }
  }
}

/** Has the objective that gates escape been met (for promotion+escape missions)? */
export function escapeAllowed(s: GameState): boolean {
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
export function getSteps(s: GameState, uid: string): number {
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

  /** v2 -> v3: the log was a prose string[] (with a leading-two-spaces
   *  indentation hack). Wrap old lines as kind:'legacy' entries so in-flight
   *  KV snapshots keep loading and rendering. */
  migrate(rawState, fromVersion) {
    const s = rawState as GameState & { schema?: number; log: unknown[] };
    if (fromVersion < 3 && Array.isArray(s.log) && (s.log.length === 0 || typeof s.log[0] === 'string')) {
      s.log = upgradeProseLog(s.log as string[], (s as GameState).round ?? 0);
    }
    s.schema = SCHEMA;
    return s as GameState;
  },

  currentActor(s) {
    if (s.phase === 'setup') return s.seats[0].id; // anyone may press Start
    if (s.phase === 'over') return null;
    return s.activeSeat;
  },

  result(s): GameResult<string> | null {
    if (s.phase === 'over' && s.winners) {
      // Team game: the Legion is one side, all Doomtrooper corps the other. Tag
      // teams so ratings don't pit the cooperating troopers against each other —
      // each player is rated only across the Legion/Troopers divide.
      const teams = Object.fromEntries(
        s.seats.map((seat) => [seat.id, seat.isLegion ? 'legion' : 'troopers']),
      );
      const over = [...s.log].reverse().find((e) => e.kind === 'mission.end');
      return { winners: s.winners, teams, reason: over?.msg ?? s.log[s.log.length - 1]?.msg ?? '' };
    }
    return null;
  },

  viewFor(s, viewer) {
    if (!s) return s;
    const v: GameState = clone(s);
    // Never leak the RNG state to any client — it would let them predict rolls.
    v.rngState = 0;
    // A player's Doomtrooper hand and Secondary Mission are secret to others.
    for (const c of Object.keys(v.doomHands)) {
      if (c !== viewer) v.doomHands[c] = v.doomHands[c].map(() => 'hidden');
    }
    for (const c of Object.keys(v.secondary)) {
      if (c !== viewer && !v.secondaryDone[c]) v.secondary[c] = 'hidden';
    }
    if (viewer === 'legion') return v; // the Dark Legion sees everything else
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
    // Commanding Voice in progress: the commandeered figure's actions come first.
    if (s.commandeer?.corp === actor) return commandeerActions(s, s.commandeer);

    // Doomtrooper Cards may be played on your turn — either of a card's two
    // powers, if that power has a valid (auto-resolved) target.
    for (const cardId of s.doomHands[actor] ?? []) {
      const card = DOOM_CARDS[cardId];
      if (!card) continue;
      card.powers.forEach((p, power) => {
        if (!powerPlayable(s, actor, p)) return;
        // "Freely chosen Legion figure" (Control Defense System, Commanding Voice,
        // Weak Spot): one action per possible target, so the player picks it.
        if (p.target === 'legion') {
          for (const t of s.figures) if (t.alive && t.owner === 'legion' && (p.effect !== 'mind-control' || commandable(t)))
            actions.push({ type: 'play-doom-card', corp: actor, cardId, power, targetUid: t.uid });
        } else if (p.effect === 'door') {
          // Remote Controlled Door: one action per gap it may seal (the player picks).
          for (const e of doorSpots(s)) actions.push({ type: 'play-doom-card', corp: actor, cardId, power, x: e.x, y: e.y, dir: e.dir });
        } else actions.push({ type: 'play-doom-card', corp: actor, cardId, power });
      });
    }

    const mine = s.figures.filter((f) => f.alive && f.owner === actor);
    for (const f of mine) {
      const stepsLeft = getSteps(s, f.uid);
      const canMove = stepsLeft > 0 || canTakeAction(s, f);
      if (canMove) {
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            if (canStep(s, f.x, f.y, f.x + dx, f.y + dy))
              actions.push({ type: 'move', uid: f.uid, x: f.x + dx, y: f.y + dy });
          }
      }
      if (canTakeAction(s, f)) {
        const ft = effectiveType(f, s.rank[f.owner] ?? 1, boostFor(s, f));
        const trooperActor = f.owner !== 'legion';
        for (const target of s.figures) {
          if (!target.alive) continue;
          const enemy = (f.owner === 'legion') !== (target.owner === 'legion');
          if (!enemy) continue;
          // Combat Aura / Spectral Displacement: the Legion can't attack a shielded corp this round.
          if (!trooperActor && s.roundFx.shield?.[target.owner]) continue;
          ft.weapons.forEach((w, idx) => {
            const d = dist(f.x, f.y, target.x, target.y);
            if (w.kind === 'close') {
              // Close Combat Phobia stops Doomtrooper melee this round; Legionnaire
              // Fear / Necrofear bar melee vs a creature type for the mission.
              if (trooperActor && s.roundFx.noMelee) return;
              if (trooperActor && s.missionFx.noMeleeVs?.[f.owner]?.includes(target.typeId)) return;
              // close combat needs an adjacent square with no wall between (you
              // can't reach a hand weapon through a wall).
              if (d === 1 && !wallBlocksStep(s.walls, f.x, f.y, target.x, target.y))
                actions.push({ type: 'attack', uid: f.uid, targetUid: target.uid, weaponIdx: idx });
            } else {
              // Mental Block stops Doomtrooper firearms this round.
              if (trooperActor && s.roundFx.noFirearm) return;
              if (d >= 1 && d <= w.range && hasLineOfSight(s, f.x, f.y, target.x, target.y))
                actions.push({ type: 'attack', uid: f.uid, targetUid: target.uid, weaponIdx: idx });
            }
          });
        }
      }
      if (canTakeAction(s, f)) actions.push(...doorAttacks(s, f));
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
        fig.equipment = fig.equipment.filter((c) => c !== action.cardId);
      } else {
        if (e.kind === 'weapon' && fig.equipment.some((c) => EQUIPMENT[c]?.kind === 'weapon'))
          return { state, ok: false, reason: 'one special weapon per trooper' };
        // Credits are NOT spent on equipment — they only gate how much the team
        // can check out (total gear cost must stay within the Credit total).
        if (e.kind === 'gear') {
          const spent = teamGearCost(s, action.corp);
          if (spent + e.cost > (s.credits[action.corp] ?? 0))
            return { state, ok: false, reason: 'exceeds Credit allowance' };
        }
        fig.equipment.push(action.cardId);
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
    if (s.commandeer?.corp === actor) return applyCommandeer(state, s, action, actor);

    if (action.type === 'end-turn') {
      endActiveTurn(s);
      return { state: s, ok: true };
    }

    if (action.type === 'pass-figure') {
      const f = s.figures.find((x) => x.uid === action.uid);
      if (!f || f.owner !== actor) return { state, ok: false, reason: 'not your figure' };
      f.actionsLeft = 0;
      // Done for the round — no Extra Actions from the pool either. A flag, not
      // actionsTaken = 4: that counted as 4 actions taken, so under Misinterpreted
      // Orders (2 actions for the pair) passing one figure froze its partner.
      f.passed = true;
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
        if (!canTakeAction(s, f)) return { state, ok: false, reason: 'no actions left' };
        consumeAction(s, f);
        steps = moveRange(s, f);
      }
      f.x = action.x;
      f.y = action.y;
      setSteps(s, f.uid, steps - 1);

      // trooper escaping via an exit?
      if (f.owner !== 'legion' && s.exits.some((e) => e.x === f.x && e.y === f.y) && escapeAllowed(s)) {
        f.alive = false;
        s.escaped += 1;
        logEvent(s, 'figure.escape', `${figureType(f.typeId).name} escaped off the board!`, { uid: f.uid, typeId: f.typeId, corp: f.owner }, f.owner);
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
      if (!canTakeAction(s, f)) return { state, ok: false, reason: 'no actions left' };
      const target = s.figures.find((x) => x.uid === action.targetUid && x.alive);
      if (!target) return { state, ok: false, reason: 'no target' };
      const enemy = (f.owner === 'legion') !== (target.owner === 'legion');
      if (!enemy) return { state, ok: false, reason: 'cannot attack ally' };
      const ft = effectiveType(f, s.rank[f.owner] ?? 1, boostFor(s, f));
      const w = ft.weapons[action.weaponIdx];
      if (!w) return { state, ok: false, reason: 'bad weapon' };
      const d = dist(f.x, f.y, target.x, target.y);
      const trooperAtk = f.owner !== 'legion';
      if (s.roundFx.shield?.[target.owner]) return { state, ok: false, reason: 'target is shielded this round' };
      if (w.kind === 'close') {
        if (trooperAtk && s.roundFx.noMelee) return { state, ok: false, reason: 'close combat blocked this round' };
        if (trooperAtk && s.missionFx.noMeleeVs?.[f.owner]?.includes(target.typeId)) return { state, ok: false, reason: 'fear prevents this close combat' };
        if (d !== 1) return { state, ok: false, reason: 'not adjacent' };
        if (wallBlocksStep(s.walls, f.x, f.y, target.x, target.y))
          return { state, ok: false, reason: 'wall blocks close combat' };
      }
      if (w.kind === 'firearm') {
        if (trooperAtk && s.roundFx.noFirearm) return { state, ok: false, reason: 'firearms blocked this round' };
        if (d < 1 || d > w.range) return { state, ok: false, reason: 'out of range' };
        if (!hasLineOfSight(s, f.x, f.y, target.x, target.y))
          return { state, ok: false, reason: 'no line of sight' };
      }

      consumeAction(s, f);
      setSteps(s, f.uid, 0); // attacking ends any in-progress move
      resolveCombat(s, f, target, ft, w, action.weaponIdx);
      checkWin(s);
      autoAdvance(s);
      return { state: s, ok: true };
    }

    if (action.type === 'attack-door') {
      const f = s.figures.find((x) => x.uid === action.uid && x.alive);
      if (!f || f.owner !== actor) return { state, ok: false, reason: 'not your figure' };
      if (!canTakeAction(s, f)) return { state, ok: false, reason: 'no actions left' };
      if (!doorAttacks(s, f).some((a) => a.type === 'attack-door' && a.x === action.x && a.y === action.y && a.dir === action.dir && a.weaponIdx === action.weaponIdx))
        return { state, ok: false, reason: 'that door is not in reach of this weapon' };
      consumeAction(s, f);
      setSteps(s, f.uid, 0);
      attackDoor(s, f, action);
      autoAdvance(s);
      return { state: s, ok: true };
    }

    if (action.type === 'play-doom-card') {
      return playDoomCard(s, action, actor) ? { state: s, ok: true } : { state, ok: false, reason: 'cannot play that card' };
    }

    return { state, ok: false, reason: 'unknown action' };
  },
};

// ---------- combat resolution (single + area of effect) ----------

/** RAW: when a Doomtrooper is eliminated, the team's Credit total drops by 1.
 *  "If your team does not have any Credits, your team loses five Promotion
 *  Points instead." */
function loseDoomtrooper(s: GameState, owner: string) {
  if ((s.credits[owner] ?? 0) > 0) {
    s.credits[owner] -= 1;
    logEvent(s, 'credits.loss', `${owner} loses 1 Credit (Doomtrooper eliminated → ${s.credits[owner]} left).`, { depth: 1, corp: owner, amount: 1, remaining: s.credits[owner] });
  } else {
    s.promotion[owner] = Math.max(0, (s.promotion[owner] ?? 0) - 5);
    logEvent(s, 'promotion.loss', `${owner} has no Credits — loses 5 Promotion Points instead (total ${s.promotion[owner]}).`, { depth: 1, corp: owner, amount: 5, total: s.promotion[owner], reason: 'trooper-lost-no-credits' });
  }
}

/** Apply `hits` from `attacker` to `fig`: rolls Kevlarite saves, deals wounds,
 *  handles kill scoring, friendly-fire penalty, and firearm-kill tallies. */
function applyHits(s: GameState, attacker: Figure, fig: Figure, hits: number, rng: Rng, fromFirearm: boolean) {
  if (hits <= 0 || !fig.alive) return;
  // Dud Round: the next Legion firearm hit on this team fizzles (faulty ammo).
  if (fromFirearm && attacker.owner === 'legion' && fig.owner !== 'legion' && s.roundFx.dud?.[fig.owner]) {
    delete s.roundFx.dud[fig.owner];
    logEvent(s, 'combat.dud', `Dud Round — ${figureType(attacker.typeId).name}'s shot misfires!`, { depth: 1, attackerUid: attacker.uid, targetCorp: fig.owner });
    return;
  }
  const tt = effectiveType(fig, s.rank[fig.owner] ?? 1, boostFor(s, fig));
  const armor = armorOf(s, fig, tt); // Weak Spot may lower a Legion figure's armor this round
  let saves = 0;
  if (tt.isTrooper && tt.kevlariteDice && hits > armor) {
    saves = rollDice(rng, tt.kevlariteDice, rankSaveColor(s.rank[fig.owner] ?? 1)).hits;
  }
  const dmg = Math.max(0, hits - armor - saves);
  if (dmg <= 0) return;

  const friendlyTrooper = fig.owner !== 'legion' && attacker.owner !== 'legion' && fig.uid !== attacker.uid;
  if (friendlyTrooper) {
    // Hitting another Doomtrooper costs the attacker's team 3 Promotion Points.
    s.promotion[attacker.owner] = Math.max(0, (s.promotion[attacker.owner] ?? 0) - 3);
    logEvent(s, 'combat.friendly-fire', `Friendly fire! ${figureType(attacker.typeId).name} hit ${figureType(fig.typeId).name} — ${attacker.owner} loses 3 Promotion Points.`, { attackerUid: attacker.uid, targetUid: fig.uid, corp: attacker.owner, ppLoss: 3 });
  }

  fig.woundsTaken += dmg;
  logEvent(s, 'combat.damage', `→ ${figureType(fig.typeId).name} takes ${dmg} wound${dmg === 1 ? '' : 's'} (${tt.strength - fig.woundsTaken}/${tt.strength} left).`, { depth: 1, targetUid: fig.uid, typeId: fig.typeId, wounds: dmg, left: tt.strength - fig.woundsTaken, strength: tt.strength, saves, armor });
  if (fig.woundsTaken >= tt.strength) {
    fig.alive = false;
    if (fig.owner === 'legion' && attacker.owner !== 'legion') {
      const pp = figureType(fig.typeId).promotion;
      s.promotion[attacker.owner] = (s.promotion[attacker.owner] ?? 0) + pp;
      if (fromFirearm) s.firearmKills[attacker.owner] = (s.firearmKills[attacker.owner] ?? 0) + 1;
      logEvent(s, 'combat.kill', `☠ ${figureType(fig.typeId).name} ELIMINATED — ${attacker.owner} +${pp} PP (total ${s.promotion[attacker.owner]}).`, { depth: 1, targetUid: fig.uid, typeId: fig.typeId, by: attacker.owner, pp, ppTotal: s.promotion[attacker.owner] });
    } else if (fig.owner !== 'legion') {
      s.legionKills += 1;
      logEvent(s, 'combat.kill', `☠ ${figureType(fig.typeId).name} ELIMINATED.`, { depth: 1, targetUid: fig.uid, typeId: fig.typeId, by: attacker.owner });
      loseDoomtrooper(s, fig.owner);
    }
  }
}

/** Resolve an attack, fanning out to the weapon's area pattern if any. */
function resolveCombat(s: GameState, attacker: Figure, target: Figure, ft: FigureType, w: Weapon, weaponIdx: number) {
  const rng = rngFor(s);
  const fromFirearm = w.kind === 'firearm';
  const reroll = rerollFor(s, attacker, w.kind); // Heroic Luck / Close Combat Frenzy / Dark Energy Wave

  if (!w.area) {
    const tt0 = effectiveType(target, s.rank[target.owner] ?? 1, boostFor(s, target));
    const tt = { ...tt0, armor: armorOf(s, target, tt0) }; // Weak Spot lowers armor this round
    const out = resolveAttack(rng, ft, tt, target.woundsTaken, weaponIdx, rankSaveColor(s.rank[target.owner] ?? 1), reroll);
    s.lastRoll = {
      dice: out.dice, color: out.color, hits: out.hits, label: out.label,
      attackerOwner: attacker.owner, attackerName: ft.name, targetName: tt.name, weapon: w.name,
      armor: tt.armor, saves: out.kevlariteSaves, damage: out.damage, killed: out.killed,
    };
    logEvent(s, 'combat.roll', out.label, {
      attackerUid: attacker.uid, attackerOwner: attacker.owner, targetUid: target.uid,
      weapon: w.name, weaponKind: w.kind, dice: out.dice, color: out.color, hits: out.hits,
      armor: tt.armor, saves: out.kevlariteSaves, damage: out.damage, killed: out.killed,
    }, attacker.owner);
    target.woundsTaken += out.damage;
    if (out.killed) {
      target.alive = false;
      if (target.owner === 'legion' && attacker.owner !== 'legion') {
        const pp = figureType(target.typeId).promotion;
        s.promotion[attacker.owner] = (s.promotion[attacker.owner] ?? 0) + pp;
        if (fromFirearm) s.firearmKills[attacker.owner] = (s.firearmKills[attacker.owner] ?? 0) + 1;
        logEvent(s, 'combat.kill', `${figureType(target.typeId).name} eliminated — ${attacker.owner} earns ${pp} Promotion Point(s) (total ${s.promotion[attacker.owner]}).`, { depth: 1, targetUid: target.uid, typeId: target.typeId, by: attacker.owner, pp, ppTotal: s.promotion[attacker.owner] });
      } else if (target.owner !== 'legion') {
        s.legionKills += 1;
        loseDoomtrooper(s, target.owner);
      }
    }
    s.rngState = rng.serialize();
    return;
  }

  if (w.area === 'double') {
    // Two-target burst: roll the weapon's dice separately at the primary target
    // and the nearest other enemy in line of sight.
    const second = s.figures
      .filter((g) => g.alive && g.uid !== target.uid && (g.owner === 'legion') !== (attacker.owner === 'legion')
        && dist(attacker.x, attacker.y, g.x, g.y) <= w.range && hasLineOfSight(s, attacker.x, attacker.y, g.x, g.y))
      .sort((a, b) => dist(target.x, target.y, a.x, a.y) - dist(target.x, target.y, b.x, b.y))[0];
    const r1 = rollDice(rng, w.dice, w.color, reroll);
    s.lastRoll = { dice: r1.dice, color: w.color, hits: r1.hits, label: `${ft.name} fires ${w.name}: ${r1.hits} hit(s)`,
      attackerOwner: attacker.owner, attackerName: ft.name, weapon: w.name, area: w.area };
    logEvent(s, 'combat.roll', s.lastRoll!.label, { attackerUid: attacker.uid, attackerOwner: attacker.owner, targetUid: target.uid, weapon: w.name, weaponKind: w.kind, area: w.area, dice: r1.dice, color: w.color, hits: r1.hits }, attacker.owner);
    applyHits(s, attacker, target, r1.hits, rng, fromFirearm);
    if (second) {
      const r2 = rollDice(rng, w.dice, w.color, reroll);
      logEvent(s, 'combat.roll', `second target — ${r2.hits} hit(s)`, { depth: 1, attackerUid: attacker.uid, attackerOwner: attacker.owner, targetUid: second.uid, weapon: w.name, area: w.area, dice: r2.dice, color: w.color, hits: r2.hits }, attacker.owner);
      applyHits(s, attacker, second, r2.hits, rng, fromFirearm);
    }
    s.rngState = rng.serialize();
    return;
  }

  // swing / line / blast: roll once, fan the hits across the affected squares.
  const r = rollDice(rng, w.dice, w.color, reroll);
  s.lastRoll = { dice: r.dice, color: w.color, hits: r.hits, label: `${ft.name} unleashes ${w.name}: ${r.hits} hit(s)`,
    attackerOwner: attacker.owner, attackerName: ft.name, weapon: w.name, area: w.area };
  logEvent(s, 'combat.roll', s.lastRoll!.label, { attackerUid: attacker.uid, attackerOwner: attacker.owner, targetUid: target.uid, weapon: w.name, weaponKind: w.kind, area: w.area, dice: r.dice, color: w.color, hits: r.hits }, attacker.owner);

  let affected: { fig: Figure; hits: number }[] = [];
  if (w.area === 'swing') {
    affected = s.figures.filter((g) => g.alive && g.uid !== attacker.uid && dist(attacker.x, attacker.y, g.x, g.y) === 1)
      .map((g) => ({ fig: g, hits: r.hits }));
  } else if (w.area === 'line') {
    affected = figuresOnLine(s, attacker, target, w.range).map((g) => ({ fig: g, hits: r.hits }));
  } else if (w.area === 'blast') {
    affected = [{ fig: target, hits: r.hits }];
    for (const g of s.figures) {
      if (g.alive && g.uid !== target.uid && dist(target.x, target.y, g.x, g.y) === 1) {
        affected.push({ fig: g, hits: r.hits - 1 }); // adjacent squares: one hit less
      }
    }
  }
  for (const a of affected) applyHits(s, attacker, a.fig, a.hits, rng, fromFirearm);
  s.rngState = rng.serialize();
}

/** Figures lying on the straight line from attacker through target, out to range,
 *  while line of sight holds (a strafing line of fire). */
function figuresOnLine(s: GameState, attacker: Figure, target: Figure, range: number): Figure[] {
  const out: Figure[] = [];
  for (const g of s.figures) {
    if (!g.alive || g.uid === attacker.uid) continue;
    const d = dist(attacker.x, attacker.y, g.x, g.y);
    if (d < 1 || d > range) continue;
    if (!collinear(attacker.x, attacker.y, target.x, target.y, g.x, g.y)) continue;
    if (!hasLineOfSight(s, attacker.x, attacker.y, g.x, g.y)) continue;
    out.push(g);
  }
  return out;
}
function collinear(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
  // p lies on the ray from a through b (same direction), within the segment box span
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (cross !== 0) return false;
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  return dot >= 0;
}

// ---------- Doomtrooper Cards ----------
// ---- Doomtrooper Card target auto-resolution ----

/** Pick another corporation (with living figures) to target with a sabotage power. */
function enemyCorpOf(s: GameState, corp: string): string | null {
  return Object.keys(s.doomHands)
    .filter((c) => c !== corp && s.figures.some((f) => f.alive && f.owner === c))
    .sort((a, b) => (s.promotion[b] ?? 0) - (s.promotion[a] ?? 0))[0] ?? null; // hit the leader
}
/** Is a given power playable right now (does it have a valid auto-target)? */
function powerPlayable(s: GameState, corp: string, p: DoomPower): boolean {
  switch (p.target) {
    case 'self-trooper': return s.figures.some((f) => f.alive && f.owner === corp && f.woundsTaken > 0);
    case 'legion': return s.figures.some((f) => f.alive && f.owner === 'legion' && (p.effect !== 'mind-control' || commandable(f)));
    case 'enemy-corp': return enemyCorpOf(s, corp) != null;
    case 'enemy-trooper': return s.figures.some((f) => f.alive && f.owner !== 'legion' && f.owner !== corp);
    case 'teleport': return s.figures.some((f) => f.alive && f.owner === corp);
    default:
      if (p.effect === 'move-force-card') return s.forceCards.some((f) => !f.revealed);
      if (p.effect === 'door') return doorSpots(s).length > 0;
      return true;
  }
}

/** Empty, on-board, non-Citadel square in `sec` nearest a living Legion figure. */
function teleportDest(s: GameState, sec: SectorPlacement): { x: number; y: number } | null {
  const legion = s.figures.filter((f) => f.alive && f.owner === 'legion');
  let best: { x: number; y: number } | null = null; let bestD = Infinity;
  for (let y = sec.oy; y < sec.oy + sec.size; y++)
    for (let x = sec.ox; x < sec.ox + sec.size; x++) {
      if (figureAt(s, x, y) || inCitadel(s, x, y)) continue;
      const d = legion.length ? Math.min(...legion.map((l) => dist(x, y, l.x, l.y))) : 0;
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  return best;
}

function playDoomCard(s: GameState, action: Extract<Action, { type: 'play-doom-card' }>, actor: string): boolean {
  if (s.phase !== 'play' || actor !== s.activeSeat || action.corp !== actor) return false;
  const corp = action.corp;
  const hand = s.doomHands[corp];
  if (!hand || !hand.includes(action.cardId)) return false;
  const card = DOOM_CARDS[action.cardId];
  const power = card?.powers[action.power];
  if (!power || !powerPlayable(s, corp, power)) return false;
  const rng = rngFor(s);

  switch (power.effect) {
    case 'extra-actions':
      s.extraPool[corp] = (s.extraPool[corp] ?? 0) + 2;
      break;
    case 'heal': {
      const t = s.figures.filter((g) => g.alive && g.owner === corp && g.woundsTaken > 0).sort((a, b) => b.woundsTaken - a.woundsTaken)[0];
      if (!t) return false;
      t.woundsTaken = Math.max(0, t.woundsTaken - 2);
      break;
    }
    case 'shield': (s.roundFx.shield ??= {})[corp] = true; break;
    case 'reroll': (s.roundFx.reroll ??= {}).team = corp; break;
    case 'phase': s.roundFx.phase = corp; break;
    case 'dud': (s.roundFx.dud ??= {})[corp] = true; break;
    case 'armor-down': {
      const t = chosenLegion(s, action.targetUid); if (!t) return false;
      (s.roundFx.armorDown ??= []).push(t.uid);
      logEvent(s, 'card.effect', `${figureType(t.typeId).name}'s armor is weakened this round.`, { depth: 1, effect: 'armor-down', targetUid: t.uid }, corp);
      break;
    }
    case 'attack-legion': {
      const t = chosenLegion(s, action.targetUid); if (!t) return false;
      const atk = s.figures.find((g) => g.alive && g.owner === corp);
      const { hits } = rollDice(rng, 3, 'black');
      logEvent(s, 'card.effect', `Control Defense System fires 3 black dice at ${figureType(t.typeId).name} — ${hits} hit(s).`, { depth: 1, effect: 'attack-legion', dice: 3, color: 'black', hits, targetUid: t.uid }, corp);
      if (atk) applyHits(s, atk, t, hits, rng, false);
      break;
    }
    case 'mind-control': {
      // Commanding Voice: take command of the figure for two Actions, now.
      const t = chosenLegion(s, action.targetUid, true); if (!t) return false;
      s.commandeer = { corp, uid: t.uid, actionsLeft: 2 };
      setSteps(s, t.uid, 0);
      logEvent(s, 'card.effect', `${corp} takes command of the ${figureType(t.typeId).name} for two Actions.`, { depth: 1, effect: 'mind-control', targetUid: t.uid }, corp);
      break;
    }
    case 'teleport': {
      const mover = s.figures.filter((g) => g.alive && g.owner === corp)
        .sort((a, b) => moverEngageDist(s, b) - moverEngageDist(s, a))[0]; // the one furthest from the fight
      if (!mover) break;
      const here = sectorAt(s, mover.x, mover.y);
      const cands = s.sectors.filter((sec) => power.scope === 'any'
        ? sec !== here
        : here && Math.abs(sec.ox - here.ox) + Math.abs(sec.oy - here.oy) === here.size); // orthogonally adjacent tile
      let dest: { x: number; y: number } | null = null;
      for (const sec of cands) { dest = teleportDest(s, sec); if (dest) break; }
      if (!dest) break;
      logEvent(s, 'card.effect', `${figureType(mover.typeId).name} teleports to (${dest.x},${dest.y}).`, { depth: 1, effect: 'teleport', uid: mover.uid, x: dest.x, y: dest.y }, corp);
      mover.x = dest.x; mover.y = dest.y;
      break;
    }
    case 'move-force-card': {
      const fc = s.forceCards.find((f) => !f.revealed); if (!fc) return false;
      const cur = s.sectors.find((sec) => sec.id === fc.sectorId);
      const adj = cur && s.sectors.find((sec) => sec.id !== fc.sectorId
        && Math.abs(sec.ox - cur.ox) + Math.abs(sec.oy - cur.oy) === cur.size);
      if (adj) { fc.sectorId = adj.id; logEvent(s, 'card.effect', `A face-down Force Card shifts to Sector ${adj.id}.`, { depth: 1, effect: 'move-force-card', sector: adj.id }, corp); }
      break;
    }
    case 'door': {
      // "A door across any freely chosen corridor or opening not wider than one
      // square", never diagonal. An action with no spot (older cached client)
      // takes the gap nearest the corp's figure closest to the Legion.
      const spots = doorSpots(s);
      let spot = action.dir ? spots.find((e) => e.x === action.x && e.y === action.y && e.dir === action.dir) : fallbackDoorSpot(s, corp, spots);
      if (!spot) return false;
      s.walls = [...s.walls, { x: spot.x, y: spot.y, dir: spot.dir, door: true }]; // new array: walls are shared between states (see clone)
      const [ox, oy] = spot.dir === 'E' ? [spot.x + 1, spot.y] : [spot.x, spot.y + 1];
      logEvent(s, 'card.effect', `A door seals the gap between (${spot.x},${spot.y}) and (${ox},${oy}).`, { depth: 1, effect: 'door', x: spot.x, y: spot.y, dir: spot.dir }, corp);
      break;
    }
    case 'pp-steal': {
      const e = enemyCorpOf(s, corp); if (!e) return false;
      const amt = Math.min(5, s.promotion[e] ?? 0);
      s.promotion[e] = (s.promotion[e] ?? 0) - amt;
      s.promotion[corp] = (s.promotion[corp] ?? 0) + 5;
      logEvent(s, 'card.effect', `${corp} takes 5 Promotion Points (${e} loses ${amt}).`, { depth: 1, effect: 'pp-steal', corp, from: e, gained: 5, lost: amt }, corp);
      break;
    }
    case 'card-steal': {
      const e = enemyCorpOf(s, corp); const eh = e ? s.doomHands[e] : null; if (!eh || !eh.length) break;
      const i = Math.max(0, Math.floor(rng.rollDie(eh.length)) - 1); // rollDie(n) returns 1..n
      const taken = eh.splice(i, 1)[0];
      s.doomHands[corp] = [...(s.doomHands[corp] ?? []), taken];
      logEvent(s, 'card.effect', `${corp} steals a Doomtrooper Card from ${e}.`, { depth: 1, effect: 'card-steal', corp, from: e }, corp);
      break;
    }
    case 'card-discard': {
      const e = enemyCorpOf(s, corp); const eh = e ? s.doomHands[e] : null; if (!eh || !eh.length) break;
      const i = Math.max(0, Math.floor(rng.rollDie(eh.length)) - 1);
      eh.splice(i, 1);
      logEvent(s, 'card.effect', `${corp} forces ${e} to discard a Doomtrooper Card.`, { depth: 1, effect: 'card-discard', corp, from: e }, corp);
      break;
    }
    case 'debuff-move': case 'debuff-firearm': {
      const t = s.figures.filter((f) => f.alive && f.owner !== 'legion' && f.owner !== corp)
        .sort((a, b) => a.woundsTaken - b.woundsTaken)[0];
      if (!t) break;
      if (power.effect === 'debuff-move') t.moveDebuff = (t.moveDebuff ?? 0) + 1;
      else t.firearmDiceDown = (t.firearmDiceDown ?? 0) + 1;
      logEvent(s, 'card.effect', `${figureType(t.typeId).name} is hampered for the rest of the mission.`, { depth: 1, effect: power.effect, targetUid: t.uid }, corp);
      break;
    }
    case 'no-melee-vs': {
      const e = enemyCorpOf(s, corp); if (!e) return false;
      const set = ((s.missionFx.noMeleeVs ??= {})[e] ??= []);
      for (const v of power.vs ?? []) if (!set.includes(v)) set.push(v);
      logEvent(s, 'card.effect', `${e} can no longer close-combat ${(power.vs ?? []).join(', ')} this mission.`, { depth: 1, effect: 'no-melee-vs', corp: e, vs: power.vs ?? [] }, corp);
      break;
    }
    case 'cap-1': {
      const e = enemyCorpOf(s, corp); if (!e) return false;
      (s.roundFx.cap ??= {})[e] = { ...(s.roundFx.cap?.[e]), perFig: 1 };
      logEvent(s, 'card.effect', `${e}'s figures may act only once this round.`, { depth: 1, effect: 'cap-1', corp: e }, corp);
      break;
    }
    case 'lose-extra': {
      const e = enemyCorpOf(s, corp); if (!e) return false;
      s.extraPool[e] = Math.max(0, (s.extraPool[e] ?? 0) - 2);
      logEvent(s, 'card.effect', `${e} loses 2 Extra Actions.`, { depth: 1, effect: 'lose-extra', corp: e, amount: 2 }, corp);
      break;
    }
    case 'false-orders': {
      const e = enemyCorpOf(s, corp); if (!e) return false;
      let drained = 0;
      for (const f of s.figures.filter((f) => f.alive && f.owner === e)) { while (f.actionsLeft > 0 && drained < 2) { f.actionsLeft--; drained++; } }
      s.extraPool[e] = Math.max(0, (s.extraPool[e] ?? 0) - Math.max(0, 2 - drained));
      logEvent(s, 'card.effect', `${e}'s pair is misdirected and loses 2 actions.`, { depth: 1, effect: 'false-orders', corp: e, amount: 2 }, corp);
      break;
    }
    default: return false;
  }
  s.rngState = rng.serialize();
  // discard the played card from the (possibly modified, e.g. after a steal) hand
  s.doomHands[corp] = (s.doomHands[corp] ?? []).filter((c) => c !== action.cardId);
  logEvent(s, 'card.play', `${corp} plays "${power.name}".`, { corp, cardId: action.cardId, power: action.power, name: power.name, effect: power.effect }, corp);
  return true;
}

/** The Legion figure a "freely chosen Legion figure" power targets: the one the
 *  player picked (must be a living Legion figure), or — for an action with no
 *  target, e.g. from an older cached client — the toughest one, as before. */
function chosenLegion(s: GameState, targetUid: string | undefined, mustAct = false): Figure | undefined {
  const ok = (f: Figure) => f.alive && f.owner === 'legion' && (!mustAct || commandable(f));
  if (targetUid === undefined) {
    return s.figures.filter(ok).sort((a, b) => figureType(b.typeId).armor - figureType(a.typeId).armor)[0];
  }
  return s.figures.find((f) => f.uid === targetUid && ok(f));
}

// ---------- Commanding Voice: a corporation directs a Legion figure ----------

/** Can Commanding Voice take this figure? Not the objectives (doorways, the
 *  battle computer) — they have no Actions to perform. */
function commandable(f: Figure): boolean {
  return figureType(f.typeId).actions > 0;
}

// ---------- Remote Controlled Door ----------
// A door sits on the edge between two orthogonally adjacent squares, stored on
// the west/north square facing E/S. It is a wall (blocks moves and sight) until
// one attack scores 3+ hits on it.

type DoorSpot = { x: number; y: number; dir: 'E' | 'S' };
const openSq = (s: GameState, x: number, y: number) => onBoard(s, x, y) && !inCitadel(s, x, y);

/** Is the grid corner (vx,vy) "closed" — does a wall, the board edge or the
 *  Citadel meet it (ignoring the door's own edge)? A door's gap is at most one
 *  square wide exactly when both of its end corners are closed. */
function cornerClosed(s: GameState, vx: number, vy: number, skip: 'AB' | 'CD' | 'AC' | 'BD'): boolean {
  // The four squares around the corner:  A B / C D
  const A: [number, number] = [vx - 1, vy - 1], B: [number, number] = [vx, vy - 1];
  const C: [number, number] = [vx - 1, vy], D: [number, number] = [vx, vy];
  if (![A, B, C, D].every(([x, y]) => openSq(s, x, y))) return true;
  const edges: [string, number, number, 'E' | 'S'][] = [['AB', ...A, 'E'], ['CD', ...C, 'E'], ['AC', ...A, 'S'], ['BD', ...B, 'S']];
  return edges.some(([k, x, y, d]) => k !== skip && wallBetween(s.walls, x, y, d));
}

/** Every gap a Remote Controlled Door may seal: an unwalled orthogonal edge
 *  between two open squares, no wider than one square (both ends closed). */
export function doorSpots(s: GameState): DoorSpot[] {
  const out: DoorSpot[] = [];
  for (const sec of s.sectors)
    for (let y = sec.oy; y < sec.oy + sec.size; y++)
      for (let x = sec.ox; x < sec.ox + sec.size; x++) {
        if (!openSq(s, x, y)) continue;
        if (openSq(s, x + 1, y) && !wallBetween(s.walls, x, y, 'E')
          && cornerClosed(s, x + 1, y, 'CD') && cornerClosed(s, x + 1, y + 1, 'AB')) out.push({ x, y, dir: 'E' });
        if (openSq(s, x, y + 1) && !wallBetween(s.walls, x, y, 'S')
          && cornerClosed(s, x, y + 1, 'BD') && cornerClosed(s, x + 1, y + 1, 'AC')) out.push({ x, y, dir: 'S' });
      }
  return out;
}

function fallbackDoorSpot(s: GameState, corp: string, spots: DoorSpot[]): DoorSpot | undefined {
  const legion = s.figures.filter((f) => f.alive && f.owner === 'legion');
  const mine = s.figures.filter((f) => f.alive && f.owner === corp);
  let anchor: Figure | undefined, best = Infinity;
  for (const t of mine) for (const l of legion) { const d = dist(t.x, t.y, l.x, l.y); if (d < best) { best = d; anchor = t; } }
  const a = anchor ?? mine[0];
  if (!a) return spots[0];
  return [...spots].sort((p, q) => dist(p.x, p.y, a.x, a.y) - dist(q.x, q.y, a.x, a.y))[0];
}

/** The doors `f` can attack from where it stands, per weapon: close combat from
 *  either square beside the door; a firearm from its own side with sight of the
 *  door's near square (or standing on it). */
function doorAttacks(s: GameState, f: Figure): Action[] {
  const doors = s.walls.filter((w) => w.door);
  if (!doors.length) return [];
  const ft = effectiveType(f, s.rank[f.owner] ?? 1, boostFor(s, f));
  const trooper = f.owner !== 'legion';
  const out: Action[] = [];
  for (const w of doors) {
    const dir = w.dir as 'E' | 'S';
    const far: [number, number] = dir === 'E' ? [w.x + 1, w.y] : [w.x, w.y + 1];
    const nearFirst = dir === 'E' ? f.x <= w.x : f.y <= w.y;
    const [qx, qy] = nearFirst ? [w.x, w.y] : far; // the door's square on f's side
    ft.weapons.forEach((wp, idx) => {
      let ok: boolean;
      if (wp.kind === 'close') ok = !(trooper && s.roundFx.noMelee) && f.x === qx && f.y === qy;
      else ok = !(trooper && s.roundFx.noFirearm)
        && ((f.x === qx && f.y === qy) || (dist(f.x, f.y, qx, qy) <= wp.range && hasLineOfSight(s, f.x, f.y, qx, qy)));
      if (ok) out.push({ type: 'attack-door', uid: f.uid, x: w.x, y: w.y, dir, weaponIdx: idx });
    });
  }
  return out;
}

/** One attack on a door: 3+ hits in the roll destroy it (no armor, no saves). */
function attackDoor(s: GameState, f: Figure, a: Extract<Action, { type: 'attack-door' }>) {
  const ft = effectiveType(f, s.rank[f.owner] ?? 1, boostFor(s, f));
  const wp = ft.weapons[a.weaponIdx];
  const rng = rngFor(s);
  const { dice, hits } = rollDice(rng, wp.dice, wp.color, rerollFor(s, f, wp.kind));
  s.rngState = rng.serialize();
  const broken = hits >= 3;
  const label = `${ft.name} attacks the door with ${wp.name}: ${hits} hit${hits === 1 ? '' : 's'}${broken ? ' — the door is DESTROYED' : ' (3 in one attack destroy it)'}`;
  s.lastRoll = { dice, color: wp.color, hits, label, attackerOwner: f.owner, attackerName: ft.name, targetName: 'Door', weapon: wp.name, armor: 0, saves: 0, damage: broken ? 1 : 0, killed: broken };
  logEvent(s, 'combat.roll', label, { attackerUid: f.uid, attackerOwner: f.owner, door: { x: a.x, y: a.y, dir: a.dir }, weapon: wp.name, weaponKind: wp.kind, dice, color: wp.color, hits, destroyed: broken }, f.owner);
  if (broken) s.walls = s.walls.filter((w) => !(w.door && w.x === a.x && w.y === a.y && w.dir === a.dir)); // new array (shared walls)
}

/** Whether a commandeered figure's weapon can hit `target` from where it stands.
 *  It fights as a Legion figure: none of the Doomtroopers' round restrictions. */
function commandeerCanHit(s: GameState, f: Figure, target: Figure, w: Weapon): boolean {
  const d = dist(f.x, f.y, target.x, target.y);
  if (w.kind === 'close') return d === 1 && !wallBlocksStep(s.walls, f.x, f.y, target.x, target.y);
  return d >= 1 && d <= w.range && hasLineOfSight(s, f.x, f.y, target.x, target.y);
}

/** Legal actions while a figure is commandeered: its moves, its attacks on OTHER
 *  Legion figures, and releasing it early (pass-figure on it). Nothing else until
 *  control reverts — the card's two Actions happen immediately. */
function commandeerActions(s: GameState, cmd: NonNullable<GameState['commandeer']>): Action[] {
  const f = s.figures.find((x) => x.uid === cmd.uid && x.alive);
  const actions: Action[] = [];
  if (!f) return [{ type: 'end-turn' }];
  if (getSteps(s, f.uid) > 0 || cmd.actionsLeft > 0) {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        if ((dx || dy) && canStep(s, f.x, f.y, f.x + dx, f.y + dy)) actions.push({ type: 'move', uid: f.uid, x: f.x + dx, y: f.y + dy });
  }
  if (cmd.actionsLeft > 0) {
    const ft = effectiveType(f, 1, boostFor(s, f));
    for (const t of s.figures) {
      if (!t.alive || t.owner !== 'legion' || t.uid === f.uid) continue;
      ft.weapons.forEach((w, idx) => {
        if (commandeerCanHit(s, f, t, w)) actions.push({ type: 'attack', uid: f.uid, targetUid: t.uid, weaponIdx: idx });
      });
    }
  }
  actions.push({ type: 'pass-figure', uid: f.uid });
  return actions;
}

/** Control reverts to the Legion player; the corporation's turn carries on. */
function releaseCommandeer(s: GameState) {
  const cmd = s.commandeer;
  if (!cmd) return;
  delete s.commandeer;
  setSteps(s, cmd.uid, 0);
  const f = s.figures.find((x) => x.uid === cmd.uid);
  if (f?.alive) logEvent(s, 'card.effect', `Control of the ${figureType(f.typeId).name} reverts to the Dark Legion.`, { depth: 1, effect: 'mind-control-end', targetUid: f.uid }, cmd.corp);
  autoAdvance(s);
}

function applyCommandeer(state: GameState, s: GameState, action: Action, actor: string): { state: GameState; ok: boolean; reason?: string } {
  const cmd = s.commandeer!;
  const f = s.figures.find((x) => x.uid === cmd.uid && x.alive);
  const busy = { state, ok: false, reason: 'finish commanding the Legion figure first' };
  if (!f) { releaseCommandeer(s); return { state: s, ok: true }; }
  if (action.type === 'pass-figure') {
    if (action.uid !== f.uid) return busy;
    releaseCommandeer(s);
    return { state: s, ok: true };
  }
  if (action.type === 'move') {
    if (action.uid !== f.uid) return busy;
    if (!canStep(s, f.x, f.y, action.x, action.y)) return { state, ok: false, reason: 'blocked' };
    let steps = getSteps(s, f.uid);
    if (steps <= 0) {
      if (cmd.actionsLeft <= 0) return { state, ok: false, reason: 'no actions left' };
      cmd.actionsLeft -= 1;
      steps = moveRange(s, f);
    }
    f.x = action.x; f.y = action.y;
    setSteps(s, f.uid, steps - 1);
    // A Legion figure: it neither flips Force Cards nor escapes.
    checkWin(s);
    if (s.phase === 'play' && cmd.actionsLeft === 0 && getSteps(s, f.uid) === 0) releaseCommandeer(s);
    return { state: s, ok: true };
  }
  if (action.type === 'attack') {
    if (action.uid !== f.uid) return busy;
    if (cmd.actionsLeft <= 0) return { state, ok: false, reason: 'no actions left' };
    const target = s.figures.find((x) => x.uid === action.targetUid && x.alive);
    if (!target || target.owner !== 'legion' || target.uid === f.uid) return { state, ok: false, reason: 'a commandeered figure attacks other Legion figures' };
    const ft = effectiveType(f, 1, boostFor(s, f));
    const w = ft.weapons[action.weaponIdx];
    if (!w) return { state, ok: false, reason: 'bad weapon' };
    if (!commandeerCanHit(s, f, target, w)) return { state, ok: false, reason: w.kind === 'close' ? 'not adjacent' : 'out of range or no line of sight' };
    cmd.actionsLeft -= 1;
    setSteps(s, f.uid, 0);
    // Credit the commanding corporation (Promotion Points for a kill).
    resolveCombat(s, { ...f, owner: actor }, target, ft, w, action.weaponIdx);
    checkWin(s);
    if (s.phase === 'play' && (!f.alive || cmd.actionsLeft === 0)) releaseCommandeer(s);
    return { state: s, ok: true };
  }
  return busy;
}

/** Toughest (highest-armor) living Legion figure — the default sabotage target. */
function toughestLegion(s: GameState): Figure | undefined {
  return s.figures.filter((f) => f.alive && f.owner === 'legion')
    .sort((a, b) => figureType(b.typeId).armor - figureType(a.typeId).armor)[0];
}
/** Distance from a trooper to the nearest Legion figure (Infinity if none). */
function moverEngageDist(s: GameState, f: Figure): number {
  const legion = s.figures.filter((g) => g.alive && g.owner === 'legion');
  return legion.length ? Math.min(...legion.map((l) => dist(f.x, f.y, l.x, l.y))) : 0;
}

/** If the active seat has no figure with actions remaining, auto-advance the turn. */
function autoAdvance(s: GameState) {
  if (s.phase !== 'play' || !s.activeSeat || s.commandeer) return;
  const mine = s.figures.filter((f) => f.alive && f.owner === s.activeSeat);
  const anyLeft = mine.some((f) => canTakeAction(s, f) || getSteps(s, f.uid) > 0);
  if (!anyLeft) {
    logEvent(s, 'turn.pass', 'No actions remaining — turn passes.', { seat: s.activeSeat }, s.activeSeat);
    endActiveTurn(s);
  }
}
