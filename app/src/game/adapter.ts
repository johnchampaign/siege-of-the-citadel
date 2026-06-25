import { Rng } from 'digital-boardgame-framework';
import type { GameAdapter, GameResult } from 'digital-boardgame-framework';
import type { GameState, Action, Figure, MissionDef, PlayerSeat } from './types';
import { figureType, effectiveType, extraActionPoolSize, CORP_TROOPERS } from './data';
import { MISSIONS, FORCE_CARDS } from './missions';
import { EVENTS, EQUIPMENT, DOOM_CARDS, SECONDARY_MISSIONS, buildEventDeck, dealDoomHands, assignSecondaries } from './cards';
import {
  onBoard, figureAt, canStep, dist, hasLineOfSight, resolveAttack, rankSaveColor, rollDice, inCitadel,
  wallBlocksStep,
} from './rules';
import type { Weapon, FigureType } from './types';

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

/** Can this figure begin another action — from its base actions, or (troopers
 *  only) by drawing from the team Extra Action pool up to the 4-action cap? */
function canTakeAction(s: GameState, f: Figure): boolean {
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
    case 'direct-damage': {
      // Strike one Doomtrooper with three black dice (auto-targets the most wounded).
      const target = s.figures.filter((f) => f.alive && f.owner !== 'legion')
        .sort((a, b) => b.woundsTaken - a.woundsTaken)[0];
      const atk = s.figures.find((f) => f.alive && f.owner === 'legion') ?? target;
      if (target) {
        const rng = rngFor(s);
        const { hits } = rollDice(rng, 3, 'black');
        s.log.push(`  Temporary Defense fires 3 black dice at ${figureType(target.typeId).name} — ${hits} hit(s).`);
        applyHits(s, atk, target, hits, rng, false);
        s.rngState = rng.serialize();
      }
      break;
    }
    default: break; // spawn-only / flavor — reinforcements (if any) already placed
  }
}

/** Does figure `fig` get the round's +1-action boost (from an Event/boost card)? */
function boostFor(s: GameState, fig: Figure): boolean {
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
function armorOf(s: GameState, fig: Figure, tt: { armor: number }): number {
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
    s.log.push(`Dark Legion event: ${ev.name} — ${ev.blurb}`);
    if (ev.spawn) spawnAtLegionEntrance(s, ev.spawn);
    applyEventEffect(s, ev);
  }

  // reset actions for all figures (equipment / boost folded in) and refill the
  // corporations' shared Extra Action pools from their Rank.
  for (const f of s.figures) {
    if (!f.alive) continue;
    f.actionsLeft = effectiveType(f, s.rank[f.owner] ?? 1, boostFor(s, f)).actions;
    f.actionsTaken = 0;
  }
  for (const c of Object.keys(s.extraPool)) s.extraPool[c] = extraActionPoolSize(s.rank[c] ?? 1);
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
  s.log.push(`GAME OVER — ${reason}`);
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
      s.log.push(`${corp} completed Secondary Mission "${def.name}" — +${def.bonusPromotion} PP, +${def.bonusCredits} credit(s).`);
    }
  }
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

    // Doomtrooper Cards may be played on your turn.
    for (const cardId of s.doomHands[actor] ?? []) {
      const card = DOOM_CARDS[cardId];
      if (card?.needsTarget === 'trooper') {
        for (const t of s.figures.filter((g) => g.alive && g.owner === actor && g.woundsTaken > 0))
          actions.push({ type: 'play-doom-card', corp: actor, cardId, targetUid: t.uid });
      } else if (card?.needsTarget === 'legion') {
        for (const t of s.figures.filter((g) => g.alive && g.owner === 'legion'))
          actions.push({ type: 'play-doom-card', corp: actor, cardId, targetUid: t.uid });
      } else {
        actions.push({ type: 'play-doom-card', corp: actor, cardId });
      }
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
              // Close Combat Phobia stops Doomtrooper melee this round.
              if (trooperActor && s.roundFx.noMelee) return;
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

    if (action.type === 'end-turn') {
      endActiveTurn(s);
      return { state: s, ok: true };
    }

    if (action.type === 'pass-figure') {
      const f = s.figures.find((x) => x.uid === action.uid);
      if (!f || f.owner !== actor) return { state, ok: false, reason: 'not your figure' };
      f.actionsLeft = 0;
      f.actionsTaken = 4; // done — no more Extra Actions from the pool either
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
    s.log.push(`  ${owner} loses 1 Credit (Doomtrooper eliminated → ${s.credits[owner]} left).`);
  } else {
    s.promotion[owner] = Math.max(0, (s.promotion[owner] ?? 0) - 5);
    s.log.push(`  ${owner} has no Credits — loses 5 Promotion Points instead (total ${s.promotion[owner]}).`);
  }
}

/** Apply `hits` from `attacker` to `fig`: rolls Kevlarite saves, deals wounds,
 *  handles kill scoring, friendly-fire penalty, and firearm-kill tallies. */
