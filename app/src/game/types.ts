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
  actionsLeft: number;
  alive: boolean;
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
}

export interface MissionDef {
  id: string;
  name: string;
  briefing: string;
  objective: string;
  sectors: SectorPlacement[];
  walls: Wall[];
  citadel?: { x: number; y: number; w: number; h: number };
  trooperEntrances: { x: number; y: number }[];
  legionEntrances: { x: number; y: number }[];
  exits?: { x: number; y: number }[];
  timeLimitRounds: number;
  forceCards: ForceCardPlacement[];
  /** which corporations play (each fields 2 troopers) */
  corporations: string[];
  troopersPerCorp: Record<string, string[]>; // corp -> figure typeIds
  win: WinCondition;
}

export type WinCondition =
  | { kind: 'promotion'; points: number }      // troopers must earn N promotion pts
  | { kind: 'eliminate-all' }                  // eliminate all legion figures
  | { kind: 'escape'; count: number }          // N troopers reach an exit
  | { kind: 'survive' };                       // survive the time limit

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
  citadel?: { x: number; y: number; w: number; h: number };
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

  win: WinCondition;
  winners: string[] | null;

  rngState: number;
  log: string[];
  // transient: result of the most recent dice roll, for UI display
  lastRoll?: { dice: number[]; color: DiceColor; hits: number; label: string };
}

// ---- Actions ----
export type Action =
  | { type: 'move'; uid: string; x: number; y: number }       // one step
  | { type: 'attack'; uid: string; targetUid: string; weaponIdx: number }
  | { type: 'pass-figure'; uid: string }                       // end this figure's actions
  | { type: 'end-turn' }                                        // end active seat's turn
  | { type: 'start' };                                          // setup -> play
