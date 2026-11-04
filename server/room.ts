import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import type { GameState, JoinRequest, JoinResponse, Phase, PlayerPublic } from '../shared/types';
import { sanitizeLook } from '../shared/avatar';
import { FlunkyGame } from './flunky';

const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;

interface Player extends PlayerPublic {
  socketId: string | null;
  joinedAt: number;
}

/** Ein einziger Raum pro Server – das reicht für den Abend mit der Freundesgruppe. */
export class Room {
  private players = new Map<string, Player>();
  private phase: Phase = 'lobby';
  private flunky: FlunkyGame | null = null;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private io: Server,
    private joinUrl: string,
  ) {}

  handle(socket: Socket) {
    let playerId: string | null = null;

    socket.on('host:hello', () => {
      socket.join('hosts');
      socket.emit('state', this.snapshot());
    });

    socket.on('player:join', (msg: JoinRequest, ack?: (r: JoinResponse) => void) => {
      const reply = (r: JoinResponse) => typeof ack === 'function' && ack(r);
      const name = String(msg?.name ?? '').trim().slice(0, 12);
      if (!name) return reply({ ok: false, error: 'Bitte gib einen Namen ein.' });

      let p = msg.playerId ? this.players.get(msg.playerId) : undefined;
      if (!p) {
        if (this.phase !== 'lobby') {
          return reply({ ok: false, error: 'Gerade läuft ein Spiel – gleich geht’s weiter!' });
        }
        if (this.players.size >= MAX_PLAYERS) {
          return reply({ ok: false, error: `Lobby ist voll (max. ${MAX_PLAYERS}).` });
        }
        p = {
          id: randomUUID(),
          name,
          look: sanitizeLook(msg.look),
          connected: true,
          isVip: false,
          socketId: socket.id,
          joinedAt: Date.now(),
        };
        this.players.set(p.id, p);
      }
      p.name = name;
      p.look = sanitizeLook(msg.look);
      p.socketId = socket.id;
      p.connected = true;
      playerId = p.id;
      socket.join('players');
      this.ensureVip();
      reply({ ok: true, playerId: p.id });
      this.changed();
    });

    socket.on('vip:start', (game: string) => {
      const p = playerId ? this.players.get(playerId) : undefined;
      if (!p?.isVip || this.phase !== 'lobby') return;
      const ids = this.connectedIds();
      if (ids.length < MIN_PLAYERS) {
        socket.emit('toast', `Mindestens ${MIN_PLAYERS} Spieler nötig.`);
        return;
      }
      if (game === 'flunky') {
        this.flunky = new FlunkyGame(ids, () => this.changed(), (id) => !!this.players.get(id)?.connected);
        this.phase = 'flunky';
        this.changed();
      }
    });

    socket.on('vip:lobby', () => {
      const p = playerId ? this.players.get(playerId) : undefined;
      if (!p?.isVip) return;
      this.backToLobby();
    });

    socket.on('flunky:throw', (msg: { angle: number; power: number }) => {
      if (playerId && this.phase === 'flunky') this.flunky?.throw(playerId, Number(msg?.angle), Number(msg?.power));
    });

    socket.on('flunky:tap', () => {
      if (playerId && this.phase === 'flunky') this.flunky?.tap(playerId);
    });

    socket.on('player:leave', () => {
      if (playerId && this.phase === 'lobby') {
        this.players.delete(playerId);
        playerId = null;
        this.ensureVip();
        this.changed();
      }
    });

    socket.on('disconnect', () => {
      if (!playerId) return;
      const p = this.players.get(playerId);
      if (!p || p.socketId !== socket.id) return; // bereits mit neuem Socket verbunden
      p.connected = false;
      p.socketId = null;
      if (this.phase === 'lobby') {
        this.players.delete(playerId);
      } else if (this.connectedIds().length === 0) {
        // Alle Handys weg → sonst hängt das Spiel fest und niemand kann neu beitreten
        return this.backToLobby();
      } else {
        this.flunky?.playerDisconnected(playerId);
      }
      this.ensureVip();
      this.changed();
    });
  }

  private backToLobby() {
    this.flunky?.dispose();
    this.flunky = null;
    this.phase = 'lobby';
    for (const [id, p] of this.players) if (!p.connected) this.players.delete(id);
    this.ensureVip();
    this.changed();
  }

  private connectedIds() {
    return [...this.players.values()].filter((p) => p.connected).map((p) => p.id);
  }

  /** Der am längsten verbundene Spieler ist Spielleiter (VIP) und steuert die Menüs. */
  private ensureVip() {
    const list = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const current = list.find((p) => p.isVip && p.connected);
    const vip = current ?? list.find((p) => p.connected);
    for (const p of list) p.isVip = p === vip;
  }

  snapshot(): GameState {
    return {
      phase: this.phase,
      players: [...this.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map(({ id, name, look, connected, isVip }) => ({ id, name, look, connected, isVip })),
      flunky: this.flunky?.state ?? null,
      joinUrl: this.joinUrl,
    };
  }

  /** Bündelt Zustandsänderungen (z. B. viele Taps) zu max. ~25 Updates pro Sekunde. */
  private changed() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.io.emit('state', this.snapshot());
    }, 40);
  }
}
