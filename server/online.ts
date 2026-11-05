/**
 * Online spielen über einen Cloudflare-Tunnel – ohne Port-Freigabe am Router.
 *
 * `--online` (bzw. `npm run online`): startet `cloudflared tunnel --url http://127.0.0.1:<PORT>` als Kindprozess
 * („Quick Tunnel“, kein Cloudflare-Konto nötig) und liest die zufällige Adresse https://….trycloudflare.com aus
 * dessen Ausgabe. Die Adresse ändert sich bei jedem Start.
 * `ONLINE_URL=https://…` (z. B. eigener, benannter Tunnel mit fester Domain): kein Kindprozess, nur die Adresse.
 *
 * Was über den Tunnel kommt, erkennt der Server an den Proxy-Headern (`viaProxy` in server/net.ts):
 * keine Laptop-Rechte, Musik nur lesen.
 */
import { type ChildProcess, spawn } from 'node:child_process';

const QUICK_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
/** Für Vites Host-Prüfung im Dev-Modus (die Quick-Tunnel-Adresse kennt man erst nach dem Start) */
export const QUICK_TUNNEL_HOSTS = '.trycloudflare.com';
const INSTALL_HINT =
  'cloudflared installieren: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ ' +
  '(Windows: winget install --id Cloudflare.cloudflared · macOS: brew install cloudflared) – oder Pfad per CLOUDFLARED=… setzen.';

/** Feste Online-Adresse aus ONLINE_URL (ohne Pfad, mit „/“ am Ende) bzw. null, wenn nicht gesetzt oder ungültig */
export function onlineUrlFromEnv(raw = process.env.ONLINE_URL): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('kein http(s)');
    return `${u.origin}/`;
  } catch {
    console.warn(`  ⚠️  ONLINE_URL „${raw}“ ist keine gültige Adresse (Beispiel: https://party.example.de) – ignoriert.\n`);
    return null;
  }
}

/** Sucht die Quick-Tunnel-Adresse in einer Ausgabezeile von cloudflared */
export function findQuickTunnelUrl(text: string): string | null {
  const m = QUICK_URL_RE.exec(text);
  // api.trycloudflare.com ist cloudflareds eigene Schnittstelle, nicht der Tunnel
  return m && !m[0].startsWith('https://api.') ? `${m[0]}/` : null;
}

/**
 * Startet den Quick Tunnel. `onUrl` bekommt die Adresse, sobald cloudflared sie meldet (null, wenn der Tunnel endet).
 * Der Kindprozess wird beim Beenden des Servers mit beendet.
 */
export function startQuickTunnel(port: number, onUrl: (url: string | null) => void): ChildProcess | null {
  const bin = process.env.CLOUDFLARED || 'cloudflared';
  let child: ChildProcess;
  try {
    child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.warn(`  ⚠️  cloudflared ließ sich nicht starten (${(e as Error).message}).\n     ${INSTALL_HINT}\n`);
    return null;
  }
  let url: string | null = null;
  let tail = '';
  const read = (chunk: Buffer) => {
    const text = chunk.toString();
    tail = (tail + text).slice(-2000);
    if (url) return;
    const found = findQuickTunnelUrl(tail);
    if (!found) return;
    url = found;
    console.log(`\n  🌍 Online:          ${url}  (Link an die Freunde schicken)`);
    console.log(`     TV bei ihnen:    ${url}tv.html\n`);
    onUrl(url);
  };
  child.stdout?.on('data', read);
  child.stderr?.on('data', read);
  child.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') console.warn(`\n  ⚠️  „${bin}“ nicht gefunden – ohne Tunnel geht es nur im Heimnetz.\n     ${INSTALL_HINT}\n`);
    else console.warn(`\n  ⚠️  cloudflared: ${e.message}\n`);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.warn(`\n  ⚠️  Tunnel beendet (${signal ?? `Code ${code}`}) – online nicht mehr erreichbar.${url ? '' : `\n     Letzte Ausgabe von cloudflared:\n${indent(tail)}`}\n`);
    url = null;
    onUrl(null);
  });

  // Server weg → Tunnel weg (Strg+C, Neustart durch tsx watch, Fenster zu)
  let stopping = false;
  const stop = () => {
    stopping = true;
    if (child.exitCode === null) child.kill();
  };
  process.once('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(sig, () => {
      stop();
      process.exit(0);
    });
  }
  return child;
}

const indent = (s: string) =>
  s
    .trim()
    .split('\n')
    .slice(-6)
    .map((l) => `       ${l}`)
    .join('\n');
