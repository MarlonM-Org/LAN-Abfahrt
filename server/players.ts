/**
 * Spieler entfernen (Kick) + Aufräumen von Offline-Spielern.
 *
 * Die eigentliche Verdrahtung steckt in `Room` (Abschnitt „Spieler entfernen & Offline“);
 * hier liegen nur die kleinen, unabhängigen Helfer.
 */

/** Nach so vielen Minuten offline in der Lobby fliegt ein Spieler automatisch raus (`OFFLINE_KICK_MIN=…`). */
export const OFFLINE_REMOVE_MS = Math.max(0.05, Number(process.env.OFFLINE_KICK_MIN ?? 5) || 5) * 60_000;

/** Wie oft die Lobby nach zu lange offline gebliebenen Spielern schaut. */
export const OFFLINE_SWEEP_MS = Math.max(1000, Math.min(5000, OFFLINE_REMOVE_MS / 4));

/** Wie lange sich der Server gekickte Spieler-IDs merkt (danach tritt das Handy einfach neu bei). */
const KICK_MEMORY_MS = 6 * 60 * 60_000;

/**
 * Darf diese Verbindung Host-Befehle (Spieler entfernen am Laptop) schicken?
 * Nur der Laptop selbst, d. h. Loopback: 127.x.x.x, ::1 bzw. ::ffff:127.x.x.x.
 * Handys im WLAN kommen immer mit ihrer eigenen IP an und werden abgewiesen.
 */
export function isLoopback(raw: string | undefined | null): boolean {
  if (!raw) return false;
  let addr = String(raw).trim().toLowerCase();
  if (addr.startsWith('::ffff:')) addr = addr.slice(7); // IPv4-mapped IPv6
  if (addr === '::1' || addr === '0:0:0:0:0:0:0:1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
}

/** Merkt sich gekickte Spieler-IDs, damit ein Handy nicht still als alter Spieler zurückkommt. */
export class KickList {
  private ids = new Map<string, number>();

  add(id: string) {
    this.ids.set(id, Date.now());
    this.prune();
  }

  has(id: string | undefined | null): boolean {
    if (!id) return false;
    this.prune();
    return this.ids.has(id);
  }

  private prune() {
    const cut = Date.now() - KICK_MEMORY_MS;
    for (const [id, at] of this.ids) if (at < cut) this.ids.delete(id);
    // Nie unbegrenzt wachsen lassen
    while (this.ids.size > 200) this.ids.delete(this.ids.keys().next().value!);
  }
}
