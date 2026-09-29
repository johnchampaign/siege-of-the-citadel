import {
  D1Store,
  type D1DatabaseLike, type BugReportRow, type ReportFilter,
} from 'digital-boardgame-framework/server';

// Games, snapshots and chat live in D1; bug reports stay in KV.
//
// Why D1: the free plan allows 1,000 KV writes a day per ACCOUNT (shared with
// every other game on it) and every move is a write. On 2026-09-29 one ordinary
// 8-round game — 439 moves, a player vs the AI — used 871 of them. D1's free
// plan is 100,000 rows written a day; a move costs ~2 (insert + history prune).
// The old KV game keys (meta:/snap:) were copied into D1 by
// migrate-kv-to-d1.mjs and left in KV untouched as a backup.
//
// Why reports stay in KV: they're rare writes, the standalone /report route and
// the /reports triage listing (read by the daily triage routine) already use
// KV directly, and game reports must show up in that same listing.
export class SiegeStore extends D1Store {
  constructor(db: D1DatabaseLike, private kv: KVNamespace) {
    super(db);
  }

  async putReport(row: BugReportRow): Promise<void> {
    await this.kv.put(`report:${row.reportId}`, JSON.stringify(row));
  }

  async listReports(filter?: ReportFilter): Promise<BugReportRow[]> {
    const list = await this.kv.list({ prefix: 'report:' });
    const out: BugReportRow[] = [];
    for (const k of list.keys) {
      const r = (await this.kv.get(k.name, 'json')) as BugReportRow | null;
      if (!r) continue;
      if (filter?.gameId && r.gameId !== filter.gameId) continue;
      if (filter?.unresolved && r.resolution) continue;
      out.push(r);
    }
    return out;
  }

  async resolveReport(reportId: string, resolution: string): Promise<void> {
    const r = (await this.kv.get(`report:${reportId}`, 'json')) as BugReportRow | null;
    if (r) {
      r.resolution = { at: new Date().toISOString(), note: resolution };
      await this.kv.put(`report:${reportId}`, JSON.stringify(r));
    }
  }
}
