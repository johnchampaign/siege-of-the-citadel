import type { MissionDef, SectorPlacement, ForceCardDef, Placement } from './types';
import { CORP_TROOPERS } from './data';
import { wallsForSectors } from './sectorWalls';
import { citadelWingWalls } from './rules';

const SIZE = 8;

function sector(id: number, mapImage: string, col: number, row: number): SectorPlacement {
  return { id, mapImage, ox: col * SIZE, oy: row * SIZE, size: SIZE };
}

// Force card definitions — transcribed from the actual game's Force Cards (the
// f1..f12 card faces). Revealing one deploys its creatures into the sector.
//  1-4 Legionnaire Cohort: 3 Legionnaires   5 Necromutant Cohort: 1 Necro + 1 Leg
//  6 Necromutant Cohort: 2 Necromutants     7 Centurion Cohort: 1 Cent + 1 Necro + 1 Leg
//  8-9 Razide Cohort: 1 Razide + 2 Legs     10 Nepharite Overlord: 1 Nepharite
//  11 Ezoghoul Beastmaster: 1 Ezoghoul      12 Diversion Cohort: empty (the decoy/Key card)
export const FORCE_CARDS: Record<string, ForceCardDef> = {
  fc1: { id: 'fc1', name: 'Legionnaire Cohort', spawn: ['legionnaire', 'legionnaire', 'legionnaire'] },
  fc2: { id: 'fc2', name: 'Legionnaire Cohort', spawn: ['legionnaire', 'legionnaire', 'legionnaire'] },
  fc3: { id: 'fc3', name: 'Legionnaire Cohort', spawn: ['legionnaire', 'legionnaire', 'legionnaire'] },
  fc4: { id: 'fc4', name: 'Legionnaire Cohort', spawn: ['legionnaire', 'legionnaire', 'legionnaire'] },
  fc5: { id: 'fc5', name: 'Necromutant Cohort', spawn: ['necromutant', 'legionnaire'] },
  fc6: { id: 'fc6', name: 'Necromutant Cohort', spawn: ['necromutant', 'necromutant'] },
  fc7: { id: 'fc7', name: 'Centurion Cohort', spawn: ['centurion', 'necromutant', 'legionnaire'] },
  fc8: { id: 'fc8', name: 'Razide Cohort', spawn: ['razide', 'legionnaire', 'legionnaire'] },
  fc9: { id: 'fc9', name: 'Razide Cohort', spawn: ['razide', 'legionnaire', 'legionnaire'] },
  fc10: { id: 'fc10', name: 'Nepharite Overlord', spawn: ['nepharite'] },
  fc11: { id: 'fc11', name: 'Ezoghoul Beastmaster', spawn: ['ezoghoul'] },
  fc12: { id: 'fc12', name: 'Diversion Cohort', spawn: [] }, // the decoy / Key card — no creatures
};

const ALL_CORPS = ['Bauhaus', 'Imperial', 'Capitol'];
function corpTroopers(corps: string[]): Record<string, string[]> {
  return Object.fromEntries(corps.map((c) => [c, CORP_TROOPERS[c]]));
}

interface Build {
  id: string;
  number?: number;
  name: string;
  briefing: string;
  objective: string;
  sectorDefs: [number, string, number, number][]; // id, image, col, row
  citadel?: { cx: number; cy: number };
  trooperEntrances: { x: number; y: number }[];
  legionEntrances: { x: number; y: number }[];
  exits?: { x: number; y: number }[];
  timeLimitRounds: number;
  forceCardSectors: [string, number][]; // [cardId, sectorId]
  placements?: Placement[];
  corporations?: string[];
  win: MissionDef['win'];
  reward?: { troopers: number; legion: number };
  usesEvents?: boolean;
}

