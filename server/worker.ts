import { GameServer } from 'digital-boardgame-framework/server';
import { jsonCodec } from 'digital-boardgame-framework';
import { adapter, createInitialState } from '../app/src/game/adapter';
import type { GameState, Action } from '../app/src/game/types';
import { KVStore } from './kv-store';

export interface Env {
  SIEGE_KV: KVNamespace;
  SITE_ORIGIN?: string; // where the playable client is hosted (for share links)
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function makeServer(env: Env, origin: string) {
  const site = env.SITE_ORIGIN || origin;
  return new GameServer<GameState, Action, string>({
    adapter,
    codec: jsonCodec<GameState>(),
    store: new KVStore(env.SIEGE_KV),
    // Best-effort play counter: createGame fires an 'online' beacon to the hub.
    playBeacon: { appId: 'siege-of-the-citadel' },
    gameUrl: (gameId, token) => `${site}/?game=${gameId}&token=${token}`,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean); // e.g. ['games', ':id', 'move']
    const token = url.searchParams.get('token') ?? '';
    const server = makeServer(env, url.origin);

    try {
      // POST /games  -> create a new game
      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'games') {
        const body = (await req.json()) as { missionId: string; corporations?: string[] };
        const initialState = createInitialState({ missionId: body.missionId, corporations: body.corporations, seed: (Date.now() % 1e9) | 0 });
        const players = initialState.seats.map((s) => s.id);
        // invites maps each seat -> a full shareable play URL (gameUrl applied)
        const { gameId, invites } = await server.createGame({ initialState, players });
        return json({ gameId, invites });
      }

      // Standalone bug report (works for local games — no game/token needed).
      // Public write: a report is reversible and low-risk; the URL is the
      // obscurity. Stored for agent-friendly triage.
      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'report') {
        const body = (await req.json()) as Record<string, unknown>;
        const reportId = 'r_' + (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2));
        const row = {
          reportId,
          createdAt: new Date().toISOString(),
          message: String(body.message ?? '').slice(0, 4000),
          severity: String(body.severity ?? 'bug'),
          missionId: body.missionId ?? null,
          mode: body.mode ?? 'local',
          gameId: body.gameId ?? null,
          clientBuild: body.clientBuild ?? null,
          userAgent: body.userAgent ?? null,
          log: Array.isArray(body.log) ? (body.log as unknown[]).slice(-400) : [],
          state: body.state ?? null,
        };
        await env.SIEGE_KV.put(`report:${reportId}`, JSON.stringify(row));
        return json({ reportId });
      }

      // Public-read triage list (no PII — game state + the reporter's own words).
      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'reports') {
        const list = await env.SIEGE_KV.list({ prefix: 'report:' });
        const rows: unknown[] = [];
        for (const k of list.keys.slice(0, 200)) {
          const r = await env.SIEGE_KV.get(k.name, 'json');
          if (r) rows.push(r);
        }
        rows.sort((a: any, b: any) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        return json({ count: rows.length, reports: rows });
      }

      if (parts[0] === 'games' && parts[1]) {
        const gameId = parts[1];
        const sub = parts[2];

        if (req.method === 'POST' && sub === 'report') {
          const body = (await req.json()) as any;
          return json(await server.report(gameId, token, body));
        }

        if (req.method === 'GET' && !sub) {
          return json(await server.fetch(gameId, token));
        }
        if (req.method === 'GET' && sub === 'legal') {
          return json(await server.legalActions(gameId, token));
        }
        if (req.method === 'GET' && sub === 'history') {
          return json(await server.history(gameId, token));
        }
        if (req.method === 'POST' && sub === 'move') {
          const { action } = (await req.json()) as { action: Action };
          return json(await server.submit(gameId, token, action));
        }
      }

      return json({ error: 'not found' }, 404);
    } catch (e: any) {
      return json({ error: e?.message ?? String(e) }, 400);
    }
  },
};
