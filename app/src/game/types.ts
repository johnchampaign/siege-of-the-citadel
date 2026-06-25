// Core types for Siege of the Citadel.
// The board is a set of sectors, each an 8x8 grid of squares, laid out on a
// global coordinate plane. Walls live on the edges between adjacent squares.

export type DiceColor = 'white' | 'red' | 'black';

/** Probability a single die of each color scores a hit (out of 6).
 *  From the VASSAL module: white 2/6, red 3/6, black 4/6. */
export const HIT_THRESHOLD: Record<DiceColor, number> = { white: 2, red: 3, black: 4 };

export interface Weapon {
  name: string;
  kind: 'close' | 'firearm';
  dice: number;
  color: DiceColor;
  range: number; // squares; close = 1 (adjacent), firearms typically 24
  /** Area pattern (single-click target derives the affected set):
   *  'blast' — target + 8 adjacent (adjacent take one hit less)
   *  'line'  — every figure on the line from attacker through the target
   *  'swing' — every figure adjacent to the attacker
   *  'double'— target + nearest other enemy in sight (dice split) */
  area?: 'blast' | 'line' | 'swing' | 'double';
}

export type Side = 'legion' | string; // corporation ids or 'legion'

export interface FigureType {
  id: string;
  name: string;
  faction: string;            // 'Bauhaus' | ... | 'Dark Legion'
  token: string;              // image filename under /tokens
  isTrooper: boolean;
  armor: number;              // Armor Factor
  strength: number;           // hit points (creatures effectively 1)
  actions: number;            // actions per turn
  weapons: Weapon[];
  promotion: number;          // promotion points awarded for killing it (creatures)
  kevlariteDice?: number;     // troopers: # white save dice rolled per incoming attack
}

export interface Figure {
  uid: string;                // unique instance id
  typeId: string;
  owner: Side;                // which player controls it
  x: number;                  // global square coords
  y: number;
  woundsTaken: number;        // strength lost
  actionsLeft: number;        // base actions remaining this turn
  actionsTaken: number;       // total actions performed this turn (cap 4 for troopers)
  alive: boolean;
  tag?: string;               // objective marker (e.g. 'boss', 'door')
  equipment?: string[];       // equipment card ids carried (troopers)
}

/** A sector placed on the board. Local squares are 0..size-1. */
export interface SectorPlacement {
  id: number;                 // sector number (1..9) or 0 for citadel/empty
  mapImage: string;           // e.g. 'map1.jpg'
  ox: number;                 // global x of local (0,0)
  oy: number;                 // global y of local (0,0)
  size: number;               // grid size (8)
  rotated?: boolean;
}

export interface ForceCardDef {
  id: string;
  name: string;
  /** creature typeIds spawned when revealed */
  spawn: string[];
}

export interface ForceCardPlacement {
  cardId: string;
  sectorId: number;
  revealed: boolean;
}

export interface Wall {
  // wall blocks movement/LOS between square (x,y) and its neighbor in `dir`
  x: number;
  y: number;
  dir: 'N' | 'E' | 'S' | 'W';
  citadel?: boolean; // part of the Citadel crosshair (rendered as the piece, not a tile wall)
}

export interface MissionDef {
  id: string;
  name: string;
  briefing: string;
  objective: string;
  sectors: SectorPlacement[];
  walls: Wall[];
  citadel?: { cx: number; cy: number }; // center vertex (grid-line corner where sectors meet); 16x16 crosshair
  trooperEntrances: { x: number; y: number }[];
  legionEntrances: { x: number; y: number }[];
  exits?: { x: number; y: number }[];
  timeLimitRounds: number;
  forceCards: ForceCardPlacement[];
  placements?: Placement[];   // pre-placed objective figures
  /** which corporations play (each fields 2 troopers) */
  corporations: string[];
  troopersPerCorp: Record<string, string[]>; // corp -> figure typeIds
  win: WinCondition;
  reward?: { troopers: number; legion: number }; // credits awarded on win
  usesEvents?: boolean;       // Dark Legion draws an event each round
  number?: number;            // campaign sequence number (1..10), undefined for training
}

