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
    blurb: 'Short-range incinerator — +2 firearm dice, range 12.', mods: { replaceFirearm: { name: 'Gehenna Puker', kind: 'firearm', dice: 5, color: 'red', range: 12 } } },
  violator: { id: 'violator', name: 'Violator Sword', cost: 0, rank: 3, kind: 'weapon',
    blurb: 'Whirling blade — +2 close dice.', mods: { replaceClose: { name: 'Violator Sword', kind: 'close', dice: 5, color: 'red', range: 1 } } },
  nimrod: { id: 'nimrod', name: 'Nimrod Autocannon', cost: 0, rank: 4, kind: 'weapon',
    blurb: 'Twin-barrel cannon — 3 black firearm dice.', mods: { replaceFirearm: { name: 'Nimrod Autocannon', kind: 'firearm', dice: 3, color: 'black', range: 24 } } },

  // --- gear (credit cost) ---
  lasersight: { id: 'lasersight', name: 'Laser Sight', cost: 1, rank: 1, kind: 'gear',
    blurb: '+1 firearm die.', mods: { bonusFirearmDice: 1 } },
  injector: { id: 'injector', name: 'Coagulant Auto-Injector', cost: 1, rank: 1, kind: 'gear',
    blurb: 'Tougher constitution — +1 Kevlarite save die.', mods: { bonusKevlarite: 1 } },
  powerarm: { id: 'powerarm', name: 'Cybernetic Power Arm', cost: 2, rank: 1, kind: 'gear',
    blurb: '+1 close-combat die.', mods: { bonusCloseDice: 1 } },
  explosiveammo: { id: 'explosiveammo', name: 'Explosive Ammo', cost: 2, rank: 1, kind: 'gear',
    blurb: '+1 firearm die.', mods: { bonusFirearmDice: 1 } },
  helmet: { id: 'helmet', name: 'Command Helmet', cost: 3, rank: 1, kind: 'gear',
    blurb: '+1 action per turn.', mods: { bonusActions: 1 } },
  targeteye: { id: 'targeteye', name: 'Targeting Eye', cost: 3, rank: 1, kind: 'gear',
    blurb: '+1 firearm die.', mods: { bonusFirearmDice: 1 } },
};

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
