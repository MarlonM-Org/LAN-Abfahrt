import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { domainConfigFromEnv, prepareDomain } from './domain';
import { getLanAddress } from './net';
import { MusicStore, musicRouter } from './music';
import { QUICK_TUNNEL_HOSTS, onlineUrlFromEnv, startQuickTunnel } from './online';
import { Room } from './room';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');

// Optionale lokale Einstellungen aus .env (PUBLIC_DOMAIN, TLS_CERT, …)
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  /* keine .env – Standardwerte */
}

const PROD = process.argv.includes('--prod');
// Online spielen: --online startet einen Cloudflare-Quick-Tunnel, ONLINE_URL = eigener Tunnel mit fester Adresse
const ONLINE_URL = onlineUrlFromEnv();
const QUICK_TUNNEL = process.argv.includes('--online') && !ONLINE_URL;
const PORT = Number(process.env.PORT ?? 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 3443);
const PUBLIC_HOST = process.env.PUBLIC_HOST ?? getLanAddress();

// HTTPS (nur nötig für den Bewegungssensor auf iPhones): aktiv, sobald eine Domain
// und ein passendes Zertifikat vorhanden sind. HTTP auf PORT läuft immer weiter (TV, Bots).
const domainCfg = domainConfigFromEnv(root);
// Mit deSEC: IP eintragen + Zertifikat holen/erneuern, bevor der Server startet
if (domainCfg) await prepareDomain(domainCfg, PUBLIC_HOST);
const PUBLIC_DOMAIN = domainCfg?.domain ?? process.env.PUBLIC_DOMAIN;
const TLS_CERT = path.resolve(root, process.env.TLS_CERT ?? 'certs/fullchain.pem');
const TLS_KEY = path.resolve(root, process.env.TLS_KEY ?? 'certs/privkey.pem');
const tls =
  PUBLIC_DOMAIN && fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY)
    ? { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) }
    : null;

const joinUrl = tls ? `https://${PUBLIC_DOMAIN}:${HTTPS_PORT}/` : `http://${PUBLIC_HOST}:${PORT}/`;

const app = express();
const httpServer = http.createServer(app);
const httpsServer = tls ? https.createServer(tls, app) : null;
// Schneller merken, wenn ein Handy weg ist (Tab zu, WLAN weg, Akku leer): ≤ ~22 s statt 45 s (Standard)
const io = new Server(httpServer, { pingInterval: 10_000, pingTimeout: 12_000 });
if (httpsServer) io.attach(httpsServer);
const room = new Room(io, joinUrl, `http://localhost:${PORT}`);
room.setOnlineUrl(ONLINE_URL);
io.on('connection', (socket) => room.handle(socket));

// Musik-Bibliothek (eigene Songs + Szenen-Zuordnung) – REST für TV-Menü und /musik.html
const music = new MusicStore();
app.use('/api/music', musicRouter(music, io));

if (PROD) {
  app.use(express.static(path.resolve(dir, '../dist')));
} else {
  const { createServer, searchForWorkspaceRoot } = await import('vite');
  // In Worktrees ist node_modules oft ein Symlink auf den Haupt-Checkout. Vite erlaubt
  // /@fs/-Zugriffe nur innerhalb von fs.allow (Standard: Workspace-Root), sonst 403 –
  // z. B. für die Font-Dateien von „Press Start 2P“. Deshalb den echten Pfad freigeben.
  const nodeModules = path.join(root, 'node_modules');
  let realNodeModules = nodeModules;
  try {
    realNodeModules = fs.realpathSync(nodeModules);
  } catch {
    /* kein node_modules – Vite meldet fehlende Pakete selbst */
  }
  const vite = await createServer({
    configFile: path.resolve(dir, '../vite.config.ts'),
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
      // Vite blockt fremde Hostnamen – die eigene Domain und die Tunnel-Adresse freigeben
      allowedHosts: allowedHosts(),
      fs: { allow: [...new Set([searchForWorkspaceRoot(process.cwd()), root, nodeModules, realNodeModules])] },
    },
    appType: 'mpa',
  });
  app.use(vite.middlewares);
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🎉 LAN-Abfahrt läuft!\n');
  console.log(`  TV / Spielbrett:  http://localhost:${PORT}/tv.html`);
  console.log(`  Musik-Werkstatt:  http://localhost:${PORT}/musik.html`);
  console.log(`  Handys:           ${joinUrl}  (oder QR-Code auf dem TV scannen)\n`);
  if (ONLINE_URL) console.log(`  🌍 Online:          ${ONLINE_URL}  (ONLINE_URL – den Tunnel dorthin startest du selbst)\n`);
  if (QUICK_TUNNEL) {
    console.log('  🌍 Starte Cloudflare-Tunnel …');
    startQuickTunnel(PORT, (url) => room.setOnlineUrl(url));
  }
  if (PUBLIC_DOMAIN && !tls) {
    console.log(`  ⚠️  PUBLIC_DOMAIN gesetzt, aber kein Zertifikat unter ${TLS_CERT} – HTTPS bleibt aus.\n`);
  }
});
httpsServer?.listen(HTTPS_PORT, '0.0.0.0', () => {
  console.log(`  🔒 HTTPS aktiv:    https://${PUBLIC_DOMAIN}:${HTTPS_PORT}/  (Bewegungssensor auf iPhones)`);
  console.log(`     ${PUBLIC_DOMAIN} muss auf ${PUBLIC_HOST} zeigen.\n`);
});

/** Hostnamen, die Vite im Dev-Modus durchlässt (localhost und IP-Adressen gehen immer) */
function allowedHosts(): string[] | undefined {
  const hosts = [PUBLIC_DOMAIN, ONLINE_URL && new URL(ONLINE_URL).hostname, QUICK_TUNNEL && QUICK_TUNNEL_HOSTS].filter((h): h is string => !!h);
  return hosts.length ? hosts : undefined;
}
