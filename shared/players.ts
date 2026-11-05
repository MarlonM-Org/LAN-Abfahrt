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