export type WinCondition =
  | { kind: 'promotion'; points: number; escape?: boolean } // earn N pts (+optionally escape)
  | { kind: 'eliminate-all' }                  // eliminate all legion figures
  | { kind: 'escape'; count: number }          // N troopers reach an exit
  | { kind: 'eliminate-tagged'; tag: string; label: string } // kill all figures w/ tag (boss/doors)
  | { kind: 'survive' };                       // hold out: troopers win at the time limit

/** A pre-placed figure (objective boss, teleporter doorway, starting Ezoghoul). */
export interface Placement {
  typeId: string;
  x: number;
  y: number;
  tag?: string;
}

export type Phase = 'setup' | 'play' | 'over';

export interface PlayerSeat {
  id: string;                 // 'legion' | corp id
  name: string;
  isLegion: boolean;
}

export interface GameState {
  schema: number;
  missionId: string;
  phase: Phase;
  seats: PlayerSeat[];
  figures: Figure[];
  sectors: SectorPlacement[];
  walls: Wall[];
  citadel?: { cx: number; cy: number }; // center vertex (grid-line corner where sectors meet); 16x16 crosshair
  exits: { x: number; y: number }[];
  forceCards: ForceCardPlacement[];
  legionEntrances: { x: number; y: number }[];

  round: number;
  timeLimitRounds: number;

  // turn-order: each round, seats are shuffled into a draw order; markers are
  // revealed one at a time. activeSeat takes a full turn (all its figures).
  drawOrder: string[];        // remaining seat ids to reveal this round
  activeSeat: string | null;

  promotion: Record<string, number>; // corp id -> promotion points
  legionKills: number;        // troopers eliminated by legion
  escaped: number;            // troopers escaped (for escape missions)

  // campaign carry-in: starting rank/credits per corp (set by the campaign layer)
  rank: Record<string, number>;       // corp id -> rank (1..6)
  credits: Record<string, number>;    // corp id -> credits

  // shared per-round Extra Action pool per corporation, size from Rank
  extraPool: Record<string, number>;

  // Doomtrooper Cards: each corp's hand of one-shot cards
  doomHands: Record<string, string[]>;
  // Secondary Mission Cards: secret per-corp objective (when 2+ corp teams)
  secondary: Record<string, string>;
  secondaryDone: Record<string, boolean>;
  // transient combat tallies used by some secondary objectives
  firearmKills: Record<string, number>;

  // cards
  usesEvents: boolean;
  eventDeck: string[];        // remaining Dark Legion event card ids
  pendingEvent: string | null; // event drawn this round, awaiting Legion resolution
  setupDone: boolean;         // equipment selection finished

  win: WinCondition;
  winners: string[] | null;

  rngState: number;
  log: string[];
  // transient: result of the most recent dice roll, for UI display
  lastRoll?: {
    dice: number[];
    color: DiceColor;
    hits: number;
    label: string;
    // structured detail for the result modal (single-target attacks)
    attackerOwner?: string;
    attackerName?: string;
    targetName?: string;
    weapon?: string;
    armor?: number;
    saves?: number;
    damage?: number;
    killed?: boolean;
    area?: string;
  };
}

// ---- Actions ----
export type Action =
  | { type: 'move'; uid: string; x: number; y: number }       // one step
  | { type: 'attack'; uid: string; targetUid: string; weaponIdx: number }
  | { type: 'pass-figure'; uid: string }                       // end this figure's actions
  | { type: 'end-turn' }                                        // end active seat's turn
  | { type: 'equip'; corp: string; trooperUid: string; cardId: string } // setup: assign equipment
  | { type: 'finish-setup' }                                    // setup: lock in equipment
  | { type: 'resolve-event' }                                   // Legion acknowledges the round's event
  | { type: 'play-doom-card'; corp: string; cardId: string; targetUid?: string } // play a Doomtrooper Card
  | { type: 'start' };                                          // setup -> play