function build(b: Build): MissionDef {
  const sectors = b.sectorDefs.map(([id, img, c, r]) => sector(id, img, c, r));
  const corps = b.corporations ?? ALL_CORPS;
  return {
    id: b.id,
    number: b.number,
    name: b.name,
    briefing: b.briefing,
    objective: b.objective,
    sectors,
    // traced tile walls (sectorWalls.ts) plus the Citadel's wing walls
    walls: [...wallsForSectors(sectors), ...(b.citadel ? citadelWingWalls(b.citadel) : [])],

    citadel: b.citadel,
    trooperEntrances: b.trooperEntrances,
    legionEntrances: b.legionEntrances,
    exits: b.exits,
    timeLimitRounds: b.timeLimitRounds,
    forceCards: b.forceCardSectors.map(([cardId, sectorId]) => ({ cardId, sectorId, revealed: false })),
    placements: b.placements,
    corporations: corps,
    troopersPerCorp: corpTroopers(corps),
    win: b.win,
    reward: b.reward,
    usesEvents: b.usesEvents,
  };
}

// ===== Trial by Fire (training) =====
const trial = build({
  id: 'trial',
  name: 'Trial by Fire (Training)',
  briefing: 'A fast-play training mission. Two corporation teams strike in while one player commands the Dark Legion. Learn movement, line of sight and combat.',
  objective: 'Corporations: eliminate every Dark Legion creature. Dark Legion: eliminate all Doomtroopers.',
  sectorDefs: [[1, 'map1.jpg', 0, 0], [2, 'map2.jpg', 1, 0], [4, 'map4.jpg', 0, 1], [5, 'map5.jpg', 1, 1], [3, 'map3.jpg', 2, 1]],
  citadel: { cx: 16, cy: 8 }, // training: corner where sectors 2,5,3 (+ missing NE) meet, per the setup diagram
  trooperEntrances: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 9, y: 0 }, { x: 10, y: 0 }],
  legionEntrances: [{ x: 15, y: 3 }, { x: 11, y: 7 }, { x: 19, y: 8 }, { x: 15, y: 12 }], // the Citadel doorway gaps
  timeLimitRounds: 99,
  forceCardSectors: [['fc1', 1], ['fc2', 2], ['fc4', 4], ['fc5', 5], ['fc7', 3]], // RAW: cards 1,2,4,5,7
  corporations: ['Bauhaus', 'Imperial'],
  win: { kind: 'eliminate-all' },
});

// ===== Mission 1: Eagle Strike =====
const m1 = build({
  id: 'eagle', number: 1, name: 'Mission 1: Eagle Strike',
  briefing: 'The Citadel entrance is blown open. Strike deep, break the defenders, then withdraw.',
  objective: 'Earn 20 Promotion Points of Dark Legion kills, then exit one trooper from the entry edge.',
  sectorDefs: [[1, 'map1.jpg', 0, 0], [2, 'map2.jpg', 1, 0], [5, 'map5.jpg', 2, 0], [4, 'map4.jpg', 0, 1], [3, 'map3.jpg', 1, 1], [6, 'map6.jpg', 2, 1]],
  citadel: { cx: 8, cy: 8 }, // TODO: confirm vs mission diagram
  trooperEntrances: [{ x: 0, y: 3 }, { x: 0, y: 4 }, { x: 0, y: 11 }, { x: 0, y: 12 }],
  legionEntrances: [{ x: 7, y: 3 }, { x: 3, y: 8 }, { x: 11, y: 8 }, { x: 8, y: 11 }], // the Citadel doorway gaps
  exits: [{ x: 0, y: 3 }, { x: 0, y: 4 }, { x: 0, y: 11 }, { x: 0, y: 12 }],
  timeLimitRounds: 4,
  forceCardSectors: [['fc1', 1], ['fc2', 2], ['fc3', 5], ['fc4', 4], ['fc5', 3], ['fc7', 6]],
  win: { kind: 'promotion', points: 20, escape: true }, reward: { troopers: 1, legion: 2 }, usesEvents: true,
});

// ===== Mission 2: Trapped! =====
const m2 = build({
  id: 'trapped', number: 2, name: 'Mission 2: Trapped!',
  briefing: 'A gigantic Ezoghoul is hot on your heels. Make the long run home before it catches you.',
  objective: 'Get a trooper to the escape exit before the mission ends.',
  sectorDefs: [[8, 'map8.jpg', 1, 0], [2, 'map2.jpg', 2, 0], [3, 'map3.jpg', 3, 0], [4, 'map4.jpg', 0, 1], [5, 'map5.jpg', 1, 1], [7, 'map7.jpg', 2, 1]],
  trooperEntrances: [{ x: 9, y: 0 }, { x: 10, y: 0 }],
  legionEntrances: [{ x: 24, y: 3 }, { x: 24, y: 4 }],
  exits: [{ x: 24, y: 3 }, { x: 24, y: 4 }],
  timeLimitRounds: 7,
  forceCardSectors: [['fc3', 8], ['fc4', 2], ['fc5', 3], ['fc6', 4], ['fc7', 5]],
  placements: [{ typeId: 'ezoghoul', x: 9, y: 7, tag: 'hunter' }],
  win: { kind: 'escape', count: 1 }, reward: { troopers: 1, legion: 1 }, usesEvents: true,
});

