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

  async putSnapshot(gameId: string, row: SnapshotRow): Promise<void> {
    await this.putJson(`snap:${gameId}:latest`, row);
    await this.putJson(`snap:${gameId}:t:${String(row.turn).padStart(6, '0')}`, row);
  }
  async getLatest(gameId: string): Promise<SnapshotRow | null> {
    return this.getJson<SnapshotRow>(`snap:${gameId}:latest`);
  }
  async getHistory(gameId: string): Promise<SnapshotRow[]> {
    const list = await this.kv.list({ prefix: `snap:${gameId}:t:` });
    const rows: SnapshotRow[] = [];
    for (const k of list.keys) {
      const r = await this.getJson<SnapshotRow>(k.name);
      if (r) rows.push(r);
    }
    return rows.sort((a, b) => a.turn - b.turn);
  }
  // Snapshot-history cap (GameServer.snapshotHistory): drop per-turn history
  // keys older than minTurn. The `:latest` key is untouched.
  async pruneSnapshots(gameId: string, minTurn: number): Promise<void> {
    const list = await this.kv.list({ prefix: `snap:${gameId}:t:` });
    for (const k of list.keys) {
      const turn = parseInt(k.name.slice(k.name.lastIndexOf(':') + 1), 10);
      if (Number.isFinite(turn) && turn < minTurn) await this.kv.delete(k.name);
    }
  }

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
