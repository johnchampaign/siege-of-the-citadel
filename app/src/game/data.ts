import type { FigureType } from './types';

// Standard weapons. Doomtroopers attack with 3 white dice in close combat and
// carry a firearm (range 24). Dark Legion creatures vary by type. These reflect
// the base-game Rank 1-2 reference card and the rulebook's combat rules.

const SWORD = { name: 'Close Combat', kind: 'close' as const, dice: 3, color: 'white' as const, range: 1 };
const CARBINE = { name: 'Firearm', kind: 'firearm' as const, dice: 3, color: 'white' as const, range: 24 };

// ---- Doomtroopers (2 per corporation) ----
function trooper(id: string, name: string, faction: string, token: string): FigureType {
  return {
    id, name, faction, token,
    isTrooper: true,
    armor: 1,
    strength: 5,
    actions: 2,
    weapons: [SWORD, CARBINE],
    promotion: 0,
    kevlariteDice: 1,
  };
}

export const TROOPERS: Record<string, FigureType> = {
  // Bauhaus
  valerieduval:  trooper('valerieduval', 'Valerie Duval', 'Bauhaus', 'valerieduval.png'),
  steiner:       trooper('steiner', 'Max Steiner', 'Bauhaus', 'steiner.png'),
  // Imperial
  murdoch:       trooper('murdoch', 'Edward S. Murdoch', 'Imperial', 'murdoch.png'),
  seangallagher: trooper('seangallagher', 'Sean Gallagher', 'Imperial', 'seangallagher.png'),
  // Cybertronic
  attila3:       trooper('attila3', 'Attila III', 'Cybertronic', 'attila3.png'),
  coralbeach:    trooper('coralbeach', 'Coral Beach', 'Cybertronic', 'coralbeach.png'),
  // Capitol
  bigbob:        trooper('bigbob', '"Big Bob" Watts', 'Capitol', 'bigbob.png'),
  hunter:        trooper('hunter', 'Mitch Hunter', 'Capitol', 'hunter.png'),
  // Mishima
  yojimbo:       trooper('yojimbo', 'Yojimbo', 'Mishima', 'yojimbo.png'),
  tatsu:         trooper('tatsu', 'Tatsu', 'Mishima', 'tatsu.png'),
};

export const CORP_TROOPERS: Record<string, string[]> = {
  Bauhaus: ['valerieduval', 'steiner'],
  Imperial: ['murdoch', 'seangallagher'],
  Cybertronic: ['attila3', 'coralbeach'],
  Capitol: ['bigbob', 'hunter'],
  Mishima: ['yojimbo', 'tatsu'],
};

// Corporation special abilities (applied in full-rules play, off in training).
export const CORP_SPECIAL: Record<string, string> = {
  Bauhaus: 'Crack shots: +1 die on firearm attacks.',
  Imperial: '+1 extra action per turn.',
  Cybertronic: 'Advanced Kevlarite: rolls 2 save dice.',
  Capitol: 'Superior tacticians: +1 extra action.',
  Mishima: 'Light armor: move 4 squares per action.',
};

// ---- Dark Legion creatures ----
export const CREATURES: Record<string, FigureType> = {
  legionnaire: {
    id: 'legionnaire', name: 'Legionnaire', faction: 'Dark Legion', token: 'legionaire.png',
    isTrooper: false, armor: 0, strength: 1, actions: 2,
    weapons: [{ name: 'Claws', kind: 'close', dice: 2, color: 'white', range: 1 }],
    promotion: 1,
  },
  necromutant: {
    id: 'necromutant', name: 'Necromutant', faction: 'Dark Legion', token: 'necromutant.png',
    isTrooper: false, armor: 1, strength: 1, actions: 2,
    weapons: [
      { name: 'Close', kind: 'close', dice: 2, color: 'white', range: 1 },
      { name: 'Firearm', kind: 'firearm', dice: 1, color: 'white', range: 24 },
    ],
    promotion: 2,
  },
  centurion: {
    id: 'centurion', name: 'Centurion', faction: 'Dark Legion', token: 'centurion.png',
    isTrooper: false, armor: 2, strength: 1, actions: 2,
    weapons: [
      { name: 'Close', kind: 'close', dice: 2, color: 'white', range: 1 },
      { name: 'Firearm', kind: 'firearm', dice: 2, color: 'white', range: 24 },
    ],
    promotion: 3,
  },
  razide: {
    id: 'razide', name: 'Razide', faction: 'Dark Legion', token: 'razide.png',
    isTrooper: false, armor: 2, strength: 1, actions: 2,
    weapons: [
      { name: 'Close', kind: 'close', dice: 2, color: 'white', range: 1 },
      { name: 'Heavy Firearm', kind: 'firearm', dice: 3, color: 'red', range: 24 },
    ],
    promotion: 6,
  },
  nepharite: {
    id: 'nepharite', name: 'Nepharite', faction: 'Dark Legion', token: 'nepharite.png',
    isTrooper: false, armor: 2, strength: 1, actions: 3,
    weapons: [
      { name: 'Dark Blade', kind: 'close', dice: 3, color: 'red', range: 1 },
      { name: 'Dark Bolt', kind: 'firearm', dice: 2, color: 'red', range: 24 },
    ],
    promotion: 7,
  },
  ezoghoul: {
    id: 'ezoghoul', name: 'Ezoghoul', faction: 'Dark Legion', token: 'ezoghoul.png',
    isTrooper: false, armor: 3, strength: 1, actions: 3,
    weapons: [{ name: 'Crushing Blow', kind: 'close', dice: 3, color: 'black', range: 1 }],
    promotion: 10,
  },
};

export function figureType(typeId: string): FigureType {
  return TROOPERS[typeId] ?? CREATURES[typeId];
}