// ===== Mission 3: Get the Boss! =====
const m3 = build({
  id: 'getboss', number: 3, name: 'Mission 3: Get the Boss!',
  briefing: 'Eliminating ordinary troops is not enough. Find and destroy the Centurion subcommander, Ghash.',
  objective: 'Eliminate Ghash (the tagged Centurion). No ordinary Centurions are used.',
  sectorDefs: [[3, 'map3.jpg', 2, 0], [2, 'map2.jpg', 1, 0], [5, 'map5.jpg', 2, 1], [4, 'map4.jpg', 0, 1], [1, 'map1.jpg', 1, 1]],
  citadel: { cx: 16, cy: 8 }, // TODO: confirm vs mission diagram
  trooperEntrances: [{ x: 0, y: 11 }, { x: 0, y: 12 }, { x: 8, y: 0 }, { x: 9, y: 0 }],
  legionEntrances: [{ x: 15, y: 3 }, { x: 11, y: 7 }, { x: 19, y: 8 }, { x: 15, y: 12 }], // the Citadel doorway gaps
  timeLimitRounds: 8,
  forceCardSectors: [['fc1', 3], ['fc2', 2], ['fc4', 5], ['fc7', 4], ['fc5', 1]],
  placements: [{ typeId: 'centurion', x: 18, y: 3, tag: 'boss' }],
  win: { kind: 'eliminate-tagged', tag: 'boss', label: 'Ghash, the Centurion subcommander' },
  reward: { troopers: 2, legion: 2 }, usesEvents: true,
});

// ===== Mission 4: Assault on the East Tower =====
const m4 = build({
  id: 'easttower', number: 4, name: 'Mission 4: Assault on the East Tower',
  briefing: 'The Dark Legion is massing near the east tower. Break their lines and wipe out the horde.',
  objective: 'Eliminate every Dark Legion figure on the board.',
  sectorDefs: [[7, 'map7.jpg', 1, 0], [8, 'map8.jpg', 2, 0], [3, 'map3.jpg', 3, 0], [5, 'map5.jpg', 0, 1], [2, 'map2.jpg', 1, 1], [6, 'map6.jpg', 2, 1], [4, 'map4.jpg', 0, 2], [1, 'map1.jpg', 1, 2]],
  trooperEntrances: [{ x: 0, y: 11 }, { x: 8, y: 23 }, { x: 9, y: 23 }, { x: 16, y: 23 }],
  legionEntrances: [{ x: 12, y: 8 }, { x: 20, y: 8 }],
  timeLimitRounds: 8,
  forceCardSectors: [['fc1', 7], ['fc2', 8], ['fc4', 3], ['fc8', 5], ['fc5', 2], ['fc12', 6], ['fc7', 4], ['fc9', 1]],
  win: { kind: 'eliminate-all' }, reward: { troopers: 2, legion: 2 }, usesEvents: true,
});

// ===== Mission 5: Break Their Back! =====
const m5 = build({
  id: 'breakback', number: 5, name: 'Mission 5: Break Their Back!',
  briefing: 'A High-Tec battle computer is breaking your resistance. Find it and destroy it.',
  objective: 'Destroy the Battle Computer (Armor 2 — strike 2+ hits in one attack).',
  sectorDefs: [[1, 'map1.jpg', 0, 0], [3, 'map3.jpg', 1, 0], [8, 'map8.jpg', 2, 0], [6, 'map6.jpg', 3, 0], [2, 'map2.jpg', 1, 1], [5, 'map5.jpg', 2, 1], [4, 'map4.jpg', 0, 1]],
  trooperEntrances: [{ x: 0, y: 3 }, { x: 0, y: 4 }, { x: 8, y: 0 }, { x: 9, y: 0 }],
  legionEntrances: [{ x: 19, y: 3 }, { x: 19, y: 4 }],
  timeLimitRounds: 6,
  forceCardSectors: [['fc1', 1], ['fc2', 3], ['fc4', 8], ['fc8', 6], ['fc5', 2], ['fc9', 5]],
  placements: [{ typeId: 'computer', x: 19, y: 11, tag: 'target' }],
  win: { kind: 'eliminate-tagged', tag: 'target', label: 'the Battle Computer' },
  reward: { troopers: 3, legion: 2 }, usesEvents: true,
});

