import React from 'react';
import type { FigureType } from '../game/types';

// ---------------------------------------------------------------------------
// Original, art-free token & tile system — a designed alternative to the
// VASSAL module artwork. Everything here is drawn from scratch with SVG/CSS:
// abstract faction marks (NOT the copyrighted corporate logos), original
// Dark Legion creature glyphs, and a sci-fi "schematic" floor for the tiles.
// ---------------------------------------------------------------------------

export const FACTION_COLOR: Record<string, string> = {
  Bauhaus: '#d4a43c',
  Imperial: '#4f8bd0',
  Cybertronic: '#43b9b0',
  Capitol: '#d6603f',
  Mishima: '#b05ad0',
  'Dark Legion': '#b3202a',
};
const FACTION_DARK: Record<string, string> = {
  Bauhaus: '#5a3f0c',
  Imperial: '#15314f',
  Cybertronic: '#0f3f3b',
  Capitol: '#4f1c10',
  Mishima: '#3c1450',
  'Dark Legion': '#3a0508',
};

function initials(name: string): string {
  const p = name.split(' ').filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p[p.length - 1]?.[0] ?? '')).toUpperCase();
}

// Abstract, original faction emblems (geometric shapes, not real logos).
function FactionMark({ faction, color }: { faction: string; color: string }) {
  const c = color;
  switch (faction) {
    case 'Bauhaus': // hexagon
      return <polygon points="50,8 84,28 84,68 50,88 16,68 16,28" fill="none" stroke={c} strokeWidth="7" />;
    case 'Imperial': // crown / triple peak
      return <path d="M18 78 L18 40 L34 56 L50 30 L66 56 L82 40 L82 78 Z" fill="none" stroke={c} strokeWidth="7" strokeLinejoin="round" />;
    case 'Cybertronic': // circuit node
      return (
        <g fill="none" stroke={c} strokeWidth="7">
          <circle cx="50" cy="50" r="18" />
          <path d="M50 8 V32 M50 68 V92 M8 50 H32 M68 50 H92" />
        </g>
      );
    case 'Capitol': // star
      return <path d="M50 10 L61 40 L93 40 L67 59 L77 90 L50 70 L23 90 L33 59 L7 40 L39 40 Z" fill="none" stroke={c} strokeWidth="6" strokeLinejoin="round" />;
    case 'Mishima': // rising sun / rays
      return (
        <g fill="none" stroke={c} strokeWidth="6">
          <circle cx="50" cy="52" r="16" />
          <path d="M50 6 L50 20 M86 24 L77 34 M94 60 L80 58 M6 60 L20 58 M14 24 L23 34" />
        </g>
      );
    default:
      return <circle cx="50" cy="50" r="22" fill="none" stroke={c} strokeWidth="7" />;
  }
}

// Original Dark Legion creature silhouettes (hand-drawn, generic horror shapes).
function CreatureGlyph({ typeId }: { typeId: string }) {
  const s = { fill: '#e7c0c0', stroke: '#2a0405', strokeWidth: 2, strokeLinejoin: 'round' as const };
  switch (typeId) {
    case 'legionnaire': // gaunt skull
      return (
        <g {...s}>
          <path d="M50 18 C33 18 26 32 26 46 C26 56 32 62 36 66 L36 76 L64 76 L64 66 C68 62 74 56 74 46 C74 32 67 18 50 18 Z" />
          <circle cx="41" cy="46" r="6" fill="#2a0405" />
          <circle cx="59" cy="46" r="6" fill="#2a0405" />
          <path d="M46 58 L50 64 L54 58 Z" fill="#2a0405" />
        </g>
      );
    case 'necromutant': // broad-shouldered officer bust
      return (
        <g {...s}>
          <path d="M24 84 C24 62 34 54 50 54 C66 54 76 62 76 84 Z" />
          <circle cx="50" cy="36" r="16" />
          <circle cx="44" cy="34" r="3" fill="#b3202a" />
          <circle cx="56" cy="34" r="3" fill="#b3202a" />
        </g>
      );
    case 'centurion': // crested helmet
      return (
        <g {...s}>
          <path d="M50 14 C58 22 60 30 60 30 L60 46 C60 60 42 60 40 46 L40 30 C40 30 42 22 50 14 Z" fill="#b3202a" />
          <path d="M30 84 C30 60 38 50 50 50 C62 50 70 60 70 84 Z" />
          <rect x="42" y="38" width="16" height="10" rx="2" fill="#2a0405" />
        </g>
      );
    case 'razide': // hulking horned beast with weapon arm
      return (
        <g {...s}>
          <path d="M26 84 L26 50 C26 40 36 34 50 34 C64 34 74 40 74 50 L74 84 Z" />
          <path d="M34 36 L26 22 L40 32 Z M66 36 L74 22 L60 32 Z" fill="#b3202a" />
          <rect x="74" y="52" width="16" height="9" rx="2" fill="#2a0405" />
          <circle cx="44" cy="50" r="3.5" fill="#b3202a" />
          <circle cx="58" cy="50" r="3.5" fill="#b3202a" />
        </g>
      );
    case 'nepharite': // tall spiked commander
      return (
        <g {...s}>
          <path d="M50 10 L42 26 L46 26 L40 44 L60 44 L54 26 L58 26 Z" fill="#b3202a" />
          <path d="M30 86 L34 46 C34 40 42 40 50 40 C58 40 66 40 66 46 L70 86 Z" />
          <path d="M30 50 L18 40 L34 56 Z M70 50 L82 40 L66 56 Z" fill="#b3202a" />
          <circle cx="50" cy="34" r="9" />
          <circle cx="46" cy="33" r="2.4" fill="#b3202a" />
          <circle cx="54" cy="33" r="2.4" fill="#b3202a" />
        </g>
      );
    case 'ezoghoul': // massive spiked brute
      return (
        <g {...s}>
          <path d="M18 88 L20 44 C20 32 34 24 50 24 C66 24 80 32 80 44 L82 88 Z" />
          <path d="M28 28 L18 12 L40 26 Z M72 28 L82 12 L60 26 Z M50 22 L44 6 L56 6 Z" fill="#b3202a" />
          <path d="M34 60 L40 54 L46 60 L52 54 L58 60 L64 54" fill="none" stroke="#2a0405" strokeWidth="4" />
          <circle cx="42" cy="44" r="4" fill="#b3202a" />
          <circle cx="58" cy="44" r="4" fill="#b3202a" />
        </g>
      );
    default:
      return <circle cx="50" cy="50" r="26" fill="#e7c0c0" stroke="#2a0405" strokeWidth="2" />;
  }
}

