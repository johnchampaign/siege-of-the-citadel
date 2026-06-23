import type { Weapon } from './types';

// ---------------------------------------------------------------------------
// Equipment cards (Doomtrooper gear) and Dark Legion event cards.
//
// Card NAMES are used as factual identifiers; all rules text below is original
// functional shorthand, not reproduced from the printed cards. Effects are the
// mechanical hooks the engine applies.
// ---------------------------------------------------------------------------

export interface EquipmentMods {
  bonusCloseDice?: number;
  bonusFirearmDice?: number;
  bonusActions?: number;
  bonusKevlarite?: number;
  replaceFirearm?: Weapon;     // swap the trooper's firearm for a better one
  replaceClose?: Weapon;       // swap the close-combat weapon
}

export interface EquipmentDef {
  id: string;
  name: string;
  cost: number;                // credits
  rank: number;                // minimum rank to take it (weapons), else 1
  kind: 'weapon' | 'gear';
  blurb: string;               // our own one-line description
  mods: EquipmentMods;
}

export const EQUIPMENT: Record<string, EquipmentDef> = {
  // --- special weapons (rank-gated) ---
  punisher: { id: 'punisher', name: 'Punisher Sword', cost: 0, rank: 1, kind: 'weapon',
    blurb: 'Heavy close-combat blade — +1 close die.', mods: { bonusCloseDice: 1 } },
  plasma: { id: 'plasma', name: 'Plasma Carbine', cost: 0, rank: 1, kind: 'weapon',
    blurb: 'Upgraded firearm — rolls red dice.', mods: { replaceFirearm: { name: 'Plasma Carbine', kind: 'firearm', dice: 3, color: 'red', range: 24 } } },
  gehenna: { id: 'gehenna', name: 'Gehenna Puker', cost: 0, rank: 2, kind: 'weapon',
    blurb: 'Incinerator — hits every enemy along the line of fire (range 12).', mods: { replaceFirearm: { name: 'Gehenna Puker', kind: 'firearm', dice: 4, color: 'red', range: 12, area: 'line' } } },
  deathlock: { id: 'deathlock', name: 'Deathlock Drum', cost: 0, rank: 2, kind: 'weapon',
    blurb: 'Drum-fed autogun — 4 red firearm dice.', mods: { replaceFirearm: { name: 'Deathlock Drum', kind: 'firearm', dice: 4, color: 'red', range: 24 } } },
  punishercombo: { id: 'punishercombo', name: 'Punisher Combo', cost: 0, rank: 2, kind: 'weapon',
    blurb: 'Blade + sidearm — +1 close die and +1 firearm die.', mods: { bonusCloseDice: 1, bonusFirearmDice: 1 } },
  violator: { id: 'violator', name: 'Violator Sword', cost: 0, rank: 3, kind: 'weapon',
    blurb: 'Whirling blade — strikes every adjacent figure.', mods: { replaceClose: { name: 'Violator Sword', kind: 'close', dice: 4, color: 'red', range: 1, area: 'swing' } } },
  violatorcombo: { id: 'violatorcombo', name: 'Violator Combo', cost: 0, rank: 3, kind: 'weapon',
    blurb: 'Whirling blade + carbine — swing strike and +1 firearm die.', mods: { replaceClose: { name: 'Violator Sword', kind: 'close', dice: 4, color: 'red', range: 1, area: 'swing' }, bonusFirearmDice: 1 } },
  nimrod: { id: 'nimrod', name: 'Nimrod Autocannon', cost: 0, rank: 4, kind: 'weapon',
    blurb: 'Twin-barrel cannon — fires at two targets at once.', mods: { replaceFirearm: { name: 'Nimrod Autocannon', kind: 'firearm', dice: 3, color: 'black', range: 24, area: 'double' } } },

  // --- gear (credit cost) ---
  lasersight: { id: 'lasersight', name: 'Laser Sight', cost: 1, rank: 1, kind: 'gear',
    blurb: '+1 firearm die.', mods: { bonusFirearmDice: 1 } },
  injector: { id: 'injector', name: 'Coagulant Auto-Injector', cost: 1, rank: 1, kind: 'gear',
    blurb: 'Tougher constitution — +1 Kevlarite save die.', mods: { bonusKevlarite: 1 } },
  powerarm: { id: 'powerarm', name: 'Cybernetic Power Arm', cost: 2, rank: 1, kind: 'gear',
    blurb: '+1 close-combat die.', mods: { bonusCloseDice: 1 } },
  explosiveammo: { id: 'explosiveammo', name: 'Explosive Ammo', cost: 2, rank: 1, kind: 'gear',
    blurb: '+1 firearm die.', mods: { bonusFirearmDice: 1 } },
  grenade: { id: 'grenade', name: 'Grenade Launcher', cost: 2, rank: 1, kind: 'gear',
    blurb: 'Lobbed blast — hits a target square and everything around it.', mods: { replaceFirearm: { name: 'Grenade Launcher', kind: 'firearm', dice: 3, color: 'red', range: 12, area: 'blast' } } },
  helmet: { id: 'helmet', name: 'Command Helmet', cost: 3, rank: 1, kind: 'gear',
    blurb: '+1 action per turn.', mods: { bonusActions: 1 } },
  targeteye: { id: 'targeteye', name: 'Targeting Eye', cost: 3, rank: 1, kind: 'gear',
    blurb: '+1 firearm die.', mods: { bonusFirearmDice: 1 } },
  medic: { id: 'medic', name: 'Combat Medic Unit', cost: 3, rank: 1, kind: 'gear',
    blurb: 'Field medicine — +1 strength (tougher to put down).', mods: { bonusKevlarite: 1 } },
  disruptor: { id: 'disruptor', name: 'Disruptor', cost: 3, rank: 1, kind: 'gear',
    blurb: 'Armour-piercing — +1 close and +1 firearm die.', mods: { bonusCloseDice: 1, bonusFirearmDice: 1 } },
  phaser: { id: 'phaser', name: 'Molecular Phaser', cost: 3, rank: 1, kind: 'gear',
    blurb: 'Phased firearm — +2 firearm dice.', mods: { bonusFirearmDice: 2 } },
  teleportal: { id: 'teleportal', name: 'Teleportal', cost: 3, rank: 1, kind: 'gear',
    blurb: '+1 action per turn (blink repositioning).', mods: { bonusActions: 1 } },
};

