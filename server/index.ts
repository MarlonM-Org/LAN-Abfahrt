import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { getLanAddress } from './net';
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
const PORT = Number(process.env.PORT ?? 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 3443);
const PUBLIC_HOST = process.env.PUBLIC_HOST ?? getLanAddress();

// HTTPS (nur nötig für den Bewegungssensor auf iPhones): aktiv, sobald eine Domain
// und ein passendes Zertifikat vorhanden sind. HTTP auf PORT läuft immer weiter (TV, Bots).
const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN;
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
const io = new Server(httpServer);
if (httpsServer) io.attach(httpsServer);
const room = new Room(io, joinUrl, `http://localhost:${PORT}`);
io.on('connection', (socket) => room.handle(socket));

if (PROD) {
  app.use(express.static(path.resolve(dir, '../dist')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.resolve(dir, '../vite.config.ts'),
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
      // Vite blockt fremde Hostnamen – die eigene Domain freigeben
      allowedHosts: PUBLIC_DOMAIN ? [PUBLIC_DOMAIN] : undefined,
    },
    appType: 'mpa',
  });
  app.use(vite.middlewares);
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🎉 LAN-Abfahrt läuft!\n');
  console.log(`  TV / Spielbrett:  http://localhost:${PORT}/tv.html`);
  console.log(`  Handys:           ${joinUrl}  (oder QR-Code auf dem TV scannen)\n`);
  if (PUBLIC_DOMAIN && !tls) {
    console.log(`  ⚠️  PUBLIC_DOMAIN gesetzt, aber kein Zertifikat unter ${TLS_CERT} – HTTPS bleibt aus.\n`);
  }
});
httpsServer?.listen(HTTPS_PORT, '0.0.0.0', () => {
  console.log(`  🔒 HTTPS aktiv:    https://${PUBLIC_DOMAIN}:${HTTPS_PORT}/  (Bewegungssensor auf iPhones)`);
  console.log(`     ${PUBLIC_DOMAIN} muss auf ${PUBLIC_HOST} zeigen.\n`);
});
