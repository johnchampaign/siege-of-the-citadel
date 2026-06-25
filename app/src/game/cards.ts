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
// The 13 Doomtrooper Cards from the 1993 game. Each printed card carries TWO
// powers; `blurb` keeps both (faithful shorthand), and `effect` implements the
// beneficial one that maps to this digital, solo-friendly engine. Powers that
// only make sense with multiple human players or need systems we don't model
// (teleport, mind-control, door placement, opponent sabotage) are tagged
// 'flavor' — the card still plays and logs its full text, but applies no
// automatic mechanic.
export type DoomEffect =
  | 'extra-actions'   // +2 to your Extra Action pool (Combat Frenzy / Movement Boost)
  | 'heal'            // heal 2 wounds on a chosen Doomtrooper (Medicine Injector / Medic)
  | 'shield'          // the Dark Legion may not attack your Doomtroopers this round
  | 'armor-down'      // a chosen Legion figure's Armor is lowered by 1 this round (Weak Spot)
  | 'attack-legion'   // strike a chosen Legion figure with 3 black dice (Control Defense System)
  | 'flavor';         // narrative / manual-resolve power, no automatic effect

export interface DoomCardDef {
  id: string;
  name: string;
  blurb: string;
  effect: DoomEffect;
  needsTarget?: 'trooper' | 'legion';
}

export const DOOM_CARDS: Record<string, DoomCardDef> = {
  ci_hl:   { id: 'ci_hl',   name: 'Command Interference / Hurt Leg', effect: 'flavor',
    blurb: 'Command Interference: move a Force Card of your choice to an adjacent sector (don\'t look at it; reveal it if that sector holds Doomtroopers). / Hurt Leg: a chosen Doomtrooper moves one square less per Round for the rest of the mission.' },
  cv_si:   { id: 'cv_si',   name: 'Commanding Voice / Steal Initiative', effect: 'flavor',
    blurb: 'Commanding Voice: take command of a Legion figure and perform two Actions with it, then control reverts. / Steal Initiative: take a random Doomtrooper Card from any player.' },
  cf_cr:   { id: 'cf_cr',   name: 'Combat Frenzy / Combat Report', effect: 'extra-actions',
    blurb: 'Combat Frenzy: spend two free extra Actions on your pair this Combat Round. / Combat Report: take 5 Promotion Points from another player.' },
  ca_lf:   { id: 'ca_lf',   name: 'Combat Aura / Legionnaire Fear', effect: 'shield',
    blurb: 'Combat Aura: a force field demoralises the Legion — it may not attack your Doomtroopers this Round. / Legionnaire Fear: a chosen pair may not attack Legionnaires in close combat for the rest of the mission.' },
  cds_rcd: { id: 'cds_rcd', name: 'Control Defense System / Remote Controlled Door', effect: 'attack-legion', needsTarget: 'legion',
    blurb: 'Control Defense System: seize a defense turret — attack one chosen Legion figure with three black dice. / Remote Controlled Door: place a door across a corridor up to two squares wide.' },
  hl_nf:   { id: 'hl_nf',   name: 'Heroic Luck / Necrofear', effect: 'flavor',
    blurb: 'Heroic Luck: re-roll one die in each of your remaining attacks this Combat Round. / Necrofear: a chosen pair may not attack Necromutants in close combat for the rest of the mission.' },
  lt_dr:   { id: 'lt_dr',   name: 'Limited Teleportation / Dud Round', effect: 'flavor',
    blurb: 'Limited Teleportation: teleport one of your Doomtroopers to an adjacent sector. / Dud Round: played after a successful firearm attack on a chosen pair — that attack failed (faulty ammo).' },
  mi_cn:   { id: 'mi_cn',   name: 'Medicine Injector / Combat Neurosis', effect: 'heal', needsTarget: 'trooper',
    blurb: 'Medicine Injector: an auto-injector reduces one of your Doomtroopers\' wounds by 2. / Combat Neurosis: a chosen pair may perform only one Action each this Round (no extra Actions).' },
  m_ut:    { id: 'm_ut',    name: 'Medic / Uncalibrated Targeter', effect: 'heal', needsTarget: 'trooper',
    blurb: 'Medic: a Combat Medic Unit heals 2 wounds on one of your Doomtroopers. / Uncalibrated Targeter: a chosen Doomtrooper fires with dice two Ranks lower for the rest of the mission.' },
  mp_ce:   { id: 'mp_ce',   name: 'Molecular Phasing / Coordinating Error', effect: 'flavor',
    blurb: 'Molecular Phasing: your Doomtroopers may move through walls this Combat Round (not between stair levels). / Coordinating Error: a chosen pair immediately loses 2 extra Actions.' },
  mb_ft:   { id: 'mb_ft',   name: 'Movement Boost / Faulty Teleportation', effect: 'extra-actions',
    blurb: 'Movement Boost: an energy injector gives your Doomtroopers a free movement action each, immediately. / Faulty Teleportation: a chosen Doomtrooper is teleported to a sector of your choice.' },
  sd_fo:   { id: 'sd_fo',   name: 'Spectral Displacement / False Orders', effect: 'shield',
    blurb: 'Spectral Displacement: your armor hides your Doomtroopers from sight — no attacks may be made against them this Combat Round. / False Orders: immediately perform two movement Actions with another player\'s pair.' },
  ws_li:   { id: 'ws_li',   name: 'Weak Spot / Lost Initiative', effect: 'armor-down', needsTarget: 'legion',
    blurb: 'Weak Spot: expose a flaw in a chosen Legion figure\'s armor — its Armor is lowered by 1 when your Doomtroopers attack this Round. / Lost Initiative: discard a random Doomtrooper Card from a chosen player.' },
};