function applyHits(s: GameState, attacker: Figure, fig: Figure, hits: number, rng: Rng, fromFirearm: boolean) {
  if (hits <= 0 || !fig.alive) return;
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
    s.log.push(`Friendly fire! ${figureType(attacker.typeId).name} hit ${figureType(fig.typeId).name} — ${attacker.owner} loses 3 Promotion Points.`);
  }

  fig.woundsTaken += dmg;
  s.log.push(`  → ${figureType(fig.typeId).name} takes ${dmg} wound${dmg === 1 ? '' : 's'} (${tt.strength - fig.woundsTaken}/${tt.strength} left).`);
  if (fig.woundsTaken >= tt.strength) {
    fig.alive = false;
    if (fig.owner === 'legion' && attacker.owner !== 'legion') {
      const pp = figureType(fig.typeId).promotion;
      s.promotion[attacker.owner] = (s.promotion[attacker.owner] ?? 0) + pp;
      if (fromFirearm) s.firearmKills[attacker.owner] = (s.firearmKills[attacker.owner] ?? 0) + 1;
      s.log.push(`  ☠ ${figureType(fig.typeId).name} ELIMINATED — ${attacker.owner} +${pp} PP (total ${s.promotion[attacker.owner]}).`);
    } else if (fig.owner !== 'legion') {
      s.legionKills += 1;
      s.log.push(`  ☠ ${figureType(fig.typeId).name} ELIMINATED.`);
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
    s.log.push(out.label);
    target.woundsTaken += out.damage;
    if (out.killed) {
      target.alive = false;
      if (target.owner === 'legion' && attacker.owner !== 'legion') {
        const pp = figureType(target.typeId).promotion;
        s.promotion[attacker.owner] = (s.promotion[attacker.owner] ?? 0) + pp;
        if (fromFirearm) s.firearmKills[attacker.owner] = (s.firearmKills[attacker.owner] ?? 0) + 1;
        s.log.push(`${attacker.owner} earns ${pp} Promotion Point(s) (total ${s.promotion[attacker.owner]}).`);
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
    s.log.push(s.lastRoll!.label);
    applyHits(s, attacker, target, r1.hits, rng, fromFirearm);
    if (second) {
      const r2 = rollDice(rng, w.dice, w.color, reroll);
      s.log.push(`  second target — ${r2.hits} hit(s)`);
      applyHits(s, attacker, second, r2.hits, rng, fromFirearm);
    }
    s.rngState = rng.serialize();
    return;
  }

  // swing / line / blast: roll once, fan the hits across the affected squares.
  const r = rollDice(rng, w.dice, w.color, reroll);
  s.lastRoll = { dice: r.dice, color: w.color, hits: r.hits, label: `${ft.name} unleashes ${w.name}: ${r.hits} hit(s)`,
    attackerOwner: attacker.owner, attackerName: ft.name, weapon: w.name, area: w.area };
  s.log.push(s.lastRoll!.label);

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
function playDoomCard(s: GameState, action: Extract<Action, { type: 'play-doom-card' }>, actor: string): boolean {
  if (s.phase !== 'play' || actor !== s.activeSeat || action.corp !== actor) return false;
  const hand = s.doomHands[action.corp];
  if (!hand || !hand.includes(action.cardId)) return false;
  const card = DOOM_CARDS[action.cardId];
  if (!card) return false;

  switch (card.effect) {
    case 'extra-actions': // Combat Frenzy / Movement Boost — two free extra Actions
      s.extraPool[action.corp] = (s.extraPool[action.corp] ?? 0) + 2;
      break;
    case 'heal': { // Medicine Injector / Medic — heal 2 wounds on a chosen Doomtrooper
      const t = s.figures.find((g) => g.uid === action.targetUid && g.owner === action.corp && g.alive);
      if (!t) return false;
      t.woundsTaken = Math.max(0, t.woundsTaken - 2);
      break;
    }
    case 'shield': // Combat Aura / Spectral Displacement — Legion can't attack you this round
      (s.roundFx.shield ??= {})[action.corp] = true;
      break;
    case 'armor-down': { // Weak Spot — chosen Legion figure's Armor -1 this round
      const t = s.figures.find((g) => g.uid === action.targetUid && g.owner === 'legion' && g.alive);
      if (!t) return false;
      (s.roundFx.armorDown ??= []).push(t.uid);
      s.log.push(`  ${figureType(t.typeId).name}'s armor is weakened this round.`);
      break;
    }
    case 'attack-legion': { // Control Defense System — 3 black dice at a chosen Legion figure
      const t = s.figures.find((g) => g.uid === action.targetUid && g.owner === 'legion' && g.alive);
      if (!t) return false;
      const atk = s.figures.find((g) => g.alive && g.owner === action.corp); // your team scores the kill
      const rng = rngFor(s);
      const { hits } = rollDice(rng, 3, 'black');
      s.log.push(`  Control Defense System fires 3 black dice at ${figureType(t.typeId).name} — ${hits} hit(s).`);
      if (atk) applyHits(s, atk, t, hits, rng, false);
      s.rngState = rng.serialize();
      break;
    }
    case 'reroll': // Heroic Luck — re-roll one die in each of your attacks this round
      (s.roundFx.reroll ??= {}).team = action.corp;
      break;
    case 'phase': // Molecular Phasing — your Doomtroopers move through walls this round
      s.roundFx.phase = action.corp;
      break;
    case 'flavor': // narrative power — no automatic mechanic
      s.log.push('  (Resolve this card\'s effect manually.)');
      break;
    default:
      return false;
  }
  s.doomHands[action.corp] = hand.filter((c) => c !== action.cardId);
  s.log.push(`${action.corp} plays Doomtrooper Card "${card.name}".`);
  return true;
}

/** If the active seat has no figure with actions remaining, auto-advance the turn. */
function autoAdvance(s: GameState) {
  if (s.phase !== 'play' || !s.activeSeat) return;
  const mine = s.figures.filter((f) => f.alive && f.owner === s.activeSeat);
  const anyLeft = mine.some((f) => canTakeAction(s, f) || getSteps(s, f.uid) > 0);
  if (!anyLeft) {
    s.log.push('No actions remaining — turn passes.');
    endActiveTurn(s);
  }
}
