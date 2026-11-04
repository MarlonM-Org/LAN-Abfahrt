import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import type {
  GameState,
  JoinRequest,
  JoinResponse,
  MiniKind,
  Phase,
  PlayerPublic,
  ResultsState,
  StartRequest,
} from '../shared/types';
import { sanitizeLook } from '../shared/avatar';
import { DEFAULT_QUESTIONS, MINI_INFO, PARTY_ROUND_OPTIONS, PLACE_COINS } from '../shared/games';
import { Board } from './board';
import { FlunkyGame } from './flunky';
import { type MiniCtx, type MiniGame, type MiniResult, asRecord } from './minigame';
import { MurderGame } from './murder';
import { QuestionStore } from './questions';
import { SprintGame } from './sprint';
import { WweGame } from './wwe';

const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const MINI_KINDS: MiniKind[] = ['flunky', 'wwe', 'sprint', 'murder'];

interface Player extends PlayerPublic {
  socketId: string | null;
  joinedAt: number;
}

/** Ein einziger Raum pro Server – das reicht für den Abend mit der Freundesgruppe. */
export class Room {
  private players = new Map<string, Player>();
  private phase: Phase = 'lobby';
  private mini: MiniGame | null = null;
  private board: Board | null = null;
  private results: ResultsState | null = null;
  private questions = new QuestionStore();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private io: Server,
    private joinUrl: string,
  ) {}

  handle(socket: Socket) {
    let playerId: string | null = null;
    const me = () => (playerId ? this.players.get(playerId) : undefined);
    const isVip = () => !!me()?.isVip;

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
        p = { id: randomUUID(), name, look: sanitizeLook(msg.look), connected: true, isVip: false, socketId: null, joinedAt: Date.now() };
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

    socket.on('vip:start', (raw: StartRequest) => {
      if (!isVip() || this.phase !== 'lobby') return;
      const req = asRecord(raw);
      const ids = this.connectedIds();
      if (req.mode === 'party') {
        if (ids.length < MIN_PLAYERS) return socket.emit('toast', `Mindestens ${MIN_PLAYERS} Spieler nötig.`);
        const rounds = PARTY_ROUND_OPTIONS.includes(Number(req.rounds)) ? Number(req.rounds) : 5;
        this.startParty(ids, rounds);
      } else if (MINI_KINDS.includes(req.mode as MiniKind)) {
        const kind = req.mode as MiniKind;
        const min = MINI_INFO[kind].minPlayers;
        if (ids.length < min) return socket.emit('toast', `${MINI_INFO[kind].title}: mindestens ${min} Spieler.`);
        this.startMini(kind);
      }
    });

    socket.on('vip:continue', () => {
      if (isVip() && this.phase === 'results') this.continueAfterResults();
    });

    socket.on('vip:lobby', () => {
      if (isVip()) this.backToLobby();
    });

    socket.on('vip:mini', (action: string) => {
      if (isVip() && this.phase === 'mini') this.mini?.vipAction?.(String(action));
    });

    socket.on('board:roll', () => {
      if (playerId && this.phase === 'board') this.board?.roll(playerId);
    });

    socket.on('mini:input', (msg: { action: string; payload?: unknown }) => {
      if (playerId && this.phase === 'mini') this.mini?.input(playerId, String(asRecord(msg).action), asRecord(msg).payload);
    });

    socket.on('question:add', (text: string, ack?: (r: { ok: boolean; question?: string }) => void) => {
      if (!playerId) return;
      const q = this.questions.add(String(text ?? ''));
      if (typeof ack === 'function') ack({ ok: !!q, question: q ?? undefined });
      this.changed();
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
      } else if (this.phase === 'mini') {
        this.mini?.playerDisconnected(playerId);
      }
      this.ensureVip();
      this.changed();
    });
  }

  // ---------------------------------------------------------------- Ablauf

  private startParty(ids: string[], rounds: number) {
    this.board?.dispose();
    this.board = new Board(ids, rounds, {
      onChange: () => this.changed(),
      startMini: (kind) => this.startMini(kind),
      isConnected: (id) => !!this.players.get(id)?.connected,
      nameOf: (id) => this.nameOf(id),
      connectedCount: () => this.connectedIds().length,
    });
    this.results = null;
    this.phase = 'board';
    this.changed();
  }

  private startMini(kind: MiniKind) {
    this.mini?.dispose();
    const ids = this.connectedIds();
    const ctx: MiniCtx = {
      onChange: () => this.changed(),
      finish: (r) => this.finishMini(kind, r),
      isConnected: (id) => !!this.players.get(id)?.connected,
      nameOf: (id) => this.nameOf(id),
    };
    switch (kind) {
      case 'flunky':
        this.mini = new FlunkyGame(ids, ctx);
        break;
      case 'wwe':
        this.mini = new WweGame(ids, ctx, this.questions.all, DEFAULT_QUESTIONS);
        break;
      case 'sprint':
        this.mini = new SprintGame(ids, ctx);
        break;
      case 'murder':
        this.mini = new MurderGame(ids, ctx);
        break;
    }
    this.results = null;
    this.phase = 'mini';
    this.changed();
  }

  private finishMini(kind: MiniKind, r: MiniResult) {
    this.mini?.dispose();
    this.mini = null;
    const coinsPerGroup = r.coins ?? PLACE_COINS;
    const rows = r.groups.flatMap((group, gi) =>
      group.map((id) => ({
        playerId: id,
        place: gi + 1,
        detail: r.details[id] ?? '',
        coins: coinsPerGroup[Math.min(gi, coinsPerGroup.length - 1)],
      })),
    );
    this.results = { title: MINI_INFO[kind].title, subtitle: r.subtitle, rows, final: false };
    this.phase = 'results';
    this.changed();
  }

  private continueAfterResults() {
    const res = this.results;
    if (!res || res.final || !this.board) return this.backToLobby();
    this.board.afterMini(Object.fromEntries(res.rows.map((row) => [row.playerId, row.coins])));
    if (this.board.finished) {
      this.results = this.finalResults();
      this.phase = 'results';
    } else {
      this.results = null;
      this.phase = 'board';
    }
    this.changed();
  }

  private finalResults(): ResultsState {
    const b = this.board!.state;
    const ids = [...b.order].sort((a, c) => b.cocktails[c] - b.cocktails[a] || b.coins[c] - b.coins[a]);
    let place = 0;
    let prevKey = '';
    const rows = ids.map((id, i) => {
      const key = `${b.cocktails[id]}-${b.coins[id]}`;
      if (key !== prevKey) place = i + 1;
      prevKey = key;
      return { playerId: id, place, detail: `${b.cocktails[id]} Cocktails · ${b.coins[id]} Münzen`, coins: 0 };
    });
    const winner = this.nameOf(ids[0]);
    return { title: 'Urlaubs-Champion', subtitle: `${winner} gewinnt die LAN-Abfahrt!`, rows, final: true };
  }

  private backToLobby() {
    this.mini?.dispose();
    this.mini = null;
    this.board?.dispose();
    this.board = null;
    this.results = null;
    this.phase = 'lobby';
    for (const [id, p] of this.players) if (!p.connected) this.players.delete(id);
    this.ensureVip();
    this.changed();
  }

  // ---------------------------------------------------------------- Helfer

  private connectedIds() {
    return [...this.players.values()].filter((p) => p.connected).map((p) => p.id);
  }

  private nameOf(id: string) {
    return this.players.get(id)?.name ?? '?';
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
      joinUrl: this.joinUrl,
      partyActive: !!this.board,
      board: this.board?.state ?? null,
      mini: this.mini?.snapshot() ?? null,
      results: this.results,
      customQuestionCount: this.questions.all.length,
    };
  }

  /** Bündelt Zustandsänderungen (z. B. viele Taps) zu max. ~25 Updates pro Sekunde. */
  private changed() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.io.emit('state', this.snapshot());
      // Geheime Infos (z. B. Rolle im Mörderspiel) nur an den jeweiligen Spieler
      for (const p of this.players.values()) {
        if (!p.socketId) continue;
        this.io.to(p.socketId).emit('private', this.mini?.privateFor?.(p.id) ?? null);
      }
    }, 40);
  }
}