// ===== Mission 6: Hold the Fort =====
const m6 = build({
  id: 'holdfort', number: 6, name: 'Mission 6: Hold the Fort',
  briefing: 'The Dark Legion is trying to break through near the east tower. Hold the line — don\'t let them past.',
  objective: 'Survive all rounds. If any Doomtrooper is still standing at the time limit, you hold.',
  sectorDefs: [[7, 'map7.jpg', 1, 0], [3, 'map3.jpg', 2, 0], [1, 'map1.jpg', 3, 0], [8, 'map8.jpg', 1, 1], [2, 'map2.jpg', 2, 1], [5, 'map5.jpg', 0, 1]],
  trooperEntrances: [{ x: 8, y: 0 }, { x: 9, y: 0 }, { x: 10, y: 0 }, { x: 11, y: 0 }],
  legionEntrances: [{ x: 24, y: 3 }, { x: 24, y: 4 }],
  timeLimitRounds: 6,
  forceCardSectors: [['fc4', 7], ['fc8', 3], ['fc9', 1], ['fc7', 8], ['fc12', 2]],
  win: { kind: 'survive' }, reward: { troopers: 1, legion: 3 }, usesEvents: true,
});

// ===== Mission 7: Portal of Doom =====
const m7 = build({
  id: 'portal', number: 7, name: 'Mission 7: Portal of Doom',
  briefing: 'Search the catacombs for the Portal of Doom and pass through to learn what lies beyond.',
  objective: 'Get at least two Doomtroopers through the portal (exit on the far edge).',
  sectorDefs: [[6, 'map6.jpg', 0, 0], [1, 'map1.jpg', 1, 0], [7, 'map7.jpg', 2, 0], [8, 'map8.jpg', 3, 0], [5, 'map5.jpg', 2, 1], [2, 'map2.jpg', 1, 1]],
  trooperEntrances: [{ x: 16, y: 0 }, { x: 17, y: 0 }, { x: 8, y: 7 }, { x: 9, y: 7 }],
  legionEntrances: [{ x: 0, y: 3 }, { x: 0, y: 4 }],
  exits: [{ x: 31, y: 3 }, { x: 31, y: 4 }, { x: 31, y: 5 }],
  timeLimitRounds: 6,
  forceCardSectors: [['fc1', 6], ['fc2', 1], ['fc4', 7], ['fc8', 8], ['fc9', 5], ['fc6', 2]],
  win: { kind: 'escape', count: 2 }, reward: { troopers: 3, legion: 2 }, usesEvents: true,
});

// ===== Mission 8: To the Top =====
const m8 = build({
  id: 'tothetop', number: 8, name: 'Mission 8: To the Top',
  briefing: 'A powerful combat-teleporter sits in the top level of the Citadel. Destroy both doorways.',
  objective: 'Destroy both Teleporter Doorways (Armor 3 — strike 4 hits in one attack).',
  sectorDefs: [[1, 'map1.jpg', 2, 0], [3, 'map3.jpg', 1, 0], [8, 'map8.jpg', 2, 1], [5, 'map5.jpg', 0, 1], [6, 'map6.jpg', 1, 1], [4, 'map4.jpg', 1, 2], [7, 'map7.jpg', 2, 2]],
  citadel: { cx: 16, cy: 8 }, // TODO: confirm vs mission diagram
  trooperEntrances: [{ x: 18, y: 0 }, { x: 17, y: 0 }, { x: 0, y: 8 }, { x: 0, y: 9 }],
  legionEntrances: [{ x: 15, y: 3 }, { x: 11, y: 7 }, { x: 19, y: 8 }, { x: 15, y: 12 }], // the Citadel doorway gaps
  timeLimitRounds: 5,
  forceCardSectors: [['fc1', 1], ['fc4', 3], ['fc9', 8], ['fc8', 5], ['fc12', 6], ['fc7', 4], ['fc6', 7]],
  placements: [{ typeId: 'door', x: 17, y: 3, tag: 'door' }, { typeId: 'door', x: 12, y: 11, tag: 'door' }],
  win: { kind: 'eliminate-tagged', tag: 'door', label: 'both Teleporter Doorways' },
  reward: { troopers: 3, legion: 1 }, usesEvents: true,
});

