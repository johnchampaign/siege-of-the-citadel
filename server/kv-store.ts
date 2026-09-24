import type {
  SnapshotStore, GameMeta, SnapshotRow, ChatMessage, BugReportRow, ReportFilter,
} from 'digital-boardgame-framework/server';

// A Cloudflare KV-backed SnapshotStore for the framework's GameServer.
// Keys:
//   meta:<gameId>            -> GameMeta
//   snap:<gameId>:latest     -> SnapshotRow (current turn)
//   snap:<gameId>:t:<turn>   -> SnapshotRow (history)
//   msg:<gameId>             -> ChatMessage[]
//   report:<reportId>        -> BugReportRow
export class KVStore implements SnapshotStore {
  constructor(private kv: KVNamespace) {}

  private async getJson<T>(key: string): Promise<T | null> {
    return (await this.kv.get(key, 'json')) as T | null;
  }
  private putJson(key: string, val: unknown): Promise<void> {
    return this.kv.put(key, JSON.stringify(val));
  }

  async putGameMeta(meta: GameMeta): Promise<void> {
    await this.putJson(`meta:${meta.gameId}`, meta);
  }
  async getGameMeta(gameId: string): Promise<GameMeta | null> {
    return this.getJson<GameMeta>(`meta:${gameId}`);
  }
  async listActiveGames(): Promise<GameMeta[]> {
    const list = await this.kv.list({ prefix: 'meta:' });
    const out: GameMeta[] = [];
    for (const k of list.keys) {
      const m = await this.getJson<GameMeta>(k.name);
      if (m && !m.resolved) out.push(m);
    }
    return out;
  }

  async postMessage(gameId: string, msg: ChatMessage): Promise<void> {
    const key = `msg:${gameId}`;
    const cur = (await this.getJson<ChatMessage[]>(key)) ?? [];
    cur.push(msg);
    await this.putJson(key, cur);
  }
  async listMessages(gameId: string, limit = 100): Promise<ChatMessage[]> {
    const cur = (await this.getJson<ChatMessage[]>(`msg:${gameId}`)) ?? [];
    return cur.slice(-limit);
  }

  async deleteGame(gameId: string): Promise<void> {
    const list = await this.kv.list({ prefix: `snap:${gameId}:` });
    await Promise.all(list.keys.map((k) => this.kv.delete(k.name)));
    await this.kv.delete(`meta:${gameId}`);
    await this.kv.delete(`msg:${gameId}`);
  }

  // ONE key per game: `snap:<id>:latest`. Earlier this also wrote a per-turn copy
  // (`snap:<id>:t:<turn>`) and pruneSnapshots listed + deleted old ones after
  // every move — 3 KV operations spent per move on history nothing reads (the
  // client never calls /history). On the free plan that is the binding limit:
  // 1,000 writes and 1,000 deletes a day per account. On 2026-09-23 one busy
  // hour (~370 moves) spent 1,124 writes and 1,521 deletes — ~4 deletes a move,
  // because KV list() is eventually consistent and kept returning keys already
  // deleted, so fast play re-deleted the same keys. Deletes (and lists) are now
  // zero per move and writes are halved.
  async putSnapshot(gameId: string, row: SnapshotRow): Promise<void> {
    await this.putJson(`snap:${gameId}:latest`, row);
  }
  async getLatest(gameId: string): Promise<SnapshotRow | null> {
    return this.getJson<SnapshotRow>(`snap:${gameId}:latest`);
  }
  // No per-turn history is kept, so "history" is just the current state. (The
  // /history route stays answerable; nothing in the app calls it.)
  async getHistory(gameId: string): Promise<SnapshotRow[]> {
    const latest = await this.getLatest(gameId);
    return latest ? [latest] : [];
  }
  // Nothing to prune — there is only the latest snapshot. Kept as an explicit
  // no-op so GameServer's snapshotHistory cap costs no KV operations.
  async pruneSnapshots(_gameId: string, _minTurn: number): Promise<void> {}

  async putReport(row: BugReportRow): Promise<void> {
    await this.putJson(`report:${row.reportId}`, row);
  }
  async listReports(filter?: ReportFilter): Promise<BugReportRow[]> {
    const list = await this.kv.list({ prefix: 'report:' });
    const out: BugReportRow[] = [];
    for (const k of list.keys) {
      const r = await this.getJson<BugReportRow>(k.name);
      if (!r) continue;
      if (filter?.gameId && r.gameId !== filter.gameId) continue;
      if (filter?.unresolved && r.resolution) continue;
      out.push(r);
    }
    return out;
  }
  async resolveReport(reportId: string, resolution: string): Promise<void> {
    const r = await this.getJson<BugReportRow>(`report:${reportId}`);
    if (r) {
      r.resolution = { at: new Date().toISOString(), note: resolution };
      await this.putJson(`report:${reportId}`, r);
    }
  }
}
