import { CAMPAIGN_MISSIONS } from './missions';
import type { GameState } from './types';

// ---------------------------------------------------------------------------
// Campaign progression — faithful to the 1993 Rules Book.
//
// RAW: a campaign is a POINTS RACE, not a fixed 1->10 march. "The Primary
// Missions are numbered one through ten and progress in difficulty. You can
// play the missions in sequence or select them at random." After each mission
// you "select another mission". In a long campaign "the first player to reach
// a set number of Points is declared the winner" (130 Promotion Points is the
// highest Rank possible). Rank, Promotion Points and Credits carry over from
// mission to mission, so an earlier mission may be REPLAYED with the team's
// accumulated standing to grind more points/credits.
//
// Persisted in localStorage so a player returning to the page resumes their
// campaign standing automatically.
// ---------------------------------------------------------------------------

export const CAMPAIGN_CORPS = ['Bauhaus', 'Imperial', 'Capitol'];

/** RAW: 130 Promotion Points is the highest Rank possible — the long-campaign goal. */
export const DEFAULT_TARGET = 130;

export interface CampaignState {
  promotion: Record<string, number>;  // accumulated promotion points per corp
  credits: Record<string, number>;
  target: number;                      // PP that wins a long campaign
  completed: Record<string, boolean>;  // missionId -> accomplished at least once
  history: { mission: string; winners: string[] }[];
  champion?: string | null;            // corp that first reached the target (campaign won)
  cloudCode?: string;                  // short code for cross-device cloud sync (if enabled)
}

const KEY = 'siege-campaign-v1';

/** Promotion-point → Rank table from the 1993 rulebook (p.5). */
export function rankForPoints(p: number): number {
  if (p >= 100) return 6;
  if (p >= 70) return 5;
  if (p >= 45) return 4;
  if (p >= 25) return 3;
  if (p >= 10) return 2;
  return 1;
}

export function newCampaign(target = DEFAULT_TARGET): CampaignState {
  return {
    promotion: Object.fromEntries(CAMPAIGN_CORPS.map((c) => [c, 0])),
    credits: Object.fromEntries(CAMPAIGN_CORPS.map((c) => [c, 2])), // RAW: start with 2 Credits
    target,
    completed: {},
    history: [],
    champion: null,
  };
}

export function loadCampaign(): CampaignState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CampaignState & { index?: number };
    // Migrate the older linear shape (had `index`, no target/completed/champion).
    if (c.target == null) c.target = DEFAULT_TARGET;
    if (!c.completed) {
      c.completed = {};
      for (const h of c.history ?? []) {
        if ((h.winners ?? []).some((w) => w !== 'legion')) c.completed[h.mission] = true;
      }
    }
    if (c.champion === undefined) c.champion = null;
    delete c.index;
    return c;
  } catch {
    return null;
  }
}

export function saveCampaign(c: CampaignState) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export function clearCampaign() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function ranks(c: CampaignState): Record<string, number> {
  return Object.fromEntries(CAMPAIGN_CORPS.map((corp) => [corp, rankForPoints(c.promotion[corp] ?? 0)]));
}

/** The points leader (tie broken by Credits, then name) — the mini-campaign winner. */
export function leader(c: CampaignState): string {
  return [...CAMPAIGN_CORPS].sort(
    (a, b) => (c.promotion[b] ?? 0) - (c.promotion[a] ?? 0) || (c.credits[b] ?? 0) - (c.credits[a] ?? 0) || a.localeCompare(b),
  )[0];
}

/** Lowest-numbered mission not yet accomplished — the suggested "next" in the
 *  narrative sequence. Null once every mission has been completed. */
export function suggestedMission(c: CampaignState) {
  return CAMPAIGN_MISSIONS.find((m) => !c.completed[m.id]) ?? null;
}

export function allMissionsDone(c: CampaignState): boolean {
  return CAMPAIGN_MISSIONS.every((m) => c.completed[m.id]);
}

/** Has the campaign been won (a corp reached the points target)? */
export function campaignWon(c: CampaignState): boolean {
  return !!c.champion;
}

/** Fold a finished mission's result into the campaign standing. The mission may
 *  be any mission (free selection / replay) — there is no fixed running index. */
export function recordResult(c: CampaignState, finished: GameState): CampaignState {
  if (finished.phase !== 'over') return c;
  const missionId = finished.missionId;
  const promotion = { ...c.promotion };
  const credits = { ...c.credits };
  for (const corp of CAMPAIGN_CORPS) {
    promotion[corp] = (promotion[corp] ?? 0) + (finished.promotion[corp] ?? 0); // PP earned this mission
    credits[corp] = finished.credits[corp] ?? credits[corp] ?? 0;               // carried in, already adjusted
  }
  const troopersWon = (finished.winners ?? []).some((w) => w !== 'legion');
  const completed = { ...c.completed, [missionId]: c.completed[missionId] || troopersWon };
  // Champion: the first corp to reach the target (locked in once declared).
  let champion = c.champion ?? null;
  if (!champion) {
    for (const corp of CAMPAIGN_CORPS) if ((promotion[corp] ?? 0) >= c.target) { champion = corp; break; }
  }
  return {
    ...c,
    promotion,
    credits,
    completed,
    champion,
    history: [...c.history, { mission: missionId, winners: finished.winners ?? [] }],
  };
}