// ===== Mission 9: Corridors of Death =====
const m9 = build({
  id: 'corridors', number: 9, name: 'Mission 9: Corridors of Death',
  briefing: 'An Ezoghoul lurks in the lowest level of the Citadel. Get down there and wipe it out.',
  objective: 'Eliminate the Ezoghoul.',
  sectorDefs: [[1, 'map1.jpg', 0, 0], [2, 'map2.jpg', 1, 0], [7, 'map7.jpg', 2, 0], [4, 'map4.jpg', 0, 1], [6, 'map6.jpg', 1, 1], [5, 'map5.jpg', 2, 1], [3, 'map3.jpg', 1, 2], [8, 'map8.jpg', 2, 2]],
  trooperEntrances: [{ x: 0, y: 3 }, { x: 0, y: 11 }, { x: 16, y: 0 }, { x: 17, y: 0 }],
  legionEntrances: [{ x: 12, y: 16 }, { x: 20, y: 16 }],
  timeLimitRounds: 9,
  forceCardSectors: [['fc1', 1], ['fc2', 2], ['fc4', 7], ['fc8', 4], ['fc9', 6], ['fc5', 5], ['fc7', 3]],
  placements: [{ typeId: 'ezoghoul', x: 18, y: 19, tag: 'boss' }],
  win: { kind: 'eliminate-tagged', tag: 'boss', label: 'the Ezoghoul' },
  reward: { troopers: 3, legion: 2 }, usesEvents: true,
});

// ===== Mission 10: The Hunt for Alakhai =====
const m10 = build({
  id: 'alakhai', number: 10, name: 'Mission 10: The Hunt for Alakhai',
  briefing: 'The Nepharite Alakhai, Lord of the Citadel, is finally located. Go in and eliminate him.',
  objective: 'Eliminate the Nepharite Alakhai (4 actions per round). Enter and exit only via Sector 1 or 2.',
  sectorDefs: [[4, 'map4.jpg', 1, 0], [5, 'map5.jpg', 2, 0], [6, 'map6.jpg', 0, 1], [1, 'map1.jpg', 1, 1], [3, 'map3.jpg', 2, 1], [8, 'map8.jpg', 1, 2], [7, 'map7.jpg', 2, 2]],
  citadel: { cx: 16, cy: 8 }, // TODO: confirm vs mission diagram
  trooperEntrances: [{ x: 8, y: 0 }, { x: 9, y: 0 }, { x: 18, y: 0 }, { x: 17, y: 0 }],
  legionEntrances: [{ x: 15, y: 3 }, { x: 11, y: 7 }, { x: 19, y: 8 }, { x: 15, y: 12 }], // the Citadel doorway gaps
  timeLimitRounds: 8,
  forceCardSectors: [['fc1', 4], ['fc2', 5], ['fc4', 6], ['fc8', 1], ['fc9', 3], ['fc12', 8], ['fc7', 7]],
  placements: [{ typeId: 'alakhai', x: 12, y: 11, tag: 'boss' }],
  win: { kind: 'eliminate-tagged', tag: 'boss', label: 'the Nepharite Alakhai' },
  reward: { troopers: 2, legion: 2 }, usesEvents: true,
});

export const MISSIONS: Record<string, MissionDef> = {
  trial, eagle: m1, trapped: m2, getboss: m3, easttower: m4, breakback: m5,
  holdfort: m6, portal: m7, tothetop: m8, corridors: m9, alakhai: m10,
};

export const MISSION_LIST = [trial, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10];
export const CAMPAIGN_MISSIONS = [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10];
