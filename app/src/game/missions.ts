import type { MissionDef, SectorPlacement, Wall, ForceCardDef } from './types';

const SIZE = 8;

function sector(id: number, mapImage: string, col: number, row: number): SectorPlacement {
  return { id, mapImage, ox: col * SIZE, oy: row * SIZE, size: SIZE };
}

// Force card definitions: revealing one deploys its creatures into the sector.
export const FORCE_CARDS: Record<string, ForceCardDef> = {
  fc1: { id: 'fc1', name: 'Force 1', spawn: ['legionnaire', 'legionnaire', 'legionnaire'] },
  fc2: { id: 'fc2', name: 'Force 2', spawn: ['legionnaire', 'necromutant'] },
  fc3: { id: 'fc3', name: 'Force 3', spawn: ['necromutant', 'necromutant'] },
  fc4: { id: 'fc4', name: 'Force 4', spawn: ['legionnaire', 'legionnaire', 'centurion'] },
  fc5: { id: 'fc5', name: 'Force 5', spawn: ['centurion', 'necromutant'] },
  fc6: { id: 'fc6', name: 'Force 6', spawn: ['razide'] },
  fc7: { id: 'fc7', name: 'Force 7', spawn: ['necromutant', 'centurion', 'legionnaire'] },
};

// Helper: build a perimeter-free layout; sectors are open to each other where
// they touch. (The original boards have interior room walls; this digital port
// keeps sectors open and relies on figures + the Citadel for cover.)
function noWalls(): Wall[] {
  return [];
}

// ===== Trial by Fire (training) =====
// Sectors 1,2 across the top; 4,5,3 across the middle; troopers enter from the
// top edge; the Dark Legion pours out of the Citadel.
const trial: MissionDef = {
  id: 'trial',
  name: 'Trial by Fire (Training)',
  briefing:
    'A fast-play training mission. Two corporation teams strike into the Citadel ' +
    'while one player commands the Dark Legion. Learn movement, line of sight and combat.',
  objective: 'Corporations: eliminate every Dark Legion creature. Dark Legion: eliminate all Doomtroopers.',
  sectors: [
    sector(1, 'map1.jpg', 0, 0),
    sector(2, 'map2.jpg', 1, 0),
    sector(4, 'map4.jpg', 0, 1),
    sector(5, 'map5.jpg', 1, 1),
    sector(3, 'map3.jpg', 2, 1),
  ],
  walls: noWalls(),
  citadel: { x: 15, y: 7, w: 2, h: 2 },
  trooperEntrances: [
    { x: 1, y: 0 }, { x: 2, y: 0 },
    { x: 9, y: 0 }, { x: 10, y: 0 },
  ],
  legionEntrances: [{ x: 14, y: 8 }, { x: 17, y: 8 }, { x: 15, y: 9 }],
  timeLimitRounds: 99,
  forceCards: [
    { cardId: 'fc1', sectorId: 1, revealed: false },
    { cardId: 'fc2', sectorId: 2, revealed: false },
    { cardId: 'fc4', sectorId: 4, revealed: false },
    { cardId: 'fc5', sectorId: 5, revealed: false },
    { cardId: 'fc7', sectorId: 3, revealed: false },
  ],
  corporations: ['Bauhaus', 'Imperial'],
  troopersPerCorp: {
    Bauhaus: ['valerieduval', 'steiner'],
    Imperial: ['murdoch', 'seangallagher'],
  },
  win: { kind: 'eliminate-all' },
};

// ===== Mission 1: Eagle Strike =====
const eagleStrike: MissionDef = {
  id: 'eagle',
  name: 'Mission 1: Eagle Strike',
  briefing:
    'The entrance to Alakhai\'s Citadel has been blown open by the bomb squad. ' +
    'Strike deep and break the Dark Legion\'s defenders.',
  objective:
    'Doomtroopers must earn 20 Promotion Points of Dark Legion kills, then exit ' +
    'one trooper from sector 1 or 4 to collect the reward.',
  sectors: [
    sector(1, 'map1.jpg', 0, 0),
    sector(2, 'map2.jpg', 1, 0),
    sector(5, 'map5.jpg', 2, 0),
    sector(4, 'map4.jpg', 0, 1),
    sector(3, 'map3.jpg', 1, 1),
    sector(6, 'map6.jpg', 2, 1),
  ],
  walls: noWalls(),
  citadel: { x: 11, y: 7, w: 2, h: 2 },
  trooperEntrances: [
    { x: 0, y: 3 }, { x: 0, y: 4 },
    { x: 0, y: 11 }, { x: 0, y: 12 },
  ],
  legionEntrances: [{ x: 10, y: 8 }, { x: 13, y: 8 }, { x: 11, y: 9 }],
  exits: [{ x: 0, y: 3 }, { x: 0, y: 4 }, { x: 0, y: 11 }, { x: 0, y: 12 }],
  timeLimitRounds: 4,
  forceCards: [
    { cardId: 'fc1', sectorId: 1, revealed: false },
    { cardId: 'fc2', sectorId: 2, revealed: false },
    { cardId: 'fc3', sectorId: 5, revealed: false },
    { cardId: 'fc4', sectorId: 4, revealed: false },
    { cardId: 'fc5', sectorId: 3, revealed: false },
    { cardId: 'fc7', sectorId: 6, revealed: false },
  ],
  corporations: ['Bauhaus', 'Imperial', 'Capitol'],
  troopersPerCorp: {
    Bauhaus: ['valerieduval', 'steiner'],
    Imperial: ['murdoch', 'seangallagher'],
    Capitol: ['bigbob', 'hunter'],
  },
  win: { kind: 'promotion', points: 20 },
};

export const MISSIONS: Record<string, MissionDef> = {
  trial,
  eagle: eagleStrike,
};

export const MISSION_LIST = [trial, eagleStrike];