// ---------------------------------------------------------------------------
// Doomtrooper Cards — one-shot effects, each corp is dealt some at setup.
// ---------------------------------------------------------------------------
export interface DoomCardDef {
  id: string;
  name: string;
  blurb: string;
  effect: 'adrenaline' | 'rally' | 'secondwind' | 'medkit';
  needsTarget?: boolean;
}

export const DOOM_CARDS: Record<string, DoomCardDef> = {
  adrenaline: { id: 'adrenaline', name: 'Adrenaline Surge', blurb: '+2 to your Extra Action pool this round.', effect: 'adrenaline' },
  rally: { id: 'rally', name: 'Rally', blurb: 'Refresh all your Doomtroopers\' actions.', effect: 'rally' },
  secondwind: { id: 'secondwind', name: 'Second Wind', blurb: 'Heal 1 wound on every one of your Doomtroopers.', effect: 'secondwind' },
  medkit: { id: 'medkit', name: 'Field Medkit', blurb: 'Heal 2 wounds on one Doomtrooper.', effect: 'medkit', needsTarget: true },
};

const DOOM_DECK = ['adrenaline', 'rally', 'secondwind', 'medkit', 'adrenaline', 'secondwind', 'medkit', 'rally'];

/** Deal each corporation a hand of Doomtrooper Cards (Capitol draws 3, others 2). */
export function dealDoomHands(corps: string[], rng: { shuffle: <T>(a: readonly T[]) => T[] }): Record<string, string[]> {
  const deck = rng.shuffle(DOOM_DECK);
  let i = 0;
  const hands: Record<string, string[]> = {};
  for (const c of corps) {
    const n = c === 'Capitol' ? 3 : 2;
    hands[c] = [];
    for (let k = 0; k < n; k++) hands[c].push(deck[i++ % deck.length]);
  }
  return hands;
}

