import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { getLanAddress } from './net';
import { Room } from './room';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PROD = process.argv.includes('--prod');
const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_HOST = process.env.PUBLIC_HOST ?? getLanAddress();
const joinUrl = `http://${PUBLIC_HOST}:${PORT}/`;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const room = new Room(io, joinUrl, `http://localhost:${PORT}`);
io.on('connection', (socket) => room.handle(socket));

if (PROD) {
  app.use(express.static(path.resolve(dir, '../dist')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.resolve(dir, '../vite.config.ts'),
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: 'mpa',
  });
  app.use(vite.middlewares);
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🎉 LAN-Abfahrt läuft!\n');
  console.log(`  TV / Spielbrett:  http://localhost:${PORT}/tv.html`);
  console.log(`  Handys:           ${joinUrl}  (oder QR-Code auf dem TV scannen)\n`);
});
