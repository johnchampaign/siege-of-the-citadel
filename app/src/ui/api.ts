import { submitReportViaHttp } from 'digital-boardgame-framework/client';
import type { GameClientApi } from 'digital-boardgame-framework/client';
import type { GameState, Action } from '../game/types';

// Base URL of the deployed API Worker. Override at build time with VITE_API_URL.
export const API_BASE =
  (import.meta as any).env?.VITE_API_URL ||
  'https://siege-of-the-citadel-api.johnchampaign.workers.dev';

export interface OnlineParams { gameId: string; token: string; }

/** Read ?game=&token= from the current URL (the shareable invite link). */
export function readOnlineParams(): OnlineParams | null {
  const p = new URLSearchParams(location.search);
  const gameId = p.get('game');
  const token = p.get('token');
  return gameId && token ? { gameId, token } : null;
}

export async function createOnlineGame(missionId: string, corporations?: string[]): Promise<{ gameId: string; invites: Record<string, string> }> {
  const res = await fetch(`${API_BASE}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ missionId, corporations }),
  });
  if (!res.ok) throw new Error(`create failed: ${res.status}`);
  return res.json();
}

/** A GameClientApi (the framework's useGame contract) backed by the Worker. */
export function httpClient(gameId: string, token: string): GameClientApi<GameState, Action> {
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
        body: JSON.stringify({ action }),
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
