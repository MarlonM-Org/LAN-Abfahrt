/** REST-Zugriff auf die Musik-Bibliothek des Servers (TV-Menü und Musik-Werkstatt) */
import type { Assignment, Song, SongInfo } from '../../shared/music';
import { BUILTIN_INFOS, builtinSong } from '../../shared/musicBuiltin';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}

/** Alle Songs (eingebaute + eigene). Ohne Server (z. B. Datei direkt geöffnet) nur die eingebauten. */
export async function listSongs(): Promise<SongInfo[]> {
  try {
    const r = await json<{ songs: SongInfo[] }>('/api/music/songs');
    return r.songs;
  } catch {
    return BUILTIN_INFOS;
  }
}

export async function getSong(id: string): Promise<Song> {
  const b = builtinSong(id);
  if (b) return structuredClone(b);
  const r = await json<{ song: Song }>(`/api/music/songs/${encodeURIComponent(id)}`);
  return r.song;
}

export async function saveSong(song: Song): Promise<Song> {
  const r = await json<{ song: Song }>(`/api/music/songs/${encodeURIComponent(song.id)}`, { method: 'PUT', body: JSON.stringify(song) });
  return r.song;
}

export async function deleteSong(id: string): Promise<void> {
  await json(`/api/music/songs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getAssignment(): Promise<Assignment> {
  try {
    const r = await json<{ assign: Assignment }>('/api/music/assign');
    return r.assign;
  } catch {
    return {};
  }
}

/** Einzelne Szene umstellen (`null` = Eintrag löschen → Standard) */
export async function assignScene(scene: string, value: string | null): Promise<Assignment> {
  const r = await json<{ assign: Assignment }>('/api/music/assign', { method: 'PATCH', body: JSON.stringify({ [scene]: value ?? '' }) });
  return r.assign;
}
