/** Gemeinsame Texte rund um Offline-/Entfernt-Anzeige (Handy + TV). */

/** „offline seit 2 min“ */
export function offlineLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return 'offline seit eben';
  const m = Math.floor(s / 60);
  if (m < 60) return `offline seit ${m} min`;
  return `offline seit ${Math.floor(m / 60)} h`;
}

/** „Bens“, „Max’“, „Bot Lenas“ – Genitiv für Knopftexte wie „Bens Zug überspringen“ */
export function possessive(name: string): string {
  const n = name.trim();
  return /(?:[sßxz]|ce)$/i.test(n) ? `${n}’` : `${n}s`;
}

/**
 * Spielerfarbe des Abends: Der Raum vergibt beim Beitritt die erste freie dieser 12 Farben
 * (`PlayerPublic.color` = Index) und behält sie, solange der Spieler im Raum ist. Alle Spiele
 * nutzen sie für Ring, Namensschild, Spur, Fadenkreuz, Ball und HUD-Rahmen – das Shirt bleibt frei wählbar.
 * Auf Abstand geprüft (CIEDE2000 ≥ 21 zwischen allen Paaren): kein Blau/Hellblau, kein Gelb/Limette,
 * Orange bewusst kräftig, Gelb zitronig. Reihenfolge = Vergabe-Reihenfolge, die ersten sechs sind die klarsten.
 */
export const PLAYER_COLORS: readonly { readonly hex: string; readonly name: string }[] = [
  { hex: '#e8323a', name: 'Rot' },
  { hex: '#2f74f0', name: 'Blau' },
  { hex: '#2eaa4a', name: 'Grün' },
  { hex: '#ffe83a', name: 'Gelb' },
  { hex: '#a24ae8', name: 'Lila' },
  { hex: '#ff8418', name: 'Orange' },
  { hex: '#1ec8c0', name: 'Türkis' },
  { hex: '#f6f2e8', name: 'Weiß' },
  { hex: '#9a9cab', name: 'Grau' },
  { hex: '#ff5cb4', name: 'Pink' },
  { hex: '#9a1c4c', name: 'Weinrot' },
  { hex: '#8c5428', name: 'Braun' },
];

export interface PlayerColor {
  index: number;
  hex: string;
  /** Als Zahl für Phaser (0xRRGGBB) */
  num: number;
  name: string;
  /** Lesbare Schriftfarbe auf dieser Farbe (dunkel auf hellen, hell auf dunklen Tönen) */
  ink: string;
}

const luma = (n: number) => 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
const COLOR_CACHE = PLAYER_COLORS.map((c, index): PlayerColor => {
  const num = parseInt(c.hex.slice(1), 16);
  return { index, hex: c.hex, num, name: c.name, ink: luma(num) > 140 ? '#2d1b12' : '#fff4d6' };
});

/** Farbe zum Index (wird umgebrochen, ungültig → Rot) */
export function playerColor(index: number | null | undefined): PlayerColor {
  const n = COLOR_CACHE.length;
  const i = typeof index === 'number' && Number.isFinite(index) ? ((Math.floor(index) % n) + n) % n : 0;
  return COLOR_CACHE[i];
}

/** Erste freie Farbe – sind alle vergeben, die seltenste (bei Gleichstand die vorderste) */
export function freePlayerColor(used: Iterable<number>): number {
  const count = new Array<number>(PLAYER_COLORS.length).fill(0);
  for (const u of used) if (u >= 0 && u < count.length) count[u]++;
  let best = 0;
  for (let i = 1; i < count.length; i++) if (count[i] < count[best]) best = i;
  return best;
}