// ---------------------------------------------------------------------------
// Secondary Mission Cards — a secret per-corp objective (when 2+ corp teams).
// Checked at the end of the mission for a bonus.
// ---------------------------------------------------------------------------
export interface SecondaryDef {
  id: string;
  name: string;
  blurb: string;
  bonusPromotion: number;
  bonusCredits: number;
  /** evaluated against the final state for this corp */
  check: (ctx: SecondaryCtx) => boolean;
}
export interface SecondaryCtx {
  corp: string;
  promotion: number;       // this corp's promotion points
  firearmKills: number;    // creatures this corp killed with firearms
  troopersAlive: number;   // this corp's surviving troopers
  troopersTotal: number;
  escaped: number;
  troopersWon: boolean;
}

export const SECONDARY_MISSIONS: Record<string, SecondaryDef> = {
  marksman: { id: 'marksman', name: 'Marksman', blurb: 'Eliminate 3 Dark Legion creatures with firearms.', bonusPromotion: 5, bonusCredits: 0, check: (c) => c.firearmKills >= 3 },
  noLosses: { id: 'noLosses', name: 'No Casualties', blurb: 'Finish the mission with all your Doomtroopers alive.', bonusPromotion: 0, bonusCredits: 1, check: (c) => c.troopersAlive === c.troopersTotal },
  glory: { id: 'glory', name: 'Glory Hound', blurb: 'Earn at least 10 Promotion Points this mission.', bonusPromotion: 3, bonusCredits: 0, check: (c) => c.promotion >= 10 },
  survivor: { id: 'survivor', name: 'Survivor', blurb: 'Keep at least one Doomtrooper standing at mission end.', bonusPromotion: 2, bonusCredits: 0, check: (c) => c.troopersAlive >= 1 },
};

/** Assign each corp a distinct secret Secondary Mission. */
export function assignSecondaries(corps: string[], rng: { shuffle: <T>(a: readonly T[]) => T[] }): Record<string, string> {
  const ids = rng.shuffle(Object.keys(SECONDARY_MISSIONS));
  const out: Record<string, string> = {};
  corps.forEach((c, i) => { out[c] = ids[i % ids.length]; });
  return out;
}

export const EQUIPMENT_LIST = Object.values(EQUIPMENT);

// ---------------------------------------------------------------------------
// Dark Legion event cards. Drawn once per round (when the mission uses events).
// ---------------------------------------------------------------------------
export interface EventDef {
  id: string;
  name: string;
  blurb: string;
  spawn?: string[];            // creatures to deploy at a Legion entrance
  legionFrenzy?: boolean;      // every Legion creature gets +1 action this round
}

export const EVENTS: Record<string, EventDef> = {
  charge: { id: 'charge', name: 'Legionnaires Charge', blurb: 'Two Legionnaires storm in.', spawn: ['legionnaire', 'legionnaire'] },
  reinforce: { id: 'reinforce', name: 'Dark Reinforcements', blurb: 'A Necromutant arrives.', spawn: ['necromutant'] },
  centurions: { id: 'centurions', name: 'Centurion Strike Team', blurb: 'A Centurion deploys.', spawn: ['centurion'] },
  necrofrenzy: { id: 'necrofrenzy', name: 'Necrofrenzy', blurb: 'The Legion surges — +1 action to every creature this round.', legionFrenzy: true },
  razide: { id: 'razide', name: 'Razide Unleashed', blurb: 'A Razide rampages onto the board.', spawn: ['razide'] },
  lull: { id: 'lull', name: 'Eerie Lull', blurb: 'No reinforcements this round.' },
};

export function buildEventDeck(): string[] {
  // a representative shuffle-able multiset
  return ['charge', 'reinforce', 'lull', 'necrofrenzy', 'centurions', 'charge', 'reinforce', 'razide', 'lull'];
}
