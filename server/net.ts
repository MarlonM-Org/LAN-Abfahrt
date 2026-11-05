import type { IncomingHttpHeaders } from 'node:http';
import os from 'node:os';

/** Sucht die IPv4-Adresse im Heimnetz, damit die Handys den Server erreichen. */
export function getLanAddress(): string {
  const candidates: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) candidates.push(addr.address);
    }
  }
  const preferred =
    candidates.find((a) => a.startsWith('192.168.')) ??
    candidates.find((a) => a.startsWith('10.')) ??
    candidates.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) ??
    candidates[0];
  return preferred ?? 'localhost';
}

/** Kommt die Verbindung vom Rechner selbst (localhost)? Nur dann gilt die TV-Seite als „Laptop“. */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/**
 * Kam die Anfrage über einen Tunnel/Proxy (cloudflared, ngrok, nginx …)? Die setzen einen dieser Header.
 * Wichtig, weil cloudflared auf dem Laptop läuft: für den Server kommt dann *jede* Online-Verbindung von localhost.
 * Fälschen bringt nichts – wer den Header selbst mitschickt, verliert nur Rechte.
 */
const PROXY_HEADERS = ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded'];
export function viaProxy(headers: IncomingHttpHeaders): boolean {
  return PROXY_HEADERS.some((h) => headers[h] !== undefined);
}

/** Laptop-Rechte (TV-Steuerung, Spieler entfernen): direkt vom Rechner selbst und nicht durch einen Tunnel. */
export function isLaptop(conn: { address?: string; headers: IncomingHttpHeaders }): boolean {
  return isLoopback(conn.address) && !viaProxy(conn.headers);
}
