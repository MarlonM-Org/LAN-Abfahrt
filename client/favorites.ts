import type { MiniKind } from '../shared/types';
import { MINI_INFO } from '../shared/games';

/**
 * Favoriten der Arcade-Übersicht (☆/⭐ an den Kacheln: VIP-Handy und Laptop-Auswahl) – bewusst nur im Browser des
 * Geräts (localStorage, bleibt über den Abend hinaus, bis die Browserdaten gelöscht werden). Kein Server, kein Repo.
 */
const KEY = 'lanabfahrt.favorites';

export function loadFavorites(): MiniKind[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((k): k is MiniKind => typeof k === 'string' && k in MINI_INFO) : [];
  } catch {
    return [];
  }
}

/** Favorit an/aus – liefert die neue Liste (ohne Speicher gilt sie nur bis zum Neuladen) */
export function toggleFavorite(kind: MiniKind, list = loadFavorites()): MiniKind[] {
  const next = list.includes(kind) ? list.filter((k) => k !== kind) : [...list, kind];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* privater Modus o. ä. */
  }
  return next;
}
