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
