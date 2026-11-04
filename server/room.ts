import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import type {
  GameMode,
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
import { DEFAULT_NHIE, DEFAULT_QUESTIONS, DRINK_KINDS, MINI_INFO, PARTY_ROUND_OPTIONS, PLACE_COINS } from '../shared/games';
import { BombGame, HiloGame, NhieGame } from './drinkgames';
import { Bot } from './botclient';
import { SupGame, TidyGame } from './controllergames';
import { Leaderboard } from './leaderboard';
import { ARCADE_POINTS, ARCADE_RANDOM } from '../shared/games';
import { DATE_VERSIONS, HEARTS_PER_CHAPTER } from '../shared/dates';
import { DateRun } from './date';
import { DescentGame } from './descent';
import { RhythmGame } from './rhythm';
import { WrapGame } from './wrap';
import { StarsGame } from './stars';
import { Board } from './board';
import { FlunkyGame } from './flunky';
import { type MiniCtx, type MiniGame, type MiniResult, asRecord } from './minigame';
import { MurderGame } from './murder';
import { QuestionStore } from './questions';
import { SprintGame } from './sprint';
import { WweGame } from './wwe';

const MAX_PLAYERS = 8;
const BOT_NAMES = ['Bot Lena', 'Bot Tobi', 'Bot Jule', 'Bot Ben', 'Bot Mia', 'Bot Finn', 'Bot Ida', 'Bot Max'];
const MIN_PLAYERS = 2;
const MINI_KINDS = Object.keys(MINI_INFO) as MiniKind[];

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
  private dateRun: DateRun | null = null;
  private mode: GameMode = 'party';
  /** Trinkspiel: Gesamtschlücke + zuletzt gespieltes Spiel */
  private drinkRun: { totals: Record<string, number>; last: MiniKind | null; rounds: number } | null = null;
  private nhie = new QuestionStore('nhie.json', 'nhie');
  private results: ResultsState | null = null;
  private questions = new QuestionStore();
  private flushTimer: NodeJS.Timeout | null = null;

  private bots: Bot[] = [];
  private leaderboard = new Leaderboard();
  private arcadeActive = false;
  private lastKind: MiniKind | null = null;

  constructor(
    private io: Server,
    private joinUrl: string,
    private localUrl: string,
  ) {}

  handle(socket: Socket) {
    let playerId: string | null = null;
    const me = () => (playerId ? this.players.get(playerId) : undefined);
    const isVip = () => !!me()?.isVip;
    const inCouple = () => !!playerId && !!this.dateRun?.state.couple.includes(playerId);

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
      if (req.mode === 'random') {
        this.arcadeActive = this.mode === 'arcade';
        return this.startRandom();
      }
      if (req.mode === 'drink') {
        if (ids.length < 2) return socket.emit('toast', 'Mindestens 2 Spieler nötig.');
        this.drinkRun = { totals: Object.fromEntries(ids.map((id) => [id, 0])), last: null, rounds: 0 };
        this.nextDrinkRound();
      } else if (req.mode === 'date') {
        const def = DATE_VERSIONS.find((v) => v.id === req.version) ?? DATE_VERSIONS[0];
        if (ids.length !== 2) return socket.emit('toast', 'Date Night ist für genau 2 Spieler.');
        this.startDate(def.id, [ids[0], ids[1]]);
      } else if (req.mode === 'party') {
        if (ids.length < MIN_PLAYERS) return socket.emit('toast', `Mindestens ${MIN_PLAYERS} Spieler nötig.`);
        const rounds = PARTY_ROUND_OPTIONS.includes(Number(req.rounds)) ? Number(req.rounds) : 5;
        this.startParty(ids, rounds);
      } else if (MINI_KINDS.includes(req.mode as MiniKind)) {
        const kind = req.mode as MiniKind;
        const min = MINI_INFO[kind].minPlayers;
        if (ids.length < min) return socket.emit('toast', `${MINI_INFO[kind].title}: mindestens ${min} Spieler.`);
        this.arcadeActive = this.mode === 'arcade';
        this.startMini(kind);
      }
    });

    socket.on('vip:continue', (action?: string) => {
      if (!(isVip() || inCouple()) || this.phase !== 'results') return;
      if (this.arcadeActive && !this.board && (action === 'random' || action === 'again')) {
        if (action === 'again' && this.lastKind) return this.startMini(this.lastKind);
        return this.startRandom();
      }
      this.continueAfterResults(action === 'end');
    });

    socket.on('time:ping', (t0: number, ack?: (r: { t0: number; server: number }) => void) => {
      if (typeof ack === 'function') ack({ t0, server: Date.now() });
    });

    socket.on('vip:addBot', () => {
      if (!isVip() || this.phase !== 'lobby' || this.players.size >= MAX_PLAYERS) return;
      const used = new Set([...this.players.values()].map((p) => p.name));
      const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.bots.length + 1}`;
      this.bots.push(new Bot(name, { url: this.localUrl }));
    });

    socket.on('vip:resetLeaderboard', () => {
      if (!isVip() || this.phase !== 'lobby') return;
      this.leaderboard.reset();
      this.changed();
    });

    socket.on('vip:removeBots', () => {
      if (!isVip() || this.phase !== 'lobby') return;
      for (const b of this.bots) b.stop();
      this.bots = [];
    });

    socket.on('vip:mode', (mode: string) => {
      if (isVip() && this.phase === 'lobby' && (mode === 'party' || mode === 'date' || mode === 'drink' || mode === 'arcade')) {
        this.mode = mode;
        this.changed();
      }
    });

    socket.on('story:next', () => {
      if (this.phase !== 'story' || !this.dateRun || !(isVip() || inCouple())) return;
      const next = this.dateRun.next();
      if (next === 'end') this.backToLobby();
      else if (next) this.startMini(next);
      else this.changed();
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

    socket.on('question:add', (text: string, ack?: (r: { ok: boolean; question?: string }) => void, kind?: string) => {
      if (!playerId) return;
      const store = kind === 'nhie' ? this.nhie : this.questions;
      const q = store.add(String(text ?? ''));
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

  private startDate(version: string, couple: [string, string]) {
    const def = DATE_VERSIONS.find((v) => v.id === version) ?? DATE_VERSIONS[0];
    this.dateRun = new DateRun(def, couple, [this.nameOf(couple[0]), this.nameOf(couple[1])]);
    this.results = null;
    this.phase = 'story';
    this.changed();
  }

  /** Zufälliges Spiel, das zur Spielerzahl passt und nicht gerade dran war */
  private startRandom() {
    const n = this.connectedIds().length;
    const pool = ARCADE_RANDOM.filter((k) => MINI_INFO[k].minPlayers <= n && k !== this.lastKind);
    const kind = pool[Math.floor(Math.random() * pool.length)] ?? 'sprint';
    this.startMini(kind);
  }

  private startMini(kind: MiniKind) {
    this.mini?.dispose();
    this.lastKind = kind;
    const ids = this.dateRun ? this.dateRun.state.couple.filter((id) => this.players.has(id)) : this.connectedIds();
    const ctx: MiniCtx = {
      onChange: () => this.changed(),
      finish: (r) => this.finishMini(kind, r),
      isConnected: (id) => !!this.players.get(id)?.connected,
      nameOf: (id) => this.nameOf(id),
      mode: this.dateRun ? 'date' : this.drinkRun ? 'drink' : this.mode,
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
      case 'descent':
        this.mini = new DescentGame(ids, ctx);
        break;
      case 'rhythm':
        this.mini = new RhythmGame(ids, ctx);
        break;
      case 'wrap':
        this.mini = new WrapGame(ids, ctx);
        break;
      case 'stars':
        this.mini = new StarsGame(ids, ctx);
        break;
      case 'nhie':
        this.mini = new NhieGame(ids, ctx, this.nhie.all, DEFAULT_NHIE);
        break;
      case 'hilo':
        this.mini = new HiloGame(ids, ctx);
        break;
      case 'bomb':
        this.mini = new BombGame(ids, ctx);
        break;
      case 'sup':
        this.mini = new SupGame(ids, ctx);
        break;
      case 'tidy':
        this.mini = new TidyGame(ids, ctx);
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
    const hearts = r.hearts !== undefined ? { hearts: r.hearts, maxHearts: HEARTS_PER_CHAPTER } : {};
    if (r.hearts !== undefined || r.sips) for (const row of rows) row.coins = 0;
    if (r.sips && this.drinkRun) {
      for (const [id, n] of Object.entries(r.sips)) this.drinkRun.totals[id] = (this.drinkRun.totals[id] ?? 0) + n;
      Object.assign(hearts, { sips: r.sips });
    }
    this.results = { title: MINI_INFO[kind].title, subtitle: r.subtitle, rows, final: false, ...hearts };
    if (this.arcadeActive) this.scoreArcade(kind, r);
    this.phase = 'results';
    this.changed();
  }

  /** Arcade: Punkte nach Platzierung verteilen und dauerhaft speichern */
  private scoreArcade(kind: MiniKind, r: MiniResult) {
    // Trinkspiele: wer am wenigsten trinken musste, gewinnt
    const groups = r.sips ? [...r.groups].reverse() : r.groups;
    // Gemeinsame Spiele (nur eine Gruppe): Herzen bzw. feste Punkte für alle
    const coop = groups.length === 1;
    const points: Record<string, number> = {};
    groups.forEach((g, gi) => {
      for (const id of g) points[id] = coop ? (r.hearts ?? ARCADE_POINTS[1]) : ARCADE_POINTS[Math.min(gi, ARCADE_POINTS.length - 1)];
    });
    for (const [id, pts] of Object.entries(points)) {
      const won = !coop && groups[0].includes(id);
      this.leaderboard.add(this.nameOf(id), kind, pts, won);
    }
    this.leaderboard.save();
    if (this.results) {
      this.results.arcade = points;
      // Reihenfolge und Plätze nach Arcade-Punkten (wichtig bei Trinkspielen)
      const place = new Map<string, number>();
      groups.forEach((g, gi) => g.forEach((id) => place.set(id, gi + 1)));
      this.results.rows = this.results.rows
        .map((row) => ({ ...row, coins: 0, place: place.get(row.playerId) ?? row.place }))
        .sort((x, y) => x.place - y.place);
    }
  }

  private nextDrinkRound() {
    const run = this.drinkRun!;
    const pool = DRINK_KINDS.filter((k) => k !== run.last);
    const kind = pool[Math.floor(Math.random() * pool.length)];
    run.last = kind;
    run.rounds += 1;
    this.startMini(kind);
  }

  private continueAfterResults(end = false) {
    const res = this.results;
    if (this.drinkRun && res) {
      if (res.final) return this.backToLobby();
      if (!end) return this.nextDrinkRound();
      const t = this.drinkRun.totals;
      const ids = Object.keys(t).sort((a, b) => t[b] - t[a]);
      this.results = {
        title: 'Schluck-Statistik',
        subtitle: `${this.drinkRun.rounds} Runden gespielt – trinkt Wasser zwischendurch!`,
        rows: ids.map((id, i) => ({ playerId: id, place: i + 1, detail: `${t[id]} Schlücke`, coins: 0 })),
        final: true,
        sips: t,
      };
      return this.changed();
    }
    if (this.dateRun && res && !res.final) {
      this.dateRun.recordHearts(res.hearts ?? 0);
      this.results = null;
      this.phase = 'story';
      return this.changed();
    }
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
    this.dateRun = null;
    this.drinkRun = null;
    this.arcadeActive = false;
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
      mode: this.mode,
      date: this.dateRun?.state ?? null,
      drinkActive: !!this.drinkRun,
      customNhieCount: this.nhie.all.length,
      botCount: this.bots.length,
      leaderboard: this.leaderboard.list,
      arcadeActive: this.arcadeActive,
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
