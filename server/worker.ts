import { GameServer, verifyIdentityToken, type Jwks } from 'digital-boardgame-framework/server';
import { jsonCodec, RandomAI } from 'digital-boardgame-framework';
import { adapter, createInitialState } from '../app/src/game/adapter';
import type { GameState, Action } from '../app/src/game/types';
import { KVStore } from './kv-store';

export interface Env {
  SIEGE_KV: KVNamespace;
  SITE_ORIGIN?: string; // where the playable client is hosted (for share links)
  RATINGS_INGEST_KEY?: string; // shared secret matching the hub's; enables ranked play
}

const HUB = 'https://games-hub-5vo.pages.dev';
let _jwks: Jwks | undefined;
let _jwksAt = 0;
async function getJwks(): Promise<Jwks> {
  if (!_jwks || Date.now() - _jwksAt > 3_600_000) {
    _jwks = (await (await fetch(`${HUB}/id/jwks`)).json()) as Jwks;
    _jwksAt = Date.now();
  }
  return _jwks;
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

/** A short, human-friendly campaign code (no ambiguous I/L/O/0/1). */
function newCampaignCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

function makeServer(env: Env, origin: string) {
  const site = env.SITE_ORIGIN || origin;
  return new GameServer<GameState, Action, string>({
    snapshotHistory: 20,   // cap per-game snapshot history (framework >=0.32)
    adapter,
    codec: jsonCodec<GameState>(),
    store: new KVStore(env.SIEGE_KV),
    // Server-driven AI seats (rated leaderboard opponent). Identity is
    // ai:siege-of-the-citadel:random; shows as "🤖 AI (random)".
    aiControllers: { random: new RandomAI<GameState, Action, string>() },
    // Best-effort play counter: createGame fires an 'online' beacon to the hub.
    playBeacon: { appId: 'siege-of-the-citadel' },
    gameUrl: (gameId, token) => `${site}/?game=${gameId}&token=${token}`,
    // Ranked play: verify hub identity tokens (claimSeat) + auto-report results.
    verifyIdentity: async (t) => verifyIdentityToken(t, await getJwks()),
    ...(env.RATINGS_INGEST_KEY
      ? { ratings: { game: 'siege-of-the-citadel', ingestKey: env.RATINGS_INGEST_KEY } }
      : {}),
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
        const body = (await req.json()) as {
          missionId: string; corporations?: string[];
          ai?: Record<string, string>;
          // Convenience: 'legion' -> all Doomtrooper corps are AI (human = Legion);
          // 'troopers' -> the Legion is AI (human = the corp seats).
          aiSide?: 'legion' | 'troopers';
        };
        const initialState = createInitialState({ missionId: body.missionId, corporations: body.corporations, seed: (Date.now() % 1e9) | 0 });
        const players = initialState.seats.map((s) => s.id);
        // Resolve the AI seat map. Explicit `ai` wins; otherwise expand `aiSide`
        // to the matching seats. AI seats are server-driven + auto-rated.
        let ai = body.ai;
        if (!ai && body.aiSide) {
          const wantLegion = body.aiSide === 'troopers';
          ai = Object.fromEntries(
            initialState.seats.filter((s) => s.isLegion === wantLegion).map((s) => [s.id, 'random']),
          );
        }
        // invites maps each seat -> a full shareable play URL (gameUrl applied).
        const { gameId, invites } = await server.createGame({
          initialState, players,
          ...(ai ? { ai } : {}),
        });
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

      // Mark a report resolved (public write — routine, reversible triage).
      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'reports' && parts[2] === 'resolve') {
        const id = parts[1];
        const body = (await req.json().catch(() => ({}))) as { note?: string };
        const r = (await env.SIEGE_KV.get(`report:${id}`, 'json')) as any;
        if (!r) return json({ error: 'no such report' }, 404);
        r.resolution = { at: new Date().toISOString(), note: String(body.note ?? '') };
        await env.SIEGE_KV.put(`report:${id}`, JSON.stringify(r));
        return json({ ok: true, reportId: id });
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

      // ---- Campaign cloud-save (cross-device resume) ----
      // A campaign standing is non-PII and reversible: public read/write, the
      // code is the obscurity. POST /campaign creates; POST/GET /campaign/:code
      // save/load.
      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'campaign') {
        const state = await req.json();
        const code = newCampaignCode();
        await env.SIEGE_KV.put(`campaign:${code}`, JSON.stringify({ state, updatedAt: new Date().toISOString() }));
        return json({ code });
      }
      if (parts.length === 2 && parts[0] === 'campaign') {
        const code = parts[1].toUpperCase();
        if (req.method === 'GET') {
          const row = (await env.SIEGE_KV.get(`campaign:${code}`, 'json')) as any;
          if (!row) return json({ error: 'no such campaign' }, 404);
          return json(row);
        }
        if (req.method === 'POST') {
          const exists = await env.SIEGE_KV.get(`campaign:${code}`);
          if (!exists) return json({ error: 'no such campaign' }, 404);
          const state = await req.json();
          await env.SIEGE_KV.put(`campaign:${code}`, JSON.stringify({ state, updatedAt: new Date().toISOString() }));
          return json({ ok: true });
        }
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
          const { action, identityToken } = (await req.json()) as { action: Action; identityToken?: string };
          // Ranked: attribute this seat from the move's identity (idempotent,
          // race-free — turns are sequential). Best-effort; never blocks the move.
          if (typeof identityToken === 'string' && identityToken) {
            try { await server.claimSeat(gameId, token, identityToken); } catch { /* attribution optional */ }
          }
          return json(await server.submit(gameId, token, action));
        }
        // POST /games/:id/claim — attach a hub identity to this seat on join.
        if (req.method === 'POST' && sub === 'claim') {
          const { identityToken } = (await req.json()) as { identityToken?: string };
          if (typeof identityToken !== 'string' || !identityToken) return json({ error: 'identityToken required' }, 422);
          const v = await server.claimSeat(gameId, token, identityToken);
          return json({ ok: true, playerId: v.playerId });
        }
      }

      return json({ error: 'not found' }, 404);
    } catch (e: any) {
      return json({ error: e?.message ?? String(e) }, 400);
    }
  },
};