/** A fully-designed figure token. Troopers get a faction badge with emblem +
 *  initials; creatures get an original menacing glyph on a dark disc. */
export const DesignedFigure: React.FC<{ ft: FigureType }> = ({ ft }) => {
  const color = FACTION_COLOR[ft.faction] ?? '#888';
  const dark = FACTION_DARK[ft.faction] ?? '#222';

  if (ft.isTrooper) {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ display: 'block' }}>
        <defs>
          <radialGradient id={`g-${ft.id}`} cx="50%" cy="35%" r="75%">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={dark} />
          </radialGradient>
        </defs>
        <rect x="6" y="6" width="88" height="88" rx="16" fill={`url(#g-${ft.id})`} stroke="#0a0a0a" strokeWidth="3" />
        <g opacity="0.35" transform="translate(50 30) scale(0.42) translate(-50 -50)">
          <FactionMark faction={ft.faction} color="#ffffff" />
        </g>
        <text x="50" y="68" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="34" fill="#ffffff" stroke="#0a0a0a" strokeWidth="1">
          {initials(ft.name)}
        </text>
      </svg>
    );
  }

  // creature
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ display: 'block' }}>
      <defs>
        <radialGradient id={`c-${ft.id}`} cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#5a0d12" />
          <stop offset="100%" stopColor="#160203" />
        </radialGradient>
      </defs>
      <rect x="5" y="5" width="90" height="90" rx="14" fill={`url(#c-${ft.id})`} stroke="#7a1018" strokeWidth="3" />
      <CreatureGlyph typeId={ft.id} />
    </svg>
  );
};

const SECTOR_ACCENT = ['#1b3a4b', '#2a2f1b', '#3a1b3a', '#1b2f3a', '#3a2a1b', '#1b3a2a', '#2a1b3a', '#3a1b22', '#22323a'];

/** A designed sci-fi floor for one sector (used when no module art is loaded). */
export function DesignedTile({ id, size, cell }: { id: number; size: number; cell: number }) {
  const accent = SECTOR_ACCENT[id % SECTOR_ACCENT.length];
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: `
          radial-gradient(circle at 50% 38%, ${accent} 0%, #0c1016 85%),
          repeating-linear-gradient(45deg, rgba(255,255,255,0.018) 0 6px, transparent 6px 12px)`,
        position: 'relative',
        boxShadow: 'inset 0 0 0 1px rgba(120,160,190,0.18)',
      }}
    >
      <div style={{
        position: 'absolute', top: 4, left: 7, color: 'rgba(150,190,220,0.5)',
        fontSize: cell * 0.85, fontWeight: 800, lineHeight: 1, fontFamily: 'system-ui, sans-serif',
        textShadow: '0 1px 2px #000',
      }}>{id}</div>
      <div style={{
        position: 'absolute', top: 6, right: 8, color: 'rgba(150,190,220,0.4)',
        fontSize: 9, letterSpacing: 2, fontFamily: 'monospace',
      }}>SECTOR</div>
    </div>
  );
}
