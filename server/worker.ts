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

      if (parts[0] === 'games' && parts[1]) {
        const gameId = parts[1];
        const sub = parts[2];

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