// The 13-card Doomtrooper deck (one of each, as in the 1993 box).
const DOOM_DECK = ['ci_hl', 'cv_si', 'cf_cr', 'ca_lf', 'cds_rcd', 'hl_nf', 'lt_dr', 'mi_cn', 'm_ut', 'mp_ce', 'mb_ft', 'sd_fo', 'ws_li'];

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
// The 12-card Dark Legion Event deck from the 1993 game. Each card both deploys
// reinforcements and applies a round effect. `effect` implements the mechanic;
// `boost` lists creature typeIds that gain +1 Action this round.
export type EventEffect =
  | 'spawn-only'      // reinforcements only
  | 'boost'           // listed creatures get +1 Action this round
  | 'no-firearm'      // Doomtroopers may not make firearm attacks this round (Mental Block)
  | 'no-melee'        // Doomtroopers may not make close-combat attacks this round (Close Combat Phobia)
  | 'direct-damage'   // strike a Doomtrooper with 3 black dice (Temporary Defense)
  | 'flavor';         // narrative power not auto-modelled (re-rolls, teleport, action-throttle)

export interface EventDef {
  id: string;
  name: string;
  blurb: string;
  spawn?: string[];            // creatures to deploy at a Legion entrance
  effect: EventEffect;
  boost?: string[];            // creature typeIds that gain +1 action this round
  anyEntrance?: boolean;       // reinforcements may use any entrance (flavor)
}

export const EVENTS: Record<string, EventDef> = {
  charge:        { id: 'charge', name: "The Legionnaires' Charge", effect: 'spawn-only', anyEntrance: true,
    blurb: 'A massed charge — reinforcements may enter through any entrance. Reinforcements: 1 Centurion, 1 Necromutant, 8 Legionnaires.', spawn: ['centurion', 'necromutant', 'legionnaire', 'legionnaire', 'legionnaire', 'legionnaire', 'legionnaire', 'legionnaire', 'legionnaire', 'legionnaire'] },
  ccfrenzy:      { id: 'ccfrenzy', name: 'Close Combat Frenzy', effect: 'flavor',
    blurb: 'All Legion figures re-roll one die when attacking in close combat this round. Reinforcements: 1 Centurion, 1 Necromutant, 1 Legionnaire.', spawn: ['centurion', 'necromutant', 'legionnaire'] },
  ccphobia:      { id: 'ccphobia', name: 'Close Combat Phobia', effect: 'no-melee',
    blurb: 'A phobia grips the Doomtroopers — they may not attack in close combat this round. Reinforcements: 1 Centurion, 1 Necromutant.', spawn: ['centurion', 'necromutant'] },
  darkwave:      { id: 'darkwave', name: 'Dark Energy Wave', effect: 'flavor',
    blurb: 'All Legion figures re-roll one attack die in every attack this Combat Round. Reinforcements: 1 Necromutant, 2 Legionnaires.', spawn: ['necromutant', 'legionnaire', 'legionnaire'] },
  darkinfluence: { id: 'darkinfluence', name: 'Dark Influence', effect: 'boost', boost: ['legionnaire', 'necromutant', 'centurion', 'razide', 'nepharite', 'ezoghoul', 'alakhai'],
    blurb: 'The Legion senses the Dark Symmetry — the Legion surges with extra Actions this round. Reinforcements: 2 Legionnaires.', spawn: ['legionnaire', 'legionnaire'] },
  darktele:      { id: 'darktele', name: 'Dark Teleportation', effect: 'flavor',
    blurb: 'This Combat Round the Legion may move one figure to any square on the board instead of a normal move. Reinforcements: 1 Razide.', spawn: ['razide'] },
  mentalblock:   { id: 'mentalblock', name: 'Mental Block', effect: 'no-firearm',
    blurb: 'The Lord of the Citadel blocks the Doomtroopers — none may attack with firearms this round. Reinforcements: 2 Centurions.', spawn: ['centurion', 'centurion'] },
  misorders:     { id: 'misorders', name: 'Misinterpreted Orders', effect: 'flavor',
    blurb: 'A chosen Doomtrooper pair may use only two Actions between them this round. Reinforcements: 3 Legionnaires.', spawn: ['legionnaire', 'legionnaire', 'legionnaire'] },
  necrofrenzy:   { id: 'necrofrenzy', name: 'Necrofrenzy', effect: 'boost', boost: ['necromutant', 'centurion'],
    blurb: 'A wave of Necroenergy — all Necromutants and Centurions gain one extra Action this round. Reinforcements: 2 Necromutants, 1 Legionnaire.', spawn: ['necromutant', 'necromutant', 'legionnaire'] },
  timerift:      { id: 'timerift', name: 'Nepharite Timerift', effect: 'boost', boost: ['nepharite', 'alakhai'],
    blurb: 'A Nepharite bends time — a Nepharite gains an extra move this Combat Round. Reinforcements: 1 Nepharite, 1 Legionnaire, 1 Necromutant.', spawn: ['nepharite', 'legionnaire', 'necromutant'] },
  tempdefense:   { id: 'tempdefense', name: 'Temporary Defense System', effect: 'direct-damage',
    blurb: 'A defense system activates — strike any one Doomtrooper with three black dice. Reinforcements: 1 Necromutant, 1 Razide.', spawn: ['necromutant', 'razide'] },
};

export function buildEventDeck(): string[] {
  // 12-card deck — every Event card once, with Necrofrenzy appearing twice (as in the box).
  return [
    'charge', 'ccfrenzy', 'ccphobia', 'darkwave', 'darkinfluence', 'darktele',
    'mentalblock', 'misorders', 'necrofrenzy', 'necrofrenzy', 'timerift', 'tempdefense',
  ];
}
