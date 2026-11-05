/**
 * Spieler entfernen (Kick) + Aufräumen von Offline-Spielern.
 *
 * Die eigentliche Verdrahtung steckt in `Room` (Abschnitt „Spieler entfernen & Offline“);
 * hier liegen nur die kleinen, unabhängigen Helfer. Laptop-Prüfung (localhost, nicht über den Tunnel): `isLaptop` in server/net.ts.
 */

/** Nach so vielen Minuten offline in der Lobby fliegt ein Spieler automatisch raus (`OFFLINE_KICK_MIN=…`). */
export const OFFLINE_REMOVE_MS = Math.max(0.05, Number(process.env.OFFLINE_KICK_MIN ?? 5) || 5) * 60_000;

/** Wie lange sich der Server gekickte Spieler-IDs merkt (danach tritt das Handy einfach neu bei). */
const KICK_MEMORY_MS = 6 * 60 * 60_000;

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
