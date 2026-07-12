// Battle-log renderer for the structured game log (log-format v2).
// Indentation comes from structure (payload.depth), not leading whitespace.
// Legacy entries (kind 'legacy', wrapped from old string[] snapshots) still
// carry the old two-leading-spaces hack, so we derive their depth from that.
import type { GameLogEntry } from 'digital-boardgame-framework';

export function entryDepth(e: GameLogEntry<string>): number {
  const d = (e.payload as { depth?: number } | undefined)?.depth;
  if (typeof d === 'number') return d;
  if (e.kind === 'legacy' && (e.msg ?? '').startsWith('  ')) return 1;
  return 0;
}

function entryColor(e: GameLogEntry<string>): string {
  const msg = e.msg ?? '';
  if (e.kind === 'combat.kill' || msg.includes('ELIMINATED')) return '#f66';
  if (e.kind === 'round.start' || msg.startsWith('—')) return '#e8c349';
  if (e.kind === 'mission.end') return '#e8c349';
  return '#bbb';
}

export function LogLines({ entries }: { entries: GameLogEntry<string>[] }) {
  return (
    <>
      {entries.map((e) => (
        <div key={e.seq} style={{ color: entryColor(e), paddingLeft: entryDepth(e) * 12 }}>
          {(e.msg ?? e.kind).trim()}
        </div>
      ))}
    </>
  );
}
