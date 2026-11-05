import type { Socket } from 'socket.io-client';
import type { ServerHello } from '../shared/types';
import { MINI_INFO } from '../shared/games';

const RELOADED = 'lanabfahrt.reloadedFor';

/**
 * Sorgt dafür, dass Handy/TV nicht mit altem Code gegen einen neueren Server spielen
 * (z. B. nach `git pull`: der Server startet neu, die offene Seite aber nicht – über
 * HTTPS oder bei gesperrtem Handy kommt Vites Auto-Reload nicht an).
 * - Server neu gestartet → Seite neu laden.
 * - Server kennt Spiele, die dieser Code nicht kennt → einmal neu laden; hilft das nicht
 *   (veralteter Produktiv-Build), wird `onOutdated` aufgerufen.
 */
export function watchServerVersion(socket: Socket, onOutdated?: (unknown: string[]) => void) {
  let boot: string | null = null;
  socket.on('server:hello', (h: ServerHello) => {
    if (boot && h.boot !== boot) return location.reload();
    boot = h.boot;
    const unknown = h.kinds.filter((k) => !(k in MINI_INFO));
    if (!unknown.length) return;
    if (sessionStorage.getItem(RELOADED) !== h.boot) {
      sessionStorage.setItem(RELOADED, h.boot);
      return location.reload();
    }
    console.warn('Client-Code ist älter als der Server, unbekannte Spiele:', unknown);
    onOutdated?.(unknown);
  });
}

/** Kennt dieser Code das Minispiel? (sonst ist er veraltet) */
export const knownKind = (kind: string) => kind in MINI_INFO;
