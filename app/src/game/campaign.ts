import { CAMPAIGN_MISSIONS } from './missions';
import type { GameState } from './types';

// ---------------------------------------------------------------------------
// Campaign progression. The base game carries a team's Promotion Points,
// Rank and Credits from mission to mission. We persist that here in
// localStorage (the framework's GameServer holds a single game's state, not a
// cross-mission campaign).
// ---------------------------------------------------------------------------

export const CAMPAIGN_CORPS = ['Bauhaus', 'Imperial', 'Capitol'];

export interface CampaignState {
  index: number;                      // next mission index into CAMPAIGN_MISSIONS (0..10)
  promotion: Record<string, number>;  // accumulated promotion points per corp
  credits: Record<string, number>;
  history: { mission: string; winners: string[] }[];
}

const KEY = 'siege-campaign-v1';

/** Promotion-point → Rank table from the rulebook. */
export function rankForPoints(p: number): number {
  if (p >= 100) return 6;
  if (p >= 70) return 5;
  if (p >= 45) return 4;
  if (p >= 25) return 3;
  if (p >= 10) return 2;
  return 1;
}

export function newCampaign(): CampaignState {
  return {
    index: 0,
    promotion: Object.fromEntries(CAMPAIGN_CORPS.map((c) => [c, 0])),
    credits: Object.fromEntries(CAMPAIGN_CORPS.map((c) => [c, 2])), // start with 2 credits
    history: [],
  };
}

export function loadCampaign(): CampaignState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CampaignState) : null;
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

export function currentMission(c: CampaignState) {
  return CAMPAIGN_MISSIONS[Math.min(c.index, CAMPAIGN_MISSIONS.length - 1)];
}

export function isComplete(c: CampaignState): boolean {
  return c.index >= CAMPAIGN_MISSIONS.length;
}

/** Fold a finished game's result into the campaign and advance to the next mission. */
export function recordResult(c: CampaignState, finished: GameState): CampaignState {
  const mission = CAMPAIGN_MISSIONS[c.index];
  if (!mission || finished.phase !== 'over') return c;
  const promotion = { ...c.promotion };
  const credits = { ...c.credits };
  for (const corp of CAMPAIGN_CORPS) {
    promotion[corp] = (promotion[corp] ?? 0) + (finished.promotion[corp] ?? 0);
    credits[corp] = finished.credits[corp] ?? credits[corp] ?? 0; // gameState already added rewards
  }
  return {
    index: c.index + 1,
    promotion,
    credits,
    history: [...c.history, { mission: mission.id, winners: finished.winners ?? [] }],
  };
}
