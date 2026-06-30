import { submitReportViaHttp } from 'digital-boardgame-framework/client';
import type { GameClientApi } from 'digital-boardgame-framework/client';
import type { GameState, Action } from '../game/types';

// Base URL of the deployed API Worker. Override at build time with VITE_API_URL.
export const API_BASE =
  (import.meta as any).env?.VITE_API_URL ||
  'https://siege-of-the-citadel-api.johnchampaign.workers.dev';

/** This game's slug on the shared games hub (play counter). */
export const HUB_SLUG = 'siege-of-the-citadel';
const HUB_BASE = 'https://games-hub-5vo.pages.dev';

/** Best-effort read of the games-played counter; null if unavailable. */
export async function fetchPlayCount(): Promise<number | null> {
  try {
    const r = await fetch(`${HUB_BASE}/stats?game=${HUB_SLUG}`);
    if (!r.ok) return null;
    const data = await r.json();
    return typeof data?.count === 'number' ? data.count : null;
  } catch {
    return null;
  }
}

export interface OnlineParams { gameId: string; token: string; }

/** Read ?game=&token= from the current URL (the shareable invite link). */
export function readOnlineParams(): OnlineParams | null {
  const p = new URLSearchParams(location.search);
  const gameId = p.get('game');
  const token = p.get('token');
  return gameId && token ? { gameId, token } : null;
}

export async function createOnlineGame(
  missionId: string,
  corporations?: string[],
  aiSide?: 'legion' | 'troopers',
): Promise<{ gameId: string; invites: Record<string, string> }> {
  const res = await fetch(`${API_BASE}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ missionId, corporations, aiSide }),
  });
  if (!res.ok) throw new Error(`create failed: ${res.status}`);
  return res.json();
}

// ---- Campaign cloud-save (cross-device resume) ----

/** Create a cloud campaign; returns the short code the player re-enters elsewhere. */
export async function createCloudCampaign(state: unknown): Promise<string> {
  const res = await fetch(`${API_BASE}/campaign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`cloud save failed: ${res.status}`);
  const data = await res.json();
  if (!data?.code) throw new Error('cloud save rejected: no code');
  return data.code as string;
}

/** Overwrite the cloud campaign under `code` with the latest standing. */
export async function saveCloudCampaign(code: string, state: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}/campaign/${encodeURIComponent(code)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`cloud sync failed: ${res.status}`);
}

/** Load a cloud campaign by code; null if the code is unknown. */
export async function loadCloudCampaign(code: string): Promise<any | null> {
  const res = await fetch(`${API_BASE}/campaign/${encodeURIComponent(code)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`cloud load failed: ${res.status}`);
  const data = await res.json();
  return data?.state ?? null;
}

export type Severity = 'bug' | 'rules-question' | 'feedback';

export interface ReportPayload {
  message: string;
  severity: Severity;
  missionId?: string;
  mode: 'local' | 'online';
  gameId?: string;
  state?: unknown;     // full game state snapshot (the "uploaded log")
  log?: string[];      // human-readable battle log lines
}

const BUILD = (import.meta as any).env?.VITE_BUILD || 'dev';

/** Submit a bug report + game-state log to the Worker. Throws on failure and
 *  resolves only with a server-issued reportId (never silently drops). */
export async function submitReport(p: ReportPayload): Promise<{ reportId: string }> {
  const res = await fetch(`${API_BASE}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...p, clientBuild: BUILD, userAgent: navigator.userAgent }),
  });
  if (!res.ok) throw new Error(`report failed: ${res.status}`);
  const data = await res.json();
  if (!data?.reportId) throw new Error('report rejected: no reportId');
  return data;
}

/** Save a JSON log/state file locally so the player keeps a copy. */
export function downloadLog(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Attach the player's hub identity to their seat (ranked). Best-effort. */
export async function claimSeat(gameId: string, token: string, identityToken: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/games/${gameId}/claim?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken }),
    });
  } catch { /* ranked attribution is optional */ }
}

/** A GameClientApi (the framework's useGame contract) backed by the Worker.
 *  getIdentityToken lets each move carry the player's identity so the server
 *  re-attributes the seat every turn (robust + race-free). */
export function httpClient(
  gameId: string, token: string, getIdentityToken?: () => string | undefined,
): GameClientApi<GameState, Action> {
  const q = `token=${encodeURIComponent(token)}`;
  return {
    async fetch() {
      const r = await fetch(`${API_BASE}/games/${gameId}?${q}`);
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      return r.json();
    },
    async submit(action: Action) {
      const r = await fetch(`${API_BASE}/games/${gameId}/move?${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, identityToken: getIdentityToken?.() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `move ${r.status}`);
      return r.json();
    },
    async legalActions() {
      const r = await fetch(`${API_BASE}/games/${gameId}/legal?${q}`);
      if (!r.ok) throw new Error(`legal ${r.status}`);
      return r.json();
    },
    report(submission) {
      return submitReportViaHttp(`${API_BASE}/games/${gameId}/report?${q}`, submission as any);
    },
  };
}
