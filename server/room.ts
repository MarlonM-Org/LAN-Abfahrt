import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import type {
  GameLive,
  GameMeta,
  GameMode,
  HostInfo,
  IntroState,
  JoinRequest,
  JoinResponse,
  KickResponse,
  MiniKind,
  MiniSnapshot,
  MiniTeams,
  Phase,
  PlayerPublic,
  NochmalState,
  PrivateState,
  ResultsState,
  ServerHello,
  StartRequest,
  TurnierState,
} from '../shared/types';
import { sanitizeLook } from '../shared/avatar';
import { freePlayerColor } from '../shared/players';
import { DEFAULT_NHIE, DEFAULT_QUESTIONS, DRINK_KINDS, MINI_INFO, PARTY_ROUND_OPTIONS, groupPlaces, isWarmupKind, placeCoins, teamLabel } from '../shared/games';
import { BombGame, HiloGame, NhieGame } from './drinkgames';
import { KingsCupGame } from './kingscup';
import { Bot } from './botclient';
import { SupGame, TidyGame } from './controllergames';
import { KurveGame } from './kurve';
import { ArenaGame } from './arena';
import { BowlingGame } from './bowling';
import { BouleGame } from './boule';
import { GolfGame } from './golf';
import { EntenGame } from './enten';
import { ParcoursGame } from './parcours';
import { KartGame } from './kart';
import { TurmGame } from './turm';
import { IgelGame } from './igel';
import { SmashGame } from './smash';
import { Leaderboard } from './leaderboard';
import { SessionBoard } from './session';
import { ARCADE_COOP_POINTS, ARCADE_RANDOM, COCKTAIL_PRICE, TURNIER_CUSTOM, TURNIER_KINDS, TURNIER_PLAYLISTS, arcadePoints, fitsPlayers, seriesLabel } from '../shared/games';
import { KART_TRACKS } from '../shared/kart';
import { clockTimeOfDay } from '../shared/daytime';
import { WasserGame } from './wasser';
import { GrillGame } from './grill';
import { FangenGame } from './fangen';
import { DATE_VERSIONS, HEARTS_PER_CHAPTER } from '../shared/dates';
import { DateRun } from './date';
import { DescentGame } from './descent';
import { RhythmGame } from './rhythm';
import { WrapGame } from './wrap';
import { StarsGame } from './stars';
import { Board, type PartySave, partyResumeInfo, resumeSave } from './board';
import { FlunkyGame } from './flunky';
import { GeistGame } from './geist';
import { SumoGame } from './sumo';
import { BogenGame } from './bogen';
import { ZauberGame } from './zauber';
import { DartsGame } from './darts';
import { AutoballGame } from './autoball';
import { VolleyGame } from './volley';
import { type MiniCtx, type MiniGame, type MiniResult, PRACTICE_OUT_MS, asRecord, splitTeams } from './minigame';
import { MurderGame } from './murder';
import { QuestionStore } from './questions';
import { SprintGame } from './sprint';
import { SkisprungGame } from './skisprung';
import { TeppichGame } from './teppich';
import { KugelGame } from './kugel';
import { type BalanceKind, isBalanceKind, parseSample } from '../shared/balance';
import { Records } from './records';
import { TttGame } from './ttt';
import { WweGame } from './wwe';
import { FliegerGame } from './flieger';
import { VersteckGame } from './verstecken';
import { SpionGame } from './spion';
import { StillepostGame } from './stillepost';
import { isLaptop, viaProxy } from './net';
import { TouristGame } from './tourist';
import { WerwolfGame } from './werwolf';
import { WolfrundeGame } from './wolfrunde';
import { reviewedKinds } from './reviewed';
import { SpruecheGame } from './sprueche';
import { PixelGame } from './pixel';
import { WpistoleGame } from './wpistole';
import { AngelnGame } from './angeln';
import { SektGame } from './sekt';
import { KofferGame } from './koffer';
import { WackelGame } from './wackel';
import { SuessGame } from './suess';
import { UmzugGame } from './umzug';
import { FunkGame } from './funk';
import { SchaetzGame } from './schaetz';
import { LiederGame } from './lieder';
import { liederTon } from './liederton';
import { MaexGame } from './maexchen';
import { WerwarsGame } from './werwars';
import { KickList, OFFLINE_REMOVE_MS } from './players';
import { EmoteFeed } from './spectator';
import { FxLog } from './fx';

const MAX_PLAYERS = 12;
const BOT_NAMES = ['Bot Lena', 'Bot Tobi', 'Bot Jule', 'Bot Ben', 'Bot Mia', 'Bot Finn', 'Bot Ida', 'Bot Max', 'Bot Ela', 'Bot Jan', 'Bot Pia', 'Bot Ole'];
const MIN_PLAYERS = 2;
const MINI_KINDS = Object.keys(MINI_INFO) as MiniKind[];
/** Ändert sich bei jedem Serverstart – Handys/TV laden dann neu (sonst läuft dort evtl. noch alter Code) */
const BOOT_ID = randomUUID();
/** So lange bleibt ein weggegangenes Handy (App gewechselt, Bildschirm aus) Spieler + VIP. */
const VIP_GRACE_MS = Number(process.env.VIP_GRACE_MS ?? 60_000);
/** Wartet ein Schritt auf den VIP, aber kein Mensch kann ihn auslösen → automatisch weiter. */
const AUTO_RESULTS_MS = Number(process.env.AUTO_CONTINUE_MS ?? 12_000);
const AUTO_STORY_MS = 10_000;
const AUTO_MINI_MS = 5_000;
/** Kurzer Wackler (WLAN-Loch, App kurz gewechselt): so lange merkt das laufende Spiel nichts davon */
const DISCONNECT_GRACE_MS = 3_000;
/** Gehaltene Eingaben (Stick & Co.) schickt das Handy alle 250–500 ms neu – bleiben sie so lange aus, gilt „losgelassen“ */
const HOLD_TIMEOUT_MS = 700;
/** Mindestabstand zwischen zwei Sendungen – unter dem 33-ms-Takt der 30-Hz-Spiele, damit kein Stand verloren geht */
const FLUSH_MS = 30;

/**
 * Gehaltene Eingaben, die ohne Nachschub auf „neutral“ fallen (z. B. Handy gesperrt, während der Daumen
 * auf dem Stick lag). Nur Aktionen, deren Handy-Screen regelmäßig wiederholt (Keepalive < 700 ms):
 * Stick (Fix-Pad 300 ms, schwebender Stick 250 ms), Kart/Autoball-Lenkung (300 ms),
 * Kurven-Duell `turn` (400 ms), Volleyball `move` (500 ms). Igel `move` wiederholt nicht → nicht dabei.
 */
function holdRelease(kind: MiniKind, action: string, payload: unknown): { active: boolean; neutral: unknown } | null {
  const pl = asRecord(payload);
  const num = (v: unknown) => Number(v) || 0;
  if (action === 'stick') return { active: num(pl.x) !== 0 || num(pl.y) !== 0, neutral: { x: 0, y: 0 } };
  if (action === 'steer' && (kind === 'kart' || kind === 'autoball')) {
    return {
      active: num(pl.x) !== 0 || pl.gas === true || pl.brake === true || pl.drift === true || pl.boost === true,
      neutral: { x: 0, gas: false, brake: false, drift: false, boost: false },
    };
  }
  if ((action === 'turn' && kind === 'kurve') || (action === 'move' && kind === 'volley')) return { active: num(pl.dir) !== 0, neutral: { dir: 0 } };
  return null;
}

/** Nur Bots da und ein Spiel wartet auf eine Eingabe, die nie kommt (z. B. Werwölfe uneinig) → so lange warten, dann überspringen */
const AUTO_SKIP_MS = 60_000;

/** Aufwärmrunde: in diesen Spielphasen wird geprüft, ob ein Mensch ausgeschieden ist (Countdown, Rundenende … regelt das Spiel selbst) */
const PRACTICE_LIVE_SUBS = new Set(['play', 'fight', 'race']);

/**
 * Aufwärmrunde, Rückfall-Lösung für Spiele ohne eigenes Respawn: Ist einer der `humans` gerade raus?
 * Liest `players[id].alive === false` bzw. Smash `fighters[id].state === 'out'` aus dem Snapshot.
 */
function practiceOut(snap: MiniSnapshot, humans: string[]): boolean {
  const st = snap.state as unknown as Record<string, unknown>;
  if (typeof st.sub !== 'string' || !PRACTICE_LIVE_SUBS.has(st.sub)) return false;
  const list = (st.players ?? st.fighters) as Record<string, { alive?: unknown; state?: unknown } | undefined> | undefined;
  if (!list || typeof list !== 'object') return false;
  return humans.some((id) => {
    const p = list[id];
    return !!p && typeof p === 'object' && (p.alive === false || p.state === 'out');
  });
}

export type HostCommand = 'abort' | 'continue' | 'removeBots' | 'again' | 'menu' | 'resetSession' | 'board' | 'skip';

interface Player extends PlayerPublic {
  socketId: string | null;
  joinedAt: number;
  /** Seit wann ununterbrochen verbunden (für die VIP-Nachfolge) */
  connectedSince: number;
  /** Zeitpunkt der letzten Trennung (0 = verbunden) */
  disconnectedAt: number;
  isBot?: boolean;
  /** Kart-Rennen: eigene Verfolger-Ansicht am Handy statt im TV-Splitscreen (vom Handy gespeichert) */
  kartView?: 'phone' | 'tv';
}

/**
 * Start-Optionen eines Minispiels: Kart-Strecke („Nochmal“ fährt die nächste), feste Teams vom Spielbrett,
 * Teams der Aufwärmrunde (gelten auch fürs echte Spiel)
 */
type MiniOpts = { track?: number; teams?: MiniTeams | null; warmTeams?: MiniTeams | null };

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
  private posts = new QuestionStore('stillepost.json', 'post');
  private quips = new QuestionStore('sprueche.json', 'quip');
  private werwarsQ = new QuestionStore('werwars.json', 'werwars');
  private flushTimer: NodeJS.Timeout | null = null;
  private lastFlush = 0;
  /** Zuletzt gesendetes `meta` (als Vergleichs-Schlüssel) – neu senden nur bei Änderung */
  private metaKey = '';
  /** Socket-ID → zuletzt gesendetes `private` (JSON) – unverändert wird nicht nochmal geschickt */
  private privKeys = new Map<string, string>();
  /** Spieler-ID → Timer der Gnadenfrist (playerDisconnected erst nach DISCONNECT_GRACE_MS) */
  private graceTimers = new Map<string, NodeJS.Timeout>();
  /** Gehaltene Eingaben: `${Spieler}|${Aktion}` → wann zuletzt gekommen */
  private holds = new Map<string, { id: string; action: string; at: number; neutral: unknown }>();

  private bots: Bot[] = [];
  /** Ewige Tabelle (data/arcade.json) */
  private leaderboard = new Leaderboard();
  /** Bestleistungen der Board-Spiele (Weite, Zeiten) über alle Abende */
  private records = new Records();
  /** Leaderboard des Abends (nur im Speicher) */
  private session = new SessionBoard();
  /** Lobby: Leaderboard des Abends groß auf dem TV zeigen (VIP-Handy oder Laptop-Taste L) */
  private showBoard = false;
  /** Laufendes/letztes Spiel ist ein Einzelspiel aus der Lobby (Arcade, Laptop-Auswahl, Einzelspiel-Liste) → Punkte + „Nochmal“ */
  private singleActive = false;
  /** Einzelspiel im Arcade-Modus gestartet (VIP-Handy bietet zusätzlich „Zufälliges Spiel“ an) */
  private arcadeActive = false;
  /** Kart-Rennen: zuletzt gefahrene Strecke – „Nochmal“ fährt die nächste (wie ein Grand Prix) */
  private lastKartTrack: number | null = null;
  /** Arcade „Alle dürfen wählen“: Spieler-ID → Wunschspiel (null = Abstimmung aus, nur der VIP wählt) */
  private arcadeVotes: Map<string, MiniKind> | null = null;
  private lastKind: MiniKind | null = null;
  /** Wer im laufenden Minispiel mitspielt */
  private miniIds: string[] | null = null;
  /** Laufende Nummer der Minispiel-Instanz (Übungsrunden + echte Spiele) → `GameLive.miniSeq` */
  private miniSeq = 0;
  /** Vorgegebene Teams des laufenden Minispiels (Spielbrett: nach Feldfarbe), sonst null */
  private miniTeams: MiniTeams | null = null;
  /** Gekickte Spieler-IDs (Handy mit alter ID bekommt „Du wurdest entfernt“) */
  private kicks = new KickList();
  /** Zuschauer-Emotes (😂 😱 👏 🍅) – für alle Spiele, unabhängig vom Minispiel */
  private emotes = new EmoteFeed();
  /** Ereignisprotokoll des Abends → „Titel des Abends“ (server/fx.ts); leert sich mit dem Leaderboard des Abends */
  private fx = new FxLog();
  /** Laufende Siegesserie pro Spieler (Minispiele in Folge gewonnen) */
  private streaks = new Map<string, number>();
  /** Münzstand des Bretts beim letzten Flush – Unterschiede gehen als coingain/coinloss ins Protokoll */
  private boardCoins: { coins: Record<string, number>; cocktails: Record<string, number> } | null = null;
  /** Turnier: Playlist, Fortschritt (Zwischenstand in `turnierBoard`) */
  private turnier: { playlist: string; name: string; icon: string; kinds: MiniKind[]; index: number; played: number } | null = null;
  /** Zwischenstand des Turniers – dieselbe Tabelle wie das Leaderboard des Abends, nur für diese Playlist */
  private turnierBoard = new SessionBoard();
  private offlineBucket = '';
  /** Gastgeber = erster Mensch, der beigetreten ist. Kommt er zurück, ist er wieder VIP. */
  private hostId: string | null = null;
  /** Worauf gerade gewartet wird (Ergebnis, Story-Karte, …) und seit wann – für das Auto-Weiter */
  private gateKey: unknown = null;
  private gateSince = 0;
  /** Dasselbe für überspringbare Schritte (Zug, Phase, Info-Screen), wenn kein Mensch überspringen kann */
  private skipKey = '';
  private skipSince = 0;
  /** Online-Adresse (Cloudflare-Tunnel), sobald bekannt – Handys bieten sie in der Lobby zum Teilen an */
  private onlineUrl: string | null = null;

  constructor(
    private io: Server,
    private joinUrl: string,
    private localUrl: string,
  ) {
    setInterval(() => this.tick(), 1000).unref();
    setInterval(() => this.releaseStaleHolds(), 100).unref();
  }

  /** Tunnel steht (bzw. ist weg) → per `meta` an alle */
  setOnlineUrl(url: string | null) {
    if (url === this.onlineUrl) return;
    this.onlineUrl = url;
    this.changed();
  }

  handle(socket: Socket) {
    let playerId: string | null = null;
    const me = () => (playerId ? this.players.get(playerId) : undefined);
    const isVip = () => !!me()?.isVip;
    const inCouple = () => !!playerId && !!this.dateRun?.state.couple.includes(playerId);

    socket.emit('server:hello', { boot: BOOT_ID, kinds: MINI_KINDS } satisfies ServerHello);
    // Einmal komplett: seltene Daten (meta) + laufender Zustand – danach kommen nur noch Änderungen
    socket.emit('meta', this.meta());
    socket.emit('state', this.live());

    // Steuerung am Laptop (TV-Seite): nur von Verbindungen, die vom Laptop selbst kommen – nicht über den Online-Tunnel
    const local = isLaptop(socket.handshake);
    const online = viaProxy(socket.handshake.headers);
    socket.on('host:hello', () => {
      socket.join('hosts');
      socket.emit('host:info', { local, online } satisfies HostInfo);
      socket.emit('meta', this.meta());
      socket.emit('state', this.live());
    });

    // Laptop: Spiel aus der Arcade-Auswahl (Taste A) starten – gleiche Rechte wie die übrige Laptop-Steuerung
    socket.on('host:start', (kind: unknown, ack?: (r: { ok: boolean; msg?: string }) => void) => {
      const reply = (r: { ok: boolean; msg?: string }) => typeof ack === 'function' && ack(r);
      if (!local) return reply({ ok: false, msg: 'Nur direkt am Laptop erlaubt.' });
      reply(this.hostStart(String(kind ?? '')));
    });

    // Balance Board am Laptop (WebHID bzw. Pfeiltasten-Ersatz): Messwerte für das laufende Board-Spiel
    socket.on('bb:sample', (raw: unknown) => {
      if (!local || this.phase !== 'mini' || !this.mini?.balance) return;
      const s = parseSample(raw);
      if (s) this.mini.balance(s);
    });

    // TV → laufendes Minispiel (z. B. Guess the Song: „Ton geladen“) – nur von TV-Seiten im Heimnetz
    socket.on('host:mini', (action: unknown, payload?: unknown) => {
      if (online || !socket.rooms.has('hosts') || this.phase !== 'mini' || !this.mini?.hostInput) return;
      this.mini.hostInput(String(action ?? ''), payload);
    });

    socket.on('host:cmd', (cmd: string, ack?: (r: { ok: boolean; msg?: string }) => void) => {
      const reply = (r: { ok: boolean; msg?: string }) => typeof ack === 'function' && ack(r);
      if (!local) return reply({ ok: false, msg: 'Nur direkt am Laptop erlaubt.' });
      reply(this.hostCommand(cmd as HostCommand));
    });

    socket.on('player:join', (msg: JoinRequest, ack?: (r: JoinResponse) => void) => {
      const reply = (r: JoinResponse) => typeof ack === 'function' && ack(r);
      const name = String(msg?.name ?? '').trim().slice(0, 12);
      if (!name) return reply({ ok: false, error: 'Bitte gib einen Namen ein.' });

      const now = Date.now();
      let p = msg.playerId ? this.players.get(msg.playerId) : undefined;
      if (p?.removed || (!p && this.kicks.has(msg.playerId))) {
        return reply({ ok: false, kicked: true, error: 'Du wurdest aus der Runde entfernt.' });
      }
      if (!p) {
        // Im Ergebnis eines Einzelspiels darf man dazukommen – bei „Nochmal“ geht es sonst nie zurück in die Lobby
        // Party: Nachzügler dürfen jederzeit rein und steigen zur nächsten Brett-Runde ein
        if (this.phase !== 'lobby' && !(this.phase === 'results' && this.singleActive) && !this.board) {
          return reply({ ok: false, error: 'Gerade läuft ein Spiel – du bist ab der nächsten Runde dabei!' });
        }
        // Gleicher Name, alte ID offline (z. B. Browserdaten gelöscht) → alten grauen Eintrag ersetzen
        for (const [id, o] of this.players) if (!o.connected && o.name.toLowerCase() === name.toLowerCase()) this.players.delete(id);
        if (this.players.size >= MAX_PLAYERS) this.evictOffline();
        if (this.players.size >= MAX_PLAYERS) {
          return reply({ ok: false, error: `Lobby ist voll (max. ${MAX_PLAYERS}).` });
        }
        // Bekannte ID vom Handy weiterverwenden (z. B. nach langer Pause) – so erkennt der Raum den Gastgeber wieder
        const reuse = msg.bot !== true && typeof msg.playerId === 'string' && /^[0-9a-f-]{36}$/i.test(msg.playerId);
        const id = reuse ? msg.playerId! : randomUUID();
        // Spielerfarbe des Abends: erste freie – bleibt an der ID, solange der Spieler im Raum ist
        const color = freePlayerColor([...this.players.values()].map((o) => o.color));
        p = { id, name, look: sanitizeLook(msg.look), color, connected: false, isVip: false, socketId: null, joinedAt: now, connectedSince: now, disconnectedAt: 0 };
        this.players.set(p.id, p);
      }
      p.name = name;
      p.look = sanitizeLook(msg.look);
      p.socketId = socket.id;
      if (!p.connected) p.connectedSince = now;
      p.connected = true;
      p.disconnectedAt = 0;
      this.clearGrace(p.id);
      p.isBot = msg.bot === true;
      if (msg.kartView === 'phone' || msg.kartView === 'tv') p.kartView = msg.kartView;
      if (!p.isBot && !this.hostId) this.hostId = p.id;
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
        this.markSingle();
        return this.startRandom();
      }
      if (req.mode === 'drink') {
        if (ids.length < 2) return socket.emit('toast', 'Mindestens 2 Spieler nötig.');
        this.session.endSeries();
        this.drinkRun = { totals: Object.fromEntries(ids.map((id) => [id, 0])), last: null, rounds: 0 };
        this.nextDrinkRound();
      } else if (req.mode === 'date') {
        const def = DATE_VERSIONS.find((v) => v.id === req.version) ?? DATE_VERSIONS[0];
        if (ids.length !== 2) return socket.emit('toast', 'Date Night ist für genau 2 Spieler.');
        this.startDate(def.id, [ids[0], ids[1]]);
      } else if (req.mode === 'party') {
        if (ids.length < MIN_PLAYERS) return socket.emit('toast', `Mindestens ${MIN_PLAYERS} Spieler nötig.`);
        // Gespeicherten Brettstand (data/party.json) fortsetzen – Spieler werden über ID bzw. Namen wiedererkannt
        const from = req.resume === true ? resumeSave(ids.map((id) => ({ id, name: this.nameOf(id) }))) : undefined;
        if (from === null) return socket.emit('toast', 'Keine passende gespeicherte Party gefunden.');
        const rounds = PARTY_ROUND_OPTIONS.includes(Number(req.rounds)) ? Number(req.rounds) : 5;
        this.startParty(ids, rounds, req.longGames === true, from ?? undefined);
      } else if (req.mode === 'turnier') {
        const err = this.startTurnier(req);
        if (err) socket.emit('toast', err);
      } else if (req.mode === 'top' || req.mode === 'favorites') {
        const kind = this.votedKind(req.mode);
        if (!kind) return socket.emit('toast', 'Noch keine (passenden) Stimmen.');
        const err = this.startSingle(kind);
        if (err) socket.emit('toast', err);
      } else if (MINI_KINDS.includes(req.mode as MiniKind)) {
        const err = this.startSingle(req.mode as MiniKind);
        if (err) socket.emit('toast', err);
      }
    });

    // Arcade: VIP schaltet „Alle dürfen wählen“ an/aus
    socket.on('vip:arcadeVote', (on: unknown) => {
      if (!isVip() || this.phase !== 'lobby') return;
      this.arcadeVotes = on ? (this.arcadeVotes ?? new Map()) : null;
      this.changed();
    });

    // Arcade: Spieler stimmt für ein Spiel (nochmal dasselbe / null = Stimme zurückziehen)
    socket.on('arcade:vote', (raw: unknown) => {
      if (!playerId || this.phase !== 'lobby' || this.mode !== 'arcade' || !this.arcadeVotes) return;
      const kind = typeof raw === 'string' && MINI_KINDS.includes(raw as MiniKind) ? (raw as MiniKind) : null;
      if (!kind || this.arcadeVotes.get(playerId) === kind) this.arcadeVotes.delete(playerId);
      else if (!fitsPlayers(kind, this.connectedIds().length)) return socket.emit('toast', this.fitError(kind) ?? 'Passt gerade nicht.');
      else this.arcadeVotes.set(playerId, kind);
      this.changed();
    });

    // Regelkarte: „Bereit!“ vom Handy (Bots sofort)
    socket.on('intro:ready', () => {
      if (playerId) this.introReady(playerId);
    });

    socket.on('vip:continue', (action?: string) => {
      // Regelkarte: VIP startet sofort („▶ Jetzt starten“), ohne auf alle zu warten
      if (this.phase === 'intro') return void (isVip() && this.introGo());
      if (!(isVip() || inCouple()) || this.phase !== 'results') return;
      if (this.singleResults()) {
        if (action === 'again') {
          const err = this.nochmal();
          if (err) socket.emit('toast', err);
          return;
        }
        if (action === 'random') return this.startRandom();
        // sonst („Anderes Spiel“): zurück zur Auswahl in der Lobby
        return this.backToLobby();
      }
      this.continueAfterResults(action === 'end');
    });

    socket.on('time:ping', (t0: number, ack?: (r: { t0: number; server: number }) => void) => {
      if (typeof ack === 'function') ack({ t0, server: Date.now() });
    });

    socket.on('vip:addBot', () => {
      if (!isVip() || this.phase !== 'lobby' || this.connectedIds().length >= MAX_PLAYERS) return;
      const used = new Set([...this.players.values()].map((p) => p.name));
      const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.bots.length + 1}`;
      this.bots.push(new Bot(name, { url: this.localUrl }));
    });

    // Ewige Tabelle (alle Abende) löschen
    socket.on('vip:resetLeaderboard', () => {
      if (!isVip() || this.phase !== 'lobby') return;
      this.leaderboard.reset();
      this.changed();
    });

    // Leaderboard des Abends zurücksetzen (Lobby oder Ergebnis – nicht mitten im Spiel)
    socket.on('vip:resetSession', () => {
      if (!isVip() || (this.phase !== 'lobby' && this.phase !== 'results')) return;
      this.resetSession();
    });

    // Leaderboard des Abends auf dem TV ein-/ausblenden (Lobby)
    socket.on('vip:showBoard', (on: unknown) => {
      if (!isVip() || this.phase !== 'lobby') return;
      this.showBoard = !!on;
      this.changed();
    });

    socket.on('vip:removeBots', () => {
      if (!isVip() || this.phase !== 'lobby') return;
      for (const b of this.bots) b.stop();
      this.bots = [];
    });

    socket.on('vip:mode', (mode: string) => {
      if (isVip() && this.phase === 'lobby' && (mode === 'party' || mode === 'date' || mode === 'drink' || mode === 'arcade' || mode === 'turnier')) {
        this.mode = mode;
        this.arcadeVotes?.clear();
        this.changed();
      }
    });

    socket.on('story:next', () => {
      if (this.phase !== 'story' || !this.dateRun || !(isVip() || inCouple())) return;
      this.storyNext();
    });

    socket.on('vip:lobby', () => {
      if (isVip()) this.backToLobby();
    });

    socket.on('vip:mini', (action: string) => {
      if (isVip() && this.phase === 'mini') this.mini?.vipAction?.(String(action));
    });

    // VIP-Menü am Handy: Zug/Phase überspringen (gleiche Logik wie Taste S am Laptop)
    socket.on('vip:skip', (ack?: (r: { ok: boolean; msg?: string }) => void) => {
      const reply = (r: { ok: boolean; msg?: string }) => typeof ack === 'function' && ack(r);
      if (!isVip()) return reply({ ok: false, msg: 'Nur der VIP darf überspringen.' });
      reply(this.skipCurrent());
    });

    // Kart-Rennen: jeder Spieler wählt selbst, ob seine Verfolger-Ansicht auf dem TV oder dem Handy läuft (gilt auch für spätere Rennen)
    socket.on('kart:view', (view: string) => {
      const p = playerId ? this.players.get(playerId) : undefined;
      if (!p) return;
      p.kartView = view === 'phone' ? 'phone' : 'tv';
      const game = this.liveGame();
      if (game instanceof KartGame) game.setPhoneView(p.id, p.kartView === 'phone');
    });

    socket.on('board:roll', () => {
      if (playerId && this.phase === 'board') this.board?.roll(playerId);
    });
    // Brett-Entscheidungen: Item vor dem Würfeln, Antwort auf Bar/Laden/Gabelung, geheime Duell-Wahl
    socket.on('board:item', () => {
      if (playerId && this.phase === 'board') this.board?.useItem(playerId);
    });
    socket.on('board:answer', (msg: { seq: number; choice?: unknown }) => {
      if (playerId && this.phase === 'board') this.board?.answer(playerId, Number(asRecord(msg).seq), asRecord(msg).choice);
    });
    socket.on('board:duel', (msg: { seq: number; pick?: unknown }) => {
      if (playerId && this.phase === 'board') this.board?.duelPick(playerId, Number(asRecord(msg).seq), asRecord(msg).pick);
    });

    // Eingaben ans laufende Minispiel – in der Aufwärmrunde (Phase `intro`) ans Übungsspiel, dort ohne Wetten
    socket.on('mini:input', (msg: { action: string; payload?: unknown }) => {
      const game = this.liveGame();
      if (!playerId || !game) return;
      const action = String(asRecord(msg).action);
      const payload = asRecord(msg).payload;
      if (this.phase === 'intro' && action === 'bet') return;
      this.trackHold(playerId, game.kind, action, payload);
      game.input(playerId, action, payload);
    });

    // Zuschauer-Emotes: generisch für alle Spiele (das Minispiel merkt davon nichts), 2 s Abklingzeit pro Spieler
    socket.on('emote', (i: unknown) => {
      if (playerId && this.players.has(playerId) && this.emotes.add(playerId, i)) this.changed();
    });

    // Eigene Frage/Aussage aus der Lobby. Socket.IO liefert den Ack-Callback immer als LETZTES Argument –
    // deshalb (text, kind, ack); ein älteres Handy ohne `kind` schickt (text, ack) und bekommt trotzdem eine Antwort.
    socket.on('question:add', (text: string, kindOrAck?: unknown, maybeAck?: unknown) => {
      if (!playerId) return;
      const kind = typeof kindOrAck === 'string' ? kindOrAck : undefined;
      const ack = typeof maybeAck === 'function' ? maybeAck : typeof kindOrAck === 'function' ? kindOrAck : null;
      const store = kind === 'nhie' ? this.nhie : kind === 'post' ? this.posts : kind === 'quip' ? this.quips : kind === 'werwars' ? this.werwarsQ : this.questions;
      const q = store.add(String(text ?? ''));
      if (ack) (ack as (r: { ok: boolean; question?: string }) => void)({ ok: !!q, question: q ?? undefined });
      this.changed();
    });

    socket.on('player:leave', () => {
      if (playerId && this.phase === 'lobby') {
        this.players.delete(playerId);
        if (this.hostId === playerId) this.hostId = null;
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
      p.disconnectedAt = Date.now();
      if (this.phase === 'lobby') {
        // Menschen bleiben eine Weile (grau, „offline seit …“) in der Lobby – aufgeräumt wird in tick()
        if (p.isBot) this.players.delete(playerId);
      } else if (this.connectedIds().length === 0 && !this.anyHumanInGrace()) {
        // Alle Handys endgültig weg → sonst hängt das Spiel fest und niemand kann neu beitreten.
        // (Sind Menschen nur kurz weg, z. B. App gewechselt, wartet der Raum – siehe tick().)
        return this.backToLobby();
      } else if (this.phase === 'mini' || this.phase === 'board' || this.phase === 'intro') {
        // Gnadenfrist: Kommt das Handy innerhalb von 3 s zurück (WLAN-Wackler), merkt das Spiel nichts
        this.startGrace(playerId);
      }
      this.ensureVip();
      this.changed();
    });

    this.handleKicks(socket, () => playerId);
  }

  // ---------------------------------------------------------------- Ablauf

  private startParty(ids: string[], rounds: number, longGames = false, from?: PartySave) {
    this.session.endSeries();
    this.board?.dispose();
    this.board = new Board(ids, rounds, {
      onChange: () => this.changed(),
      startMini: (kind, teams) => this.startMini(kind, teams ? { teams } : undefined),
      isConnected: (id) => this.inPlay(id),
      nameOf: (id) => this.nameOf(id),
      connectedCount: () => this.gameIds().length,
      isGone: (id) => !!this.players.get(id)?.removed,
      // Nachzügler steigen zur nächsten Brett-Runde ein
      present: () => this.connectedIds(),
      // Nach den Bonus-Cocktails: Endstand
      onFinish: () => {
        this.results = this.finalResults();
        this.phase = 'results';
        this.changed();
      },
    }, longGames, from);
    this.results = null;
    this.phase = 'board';
    this.changed();
  }

  private startDate(version: string, couple: [string, string]) {
    const def = DATE_VERSIONS.find((v) => v.id === version) ?? DATE_VERSIONS[0];
    this.session.endSeries();
    this.dateRun = new DateRun(def, couple, [this.nameOf(couple[0]), this.nameOf(couple[1])]);
    this.results = null;
    this.phase = 'story';
    this.changed();
  }

  /** Zufälliges Spiel, das zur Spielerzahl passt und nicht gerade dran war */
  private startRandom() {
    const n = this.connectedIds().length;
    const pool = ARCADE_RANDOM.filter((k) => fitsPlayers(k, n) && k !== this.lastKind);
    const kind = pool[Math.floor(Math.random() * pool.length)] ?? 'sprint';
    this.startMini(kind);
  }

  /** Passt die Spielerzahl nicht? → Fehlermeldung, sonst null */
  private fitError(kind: MiniKind): string | null {
    const n = this.connectedIds().length;
    const { title, minPlayers: min, maxPlayers: max } = MINI_INFO[kind];
    if (n < min) return `${title}: mindestens ${min} Spieler.`;
    if (max !== undefined && n > max) return `${title}: höchstens ${max} Spieler.`;
    return null;
  }

  /** Einzelspiel aus der Lobby starten (VIP-Handy, Abstimmung, Laptop). Liefert eine Fehlermeldung oder null. */
  private startSingle(kind: MiniKind): string | null {
    if (this.phase !== 'lobby') return 'Gerade läuft schon ein Spiel.';
    const err = this.fitError(kind);
    if (err) return err;
    this.markSingle();
    this.startMini(kind);
    return null;
  }

  /** Ab jetzt läuft ein Einzelspiel aus der Lobby: Punkte fürs Leaderboard, im Ergebnis „Nochmal“ */
  private markSingle() {
    this.singleActive = true;
    this.arcadeActive = this.mode === 'arcade';
  }

  /** Ergebnis eines Einzelspiels (kein Spielbrett, keine Date Night, keine Trinkspiel-Runde)? */
  private singleResults() {
    return this.phase === 'results' && this.singleActive && !this.board && !this.dateRun && !this.drinkRun && !this.turnier && !!this.results && !this.results.final;
  }

  /** „Nochmal“: dasselbe Spiel mit allen, die gerade da sind (Kart: nächste Strecke). Fehlermeldung oder null. */
  private nochmal(): string | null {
    const info = this.nochmalState();
    if (!info) return 'Gerade gibt es nichts zum Wiederholen.';
    if (info.disabled) return `Nochmal geht nicht: ${info.disabled}`;
    this.startMini(info.kind, info.kind === 'kart' ? { track: this.nextKartTrack() } : undefined);
    return null;
  }

  private nextKartTrack() {
    return this.lastKartTrack === null ? undefined : (this.lastKartTrack + 1) % KART_TRACKS.length;
  }

  /** Für VIP-Handy und Laptop: Was „Nochmal“ startet und ob es gerade geht */
  private nochmalState(): NochmalState | null {
    const kind = this.lastKind;
    if (!kind || !this.singleResults()) return null;
    const track = kind === 'kart' ? this.nextKartTrack() : undefined;
    return {
      kind,
      next: seriesLabel(kind, this.session.nextRound(kind)),
      ...(track !== undefined ? { detail: `Strecke: ${KART_TRACKS[track].name}` } : {}),
      ...(this.fitError(kind) ? { disabled: this.fitError(kind)! } : {}),
      random: this.arcadeActive,
    };
  }

  private resetSession() {
    this.session.reset();
    this.fx.clear();
    this.streaks.clear();
    if (this.results) delete this.results.points;
    this.changed();
  }

  /**
   * Arcade-Abstimmung auswerten (nur Spiele, die zur Spielerzahl passen):
   * 'top' = meiste Stimmen (Gleichstand → Zufall), 'favorites' = Zufall unter allen Stimmen (mehr Stimmen = höhere Chance).
   */
  private votedKind(how: 'top' | 'favorites'): MiniKind | null {
    const n = this.connectedIds().length;
    const votes = [...this.currentVotes().values()].filter((k) => fitsPlayers(k, n));
    if (!votes.length) return null;
    if (how === 'favorites') return votes[Math.floor(Math.random() * votes.length)];
    const counts = new Map<MiniKind, number>();
    for (const k of votes) counts.set(k, (counts.get(k) ?? 0) + 1);
    const best = Math.max(...counts.values());
    const top = [...counts].filter(([, c]) => c === best).map(([k]) => k);
    return top[Math.floor(Math.random() * top.length)];
  }

  /** Stimmen nur von Spielern, die gerade da sind */
  private currentVotes(): Map<string, MiniKind> {
    const out = new Map<string, MiniKind>();
    for (const [id, k] of this.arcadeVotes ?? []) if (this.isOnline(id)) out.set(id, k);
    return out;
  }

  // ---------------------------------------------------------------- Regelkarte / Aufwärmrunde (Phase `intro`)

  /**
   * Laufende Regelkarte: Spiel, Start-Optionen, wer bereit ist, laufende Nummer. Bei `warm` (Spiele aus
   * `WARMUP_KINDS`) läuft statt der Karte eine Aufwärmrunde: `game` ist das Übungsspiel mit den Übenden `ids`,
   * `outSince` merkt sich, seit wann ein Mensch darin ausgeschieden ist (Rückfall-Lösung ohne eigenes Respawn).
   */
  private intro: {
    kind: MiniKind;
    opts?: MiniOpts;
    ready: Set<string>;
    seq: number;
    short: boolean;
    timer: NodeJS.Timeout;
    warm: boolean;
    game: MiniGame | null;
    ids: string[];
    outSince: number;
  } | null = null;
  private introSeq = 0;
  /** Spiele, die heute (seit Serverstart) schon liefen → kürzere Ansage auf der Regelkarte */
  private introSeen = new Set<MiniKind>();

  /**
   * Minispiel starten – vorher die Regelkarte (Ziel, Steuerung, „Bereit!“) bzw. bei Echtzeit-Spielen
   * (`WARMUP_KINDS`) die Aufwärmrunde mit der echten Steuerung. Ohne Karte: Date-Night-Kapitel, Trinkspiele und
   * „Nochmal“ desselben Spiels.
   * Kein Timer: Los geht's erst, wenn alle verbundenen Mitspieler bereit sind oder VIP/Laptop starten (`introGo()`).
   */
  private startMini(kind: MiniKind, opts?: MiniOpts) {
    const again = this.singleResults() && this.lastKind === kind;
    this.endIntro();
    if (this.dateRun || this.drinkRun || again) {
      this.introSeen.add(kind);
      return this.launchMini(kind, opts);
    }
    const ids = this.gameIds();
    if (!ids.length) return this.backToLobby();
    this.showBoard = false;
    this.results = null;
    const warm = isWarmupKind(kind);
    if (warm) {
      // Aufwärmrunde und echtes Spiel: gleiche Strecke, gleiche Teams (Brett-Teams bleiben `teams`, sonst einmal zufällig)
      opts = { ...opts };
      if (kind === 'kart' && opts.track === undefined) opts.track = Math.floor(Math.random() * KART_TRACKS.length);
      if (!opts.teams) {
        const t = splitTeams(ids);
        opts.warmTeams = { A: t.A, B: t.B, label: teamLabel(t.A.length, t.B.length) };
      }
    }
    this.intro = {
      kind,
      opts,
      ready: new Set(),
      seq: ++this.introSeq,
      short: this.introSeen.has(kind),
      // Schaut regelmäßig, ob die Letzten inzwischen offline/entfernt sind – auf die wird dann nicht mehr gewartet
      timer: setInterval(() => this.introCheck(), 250),
      warm,
      game: null,
      ids: [],
      outSince: 0,
    };
    this.phase = 'intro';
    if (warm) this.startPractice();
    this.changed();
  }

  /** Mitspieler, auf die die Regelkarte wartet: verbunden und nicht entfernt (Offline-Handys blockieren nicht) */
  private introIds() {
    return this.gameIds().filter((id) => this.isOnline(id));
  }

  /** Alle verbundenen Mitspieler bereit → los. Bewusst ohne Zeitlimit (Wunsch: nie nach Timer starten). */
  private introCheck() {
    const it = this.intro;
    if (!it) return;
    if (this.phase !== 'intro') return this.endIntro();
    const online = this.introIds();
    if (online.length > 0 && online.every((id) => it.ready.has(id))) return this.introGo();
    if (it.warm) this.practiceCheck();
  }

  /** Regelkarte beenden und das Spiel wirklich starten (alle bereit, VIP „Jetzt starten“ bzw. Laptop Enter/Weiter) */
  private introGo() {
    const it = this.intro;
    if (!it || this.phase !== 'intro') return;
    // Übungsspiel weg, gehaltene Eingaben vergessen – das echte Spiel startet frisch mit Countdown
    this.endIntro();
    this.holds.clear();
    this.introSeen.add(it.kind);
    this.launchMini(it.kind, it.opts);
  }

  private endIntro() {
    const it = this.intro;
    this.intro = null;
    if (!it) return;
    clearInterval(it.timer);
    it.game?.dispose();
    it.game = null;
  }

  private introReady(id: string) {
    const it = this.intro;
    if (this.phase !== 'intro' || !it || it.ready.has(id) || !this.gameIds().includes(id)) return;
    it.ready.add(id);
    this.changed();
    this.introCheck();
  }

  private introState(): IntroState | null {
    const it = this.intro;
    if (this.phase !== 'intro' || !it) return null;
    const ids = this.introIds();
    return {
      kind: it.kind,
      ids,
      ready: ids.filter((id) => it.ready.has(id)),
      seq: it.seq,
      short: it.short,
      teams: it.opts?.teams ?? null,
      ...(it.warm && it.game ? { warm: true } : {}),
    };
  }

  /**
   * Aufwärmrunde: frische Übungsinstanz des Spiels (beim Start der Karte und still, wenn die Übung endet oder ein
   * Mensch zu lange raus ist). Gleicher Weg wie das echte Spiel (`createMini`), nur mit `ctx.practice`.
   */
  private startPractice() {
    const it = this.intro;
    if (!it?.warm || this.phase !== 'intro') return;
    it.game?.dispose();
    it.game = null;
    const ids = this.gameIds();
    it.ids = ids;
    it.outSince = 0;
    this.holds.clear();
    if (!ids.length) return;
    const holder: { game: MiniGame | null } = { game: null };
    holder.game = this.createMini(it.kind, ids, this.miniCtx(it.kind, it.opts, holder), it.opts);
    it.game = holder.game;
    this.miniSeq += 1;
  }

  /** Rückfall-Lösung der Aufwärmrunde: Übungsspiel fehlt oder ein Mensch ist zu lange raus → frische Übungsrunde */
  private practiceCheck() {
    const it = this.intro;
    if (!it?.warm) return;
    if (!it.game) {
      if (this.gameIds().length) {
        this.startPractice();
        this.changed();
      }
      return;
    }
    const humans = it.ids.filter((id) => this.isOnline(id) && !this.players.get(id)?.isBot);
    if (!practiceOut(it.game.snapshot(), humans)) {
      it.outSince = 0;
      return;
    }
    const now = Date.now();
    if (!it.outSince) it.outSince = now;
    else if (now - it.outSince >= PRACTICE_OUT_MS) {
      this.startPractice();
      this.changed();
    }
  }

  /** Spiel, das gerade Eingaben bekommt: das laufende Minispiel bzw. das Übungsspiel der Aufwärmrunde */
  private liveGame(): MiniGame | null {
    if (this.phase === 'mini') return this.mini;
    if (this.phase === 'intro') return this.intro?.game ?? null;
    return null;
  }

  /**
   * Kontext für ein Minispiel. Mit `practice` (Aufwärmrunde) zählt nichts: `finish` startet still eine frische
   * Übungsrunde, Protokoll des Abends und Bestleistungen bleiben unberührt.
   */
  private miniCtx(kind: MiniKind, opts: MiniOpts | undefined, practice: { game: MiniGame | null } | null): MiniCtx {
    return {
      onChange: () => this.changed(),
      finish: practice
        ? () => {
            // Erst nach dem laufenden Tick des Übungsspiels austauschen – und nur, wenn es noch das aktuelle ist
            setTimeout(() => {
              if (this.phase !== 'intro' || !practice.game || this.intro?.game !== practice.game) return;
              this.startPractice();
              this.changed();
            }, 0);
          }
        : (r) => this.finishMini(kind, r),
      isConnected: (id) => this.inPlay(id),
      offlineMs: (id) => this.offlineMs(id),
      isGone: (id) => !!this.players.get(id)?.removed,
      nameOf: (id) => this.nameOf(id),
      isBot: (id) => !!this.players.get(id)?.isBot,
      lookOf: (id) => this.players.get(id)?.look,
      colorOf: (id) => this.players.get(id)?.color,
      mode: this.dateRun ? 'date' : this.drinkRun ? 'drink' : this.mode,
      teams: opts?.teams ?? null,
      warmTeams: opts?.warmTeams ?? null,
      ...(practice ? { practice: true } : {}),
      log: practice ? () => undefined : (type, data) => this.fx.push(type, data, kind),
      record: (k: BalanceKind, id, value, detail) => {
        if (practice || !isBalanceKind(k) || (this.players.get(id)?.isBot && !process.env.RECORDS_INCLUDE_BOTS)) return null;
        return this.records.submit(k, this.nameOf(id), value, detail);
      },
      records: (k: BalanceKind) => this.records.top(k, 5),
      hosts: () => this.io.sockets.adapter.rooms.get('hosts')?.size ?? 0,
    };
  }

  private launchMini(kind: MiniKind, opts?: MiniOpts) {
    this.mini?.dispose();
    this.mini = null;
    this.showBoard = false;
    this.miniTeams = opts?.teams ?? null;
    // Neues Spiel → neue Abstimmung fürs nächste (an/aus bleibt)
    this.arcadeVotes?.clear();
    this.lastKind = kind;
    const ids = this.gameIds();
    this.miniIds = ids;
    // Gerade niemand verbunden (alle Handys kurz weg) → kein Minispiel ohne Spieler starten
    if (!ids.length) return this.backToLobby();
    this.mini = this.createMini(kind, ids, this.miniCtx(kind, opts, null), opts);
    this.miniSeq += 1;
    this.results = null;
    this.phase = 'mini';
    this.changed();
  }

  /** Neue Instanz des Minispiels – für das echte Spiel (`launchMini`) und die Aufwärmrunde (`startPractice`) */
  private createMini(kind: MiniKind, ids: string[], ctx: MiniCtx, opts?: MiniOpts): MiniGame {
    switch (kind) {
      case 'flunky':
        return new FlunkyGame(ids, ctx);
      case 'wwe':
        return new WweGame(ids, ctx, this.questions.all, DEFAULT_QUESTIONS);
      case 'sprint':
        return new SprintGame(ids, ctx);
      case 'murder':
        return new MurderGame(ids, ctx);
      case 'descent':
        return new DescentGame(ids, ctx);
      case 'rhythm':
        return new RhythmGame(ids, ctx);
      case 'wrap':
        return new WrapGame(ids, ctx);
      case 'stars':
        return new StarsGame(ids, ctx);
      case 'nhie':
        return new NhieGame(ids, ctx, this.nhie.all, DEFAULT_NHIE);
      case 'hilo':
        return new HiloGame(ids, ctx);
      case 'bomb':
        return new BombGame(ids, ctx);
      case 'kingscup':
        return new KingsCupGame(ids, ctx);
      case 'sup':
        return new SupGame(ids, ctx);
      case 'tidy':
        return new TidyGame(ids, ctx);
      case 'flieger':
        return new FliegerGame(ids, ctx);
      case 'kurve':
        return new KurveGame(ids, ctx, ids.map((id) => this.players.get(id)?.color));
      case 'arena':
        return new ArenaGame(ids, ctx);
      case 'bowling':
        return new BowlingGame(ids, ctx);
      case 'sekt':
        return new SektGame(ids, ctx);
      case 'enten':
        return new EntenGame(ids, ctx);
      case 'ttt':
        return new TttGame(ids, ctx);
      case 'verstecken':
        return new VersteckGame(ids, ctx);
      case 'parcours':
        return new ParcoursGame(ids, ctx);
      case 'kart':
        return new KartGame(ids, ctx, opts?.track, (id) => this.players.get(id)?.kartView === 'phone');
      case 'turm':
        return new TurmGame(ids, ctx);
      case 'igel':
        return new IgelGame(ids, ctx);
      case 'smash':
        return new SmashGame(ids, ctx);
      case 'wasser':
        return new WasserGame(ids, ctx);
      case 'stillepost':
        return new StillepostGame(ids, ctx, this.posts.all);
      case 'fangen':
        return new FangenGame(ids, ctx);
      case 'spion':
        return new SpionGame(ids, ctx);
      case 'wackel':
        return new WackelGame(ids, ctx);
      case 'skisprung':
        return new SkisprungGame(ids, ctx);
      case 'teppich':
        return new TeppichGame(ids, ctx);
      case 'kugel':
        return new KugelGame(ids, ctx);
      case 'geist':
        return new GeistGame(ids, ctx);
      case 'grill':
        return new GrillGame(ids, ctx);
      case 'boule':
        return new BouleGame(ids, ctx);
      case 'sumo':
        return new SumoGame(ids, ctx);
      case 'bogen':
        return new BogenGame(ids, ctx);
      case 'darts':
        return new DartsGame(ids, ctx);
      case 'volley':
        return new VolleyGame(ids, ctx);
      case 'tourist':
        return new TouristGame(ids, ctx);
      case 'sprueche':
        return new SpruecheGame(ids, ctx, this.quips.all);
      case 'golf':
        return new GolfGame(ids, ctx);
      case 'autoball':
        return new AutoballGame(ids, ctx);
      case 'werwolf':
        return new WerwolfGame(ids, ctx);
      case 'wolfrunde':
        return new WolfrundeGame(ids, ctx);
      case 'pixel':
        return new PixelGame(ids, ctx);
      case 'wpistole':
        return new WpistoleGame(ids, ctx);
      case 'zauber':
        return new ZauberGame(ids, ctx);
      case 'angeln':
        return new AngelnGame(ids, ctx);
      case 'koffer':
        return new KofferGame(ids, ctx);
      case 'suess':
        return new SuessGame(ids, ctx);
      case 'umzug':
        return new UmzugGame(ids, ctx);
      case 'funk':
        return new FunkGame(ids, ctx);
      case 'schaetz':
        return new SchaetzGame(ids, ctx);
      case 'lieder':
        return new LiederGame(ids, ctx, liederTon);
      case 'maexchen':
        return new MaexGame(ids, ctx);
      case 'werwars':
        return new WerwarsGame(ids, ctx, this.werwarsQ.all);
    }
  }

  private finishMini(kind: MiniKind, r: MiniResult) {
    const snap = this.mini?.snapshot();
    if (snap?.kind === 'kart') this.lastKartTrack = snap.state.track;
    this.mini?.dispose();
    this.mini = null;
    this.miniIds = null;
    // Münzen: eigene Staffel des Spiels (pro Gruppe) oder Standard-Staffel nach Rang und Spielerzahl
    const ranks = groupPlaces(r.groups);
    const ranked = r.groups.reduce((sum, g) => sum + g.length, 0);
    const rows = r.groups.flatMap((group, gi) =>
      group.map((id) => ({
        playerId: id,
        place: gi + 1,
        detail: r.details[id] ?? '',
        coins: r.coins ? r.coins[Math.min(gi, r.coins.length - 1)] : placeCoins(ranks[gi], ranked),
      })),
    );
    // Team-Spiel vom Brett mit ungleichen Teams (1 gegen 3): gewinnt das kleinere Team, bekommt es doppelte Münzen
    const teams = this.miniTeams;
    this.miniTeams = null;
    if (teams && this.board && teams.A.length !== teams.B.length && r.groups.length > 1) {
      const small = teams.A.length < teams.B.length ? teams.A : teams.B;
      if (r.groups[0].every((id) => small.includes(id))) for (const row of rows) if (row.place === 1) row.coins *= 2;
    }
    // Party-Finale (Mord/Verräter): Sieger bekommen zusätzlich Cocktails – das Brett bucht sie in afterMini
    const finaleCocktails = this.board?.finaleCocktails(kind) ?? 0;
    if (finaleCocktails) for (const row of rows) if (row.place === 1) row.detail = [row.detail, `+${finaleCocktails} Cocktails`].filter(Boolean).join(' · ');
    const hearts = r.hearts !== undefined ? { hearts: r.hearts, maxHearts: HEARTS_PER_CHAPTER } : {};
    if (r.hearts !== undefined || r.sips) for (const row of rows) row.coins = 0;
    if (r.sips && this.drinkRun) {
      for (const [id, n] of Object.entries(r.sips)) this.drinkRun.totals[id] = (this.drinkRun.totals[id] ?? 0) + n;
      Object.assign(hearts, { sips: r.sips });
    }
    this.results = { title: MINI_INFO[kind].title, subtitle: r.subtitle, rows, final: false, ...hearts };
    if (this.singleActive && !this.board && !this.dateRun && !this.drinkRun) this.scoreSingle(kind, r);
    this.logMiniEnd(kind, r, snap);
    this.phase = 'results';
    this.changed();
  }

  /**
   * Einzelspiel: Punkte nach Platzierung verteilen – ins Leaderboard des Abends (pro Spieler-ID, mit Serie)
   * und in die ewige Tabelle (pro Name, ohne Bots, data/arcade.json).
   */
  private scoreSingle(kind: MiniKind, r: MiniResult) {
    // Trinkspiele: wer am wenigsten trinken musste, gewinnt
    const groups = r.sips ? [...r.groups].reverse() : r.groups;
    // Gemeinsame Spiele (nur eine Gruppe): Herzen bzw. feste Punkte für alle
    const coop = groups.length === 1;
    const points: Record<string, number> = {};
    // Punkte nach Rang und Spielerzahl (1. 10 … Letzter 1)
    const ranks = groupPlaces(groups);
    const ranked = groups.reduce((sum, g) => sum + g.length, 0);
    groups.forEach((g, gi) => {
      // Entfernte Spieler bekommen für dieses Spiel nichts mehr (ihre bisherigen Punkte bleiben)
      for (const id of g) if (this.players.has(id) && !this.players.get(id)!.removed) points[id] = coop ? (r.hearts ?? ARCADE_COOP_POINTS) : arcadePoints(ranks[gi], ranked);
    });
    const winners = new Set(coop ? [] : (groups[0] ?? []));
    for (const [id, pts] of Object.entries(points)) this.leaderboard.add(this.nameOf(id), kind, pts, winners.has(id));
    this.leaderboard.save();
    this.session.score(kind, points, winners, this.present());
    if (this.results) {
      this.results.points = points;
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
    if (this.turnier) return this.turnierContinue();
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
    // Nach dem Finale zeigt das Brett erst die Bonus-Cocktails und meldet sich dann über onFinish (→ Endstand)
    this.board.afterMini(res.rows);
    this.results = null;
    this.phase = 'board';
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
    this.endIntro();
    this.mini?.dispose();
    this.mini = null;
    this.miniIds = null;
    this.board?.dispose();
    this.board = null;
    this.dateRun = null;
    this.drinkRun = null;
    this.turnier = null;
    this.singleActive = false;
    this.arcadeActive = false;
    this.results = null;
    this.phase = 'lobby';
    // Entfernte Spieler und Bots endgültig raus; Offline-Menschen bleiben (grau), bis ihre Frist abläuft
    for (const [id, p] of this.players) if (p.removed || (!p.connected && (p.isBot || this.lobbyExpired(p)))) this.players.delete(id);
    this.ensureVip();
    this.changed();
  }

  private storyNext() {
    if (!this.dateRun) return;
    const next = this.dateRun.next();
    if (next === 'end') this.backToLobby();
    else if (next) this.startMini(next);
    else this.changed();
  }

  // ================================================================ VIP-Nachfolge, Auto-Weiter, Laptop-Steuerung
  // (fix/reconnect-vip) Alles rund um „VIP weg → nichts hängt“ steht gebündelt hier.

  /** „Weiter“ – wie der VIP-Knopf (Ergebnis, Date-Night-Karte, Vorführung/Abstimmung in Stille Post, Diskussion im Mörderspiel) */
  private advance(auto = false) {
    if (this.phase === 'results') {
      // Niemand mehr da, der trinken könnte → Trinkspiel mit Statistik beenden
      if (auto && this.drinkRun && !this.results?.final && this.connectedHumans().length === 0) return this.continueAfterResults(true);
      return this.continueAfterResults();
    }
    if (this.phase === 'story') return this.storyNext();
    if (this.phase === 'intro') return this.introGo();
    if (this.phase === 'mini') this.mini?.vipAction?.(this.mini.kind === 'murder' ? 'skip' : 'next');
  }

  /** Befehle von der TV-Seite am Laptop (Maus/Tastatur) – nur von localhost, geprüft in handle() */
  private hostCommand(cmd: HostCommand): { ok: boolean; msg?: string } {
    if (cmd === 'abort') {
      if (this.phase === 'lobby') return { ok: false, msg: 'Es läuft gerade kein Spiel.' };
      this.backToLobby();
      return { ok: true, msg: 'Spiel abgebrochen.' };
    }
    if (cmd === 'continue') {
      if (!this.waitingStep()) return { ok: false, msg: 'Gerade gibt es nichts zum Weiterschalten.' };
      this.advance();
      return { ok: true, msg: 'Weiter!' };
    }
    if (cmd === 'skip') return this.skipCurrent();
    if (cmd === 'again') {
      if (!this.singleResults()) return { ok: false, msg: 'Nochmal geht nur im Ergebnis eines Einzelspiels.' };
      const err = this.nochmal();
      return err ? { ok: false, msg: err } : { ok: true, msg: 'Nochmal!' };
    }
    if (cmd === 'menu') {
      if (this.phase === 'lobby') return { ok: true };
      if (!this.singleResults()) return { ok: false, msg: 'Erst das laufende Spiel abbrechen (Esc 2×).' };
      this.backToLobby();
      return { ok: true, msg: 'Anderes Spiel wählen' };
    }
    if (cmd === 'resetSession') {
      if (this.phase !== 'lobby' && this.phase !== 'results') return { ok: false, msg: 'Nicht mitten im Spiel – erst in der Lobby oder im Ergebnis.' };
      this.resetSession();
      return { ok: true, msg: 'Leaderboard des Abends zurückgesetzt.' };
    }
    if (cmd === 'board') {
      if (this.phase !== 'lobby') return { ok: false, msg: 'Leaderboard-Ansicht gibt es in der Lobby (im Ergebnis läuft sie automatisch).' };
      this.showBoard = !this.showBoard;
      this.changed();
      return { ok: true, msg: this.showBoard ? 'Leaderboard des Abends' : 'Lobby' };
    }
    if (cmd === 'removeBots') {
      if (this.phase !== 'lobby') return { ok: false, msg: 'Bots nur in der Lobby entfernen (erst abbrechen).' };
      if (!this.bots.length) return { ok: false, msg: 'Keine Bots da.' };
      for (const b of this.bots) b.stop();
      this.bots = [];
      return { ok: true, msg: 'Bots entfernt.' };
    }
    return { ok: false, msg: 'Unbekannter Befehl.' };
  }

  /** Was gerade übersprungen werden kann (Minispiel-Zug/-Phase oder Würfeln auf dem Brett) */
  private skippable() {
    if (this.phase === 'mini') return this.mini?.skippable?.() ?? null;
    if (this.phase === 'board') return this.board?.skippable() ?? null;
    return null;
  }

  /** VIP-Menü bzw. Taste S am Laptop: aktuellen Zug/Phase überspringen */
  private skipCurrent(): { ok: boolean; msg?: string } {
    const info = this.skippable();
    if (!info) return { ok: false, msg: 'Gerade gibt es nichts zum Überspringen.' };
    if (this.phase === 'mini') this.mini?.skip?.();
    else if (this.phase === 'board') this.board?.skip();
    this.changed();
    return { ok: true, msg: `${info.label} ✓` };
  }

  /** Laptop-Arcade-Auswahl: Spiel, 'random' (Zufall) oder 'top' (meiste Stimmen) starten */
  private hostStart(what: string): { ok: boolean; msg?: string } {
    if (this.phase !== 'lobby') return { ok: false, msg: 'Erst das laufende Spiel abbrechen (Esc 2×).' };
    if (!this.connectedIds().length) return { ok: false, msg: 'Noch keine Spieler da.' };
    if (what === 'random') {
      this.markSingle();
      this.startRandom();
      return { ok: true, msg: 'Zufallsspiel!' };
    }
    if (what.startsWith('turnier:')) {
      const err = this.startTurnier({ playlist: what.slice(8) });
      return err ? { ok: false, msg: err } : { ok: true, msg: `Turnier „${this.turnier?.name}“ startet!` };
    }
    const kind = what === 'top' ? this.votedKind('top') : MINI_KINDS.includes(what as MiniKind) ? (what as MiniKind) : null;
    if (!kind) return { ok: false, msg: what === 'top' ? 'Noch keine (passenden) Stimmen.' : 'Unbekanntes Spiel.' };
    const err = this.startSingle(kind);
    return err ? { ok: false, msg: err } : { ok: true, msg: `${MINI_INFO[kind].title} startet!` };
  }

  /**
   * Wartet der aktuelle Schritt auf einen Knopf des VIP? Liefert einen Schlüssel für genau diesen Schritt
   * und nach wie vielen ms der Server von selbst weiterschaltet (null = der Schritt hat schon einen eigenen Timer).
   */
  private waitingStep(): { key: unknown; ms: number | null } | null {
    if (this.phase === 'results' && this.results) return { key: this.results, ms: AUTO_RESULTS_MS };
    // Regelkarte: kein Auto-Weiter – Bots sind sofort bereit, gewartet wird nur auf verbundene Menschen
    if (this.phase === 'intro' && this.intro) return { key: this.intro, ms: null };
    if (this.phase === 'story' && this.dateRun?.state.card) return { key: this.dateRun.state.card, ms: AUTO_STORY_MS };
    const m = this.phase === 'mini' ? this.mini?.snapshot() : null;
    if (m?.kind === 'stillepost' && (m.state.sub === 'reveal' || m.state.sub === 'tally')) {
      return { key: `sp-${m.state.sub}-${m.state.chain}-${m.state.shown}`, ms: AUTO_MINI_MS };
    }
    if (m?.kind === 'stillepost' && m.state.sub === 'vote') return { key: `sp-vote-${m.state.chain}`, ms: null };
    if (m?.kind === 'murder' && m.state.sub === 'meeting') return { key: `murder-${m.state.phaseNo}`, ms: null };
    if (m?.kind === 'werwolf' && m.state.sub === 'day') return { key: `werwolf-${m.state.phaseNo}`, ms: null };
    if (m?.kind === 'pixel' && (m.state.sub === 'vote' || m.state.sub === 'reveal' || m.state.sub === 'scores')) return { key: `pixel-${m.state.sub}-${m.state.round}`, ms: null };
    return null;
  }

  /**
   * Kann ein Mensch den wartenden Schritt auslösen? Auch ein VIP, der nur kurz weg ist (Gnadenfrist),
   * zählt – auf ihn wird gewartet, damit er beim Zurückkommen noch selbst „Weiter“ drücken kann.
   */
  private humanCanAct(now = Date.now()) {
    const couple: string[] = this.phase !== 'mini' ? (this.dateRun?.state.couple ?? []) : [];
    return [...this.players.values()].some(
      (p) => !p.isBot && (p.connected || this.inGrace(p, now)) && (p.isVip || couple.includes(p.id)),
    );
  }

  /** Läuft jede Sekunde: Gnadenfrist abgelaufen? VIP neu vergeben? Hängt etwas, weil nur Bots da sind? */
  private tick() {
    const now = Date.now();
    let dirty = false;
    if (this.phase === 'lobby') {
      for (const [id, p] of this.players) {
        // Offline-Spieler bleiben OFFLINE_REMOVE_MS grau in der Lobby (Rückkehr stellt sie wieder her)
        if (!p.connected && (p.isBot || this.lobbyExpired(p, now))) {
          this.players.delete(id);
          dirty = true;
        }
      }
      if (this.offlineLabelsChanged(now)) dirty = true;
    } else if (this.connectedIds().length === 0 && !this.anyHumanInGrace(now)) {
      // Niemand mehr da (auch kein Bot) und die Gnadenfrist ist um → zurück in die Lobby
      return this.backToLobby();
    }
    const vipBefore = [...this.players.values()].find((p) => p.isVip)?.id;
    this.ensureVip(now);
    if ([...this.players.values()].find((p) => p.isVip)?.id !== vipBefore) dirty = true;

    // Nur Bots könnten weiterdrücken (die tun das nicht) → nach ein paar Sekunden automatisch weiter
    const step = this.waitingStep();
    if (step?.ms != null && !this.humanCanAct(now)) {
      if (step.key !== this.gateKey) {
        this.gateKey = step.key;
        this.gateSince = now;
      } else if (now - this.gateSince >= step.ms) {
        this.gateKey = null;
        this.advance(true);
        return;
      }
    } else {
      this.gateKey = null;
    }

    // Kein Mensch kann überspringen (nur Bots) → Info-Screens nach AUTO_MINI_MS, alles andere nach AUTO_SKIP_MS.
    // Ohne Zeitlimits würde ein Bot-Spiel sonst hängen, wenn ein Bot eine Phase nicht kennt.
    const skip = this.skippable();
    if (skip && !this.humanCanAct(now)) {
      const key = `${this.phase}|${this.mini?.kind ?? ''}|${skip.label}|${this.stepTag()}`;
      if (key !== this.skipKey) {
        this.skipKey = key;
        this.skipSince = now;
      } else if (now - this.skipSince >= (skip.info ? AUTO_MINI_MS : AUTO_SKIP_MS)) {
        this.skipKey = '';
        this.skipCurrent();
        return;
      }
    } else {
      this.skipKey = '';
    }
    if (dirty) this.changed();
  }

  /** Grobe Kennung des aktuellen Schritts (Runde, Phase, Zug …) – damit gleich beschriftete Schritte nicht zusammenfallen */
  private stepTag(): string {
    if (this.phase === 'board' && this.board) return `${this.board.state.round}-${this.board.state.turnIdx}-${this.board.state.sub}`;
    const st = this.mini?.snapshot().state as unknown as Record<string, unknown> | undefined;
    if (!st) return '';
    return ['sub', 'round', 'phaseNo', 'shown', 'chain', 'match', 'hole', 'turn', 'aimSeq'].map((k) => String(st[k] ?? '')).join('-');
  }

  private connectedHumans() {
    return [...this.players.values()].filter((p) => p.connected && !p.isBot);
  }

  private inGrace(p: Player, now = Date.now()) {
    return !p.connected && !p.removed && now - p.disconnectedAt < VIP_GRACE_MS;
  }

  private anyHumanInGrace(now = Date.now()) {
    return [...this.players.values()].some((p) => !p.isBot && this.inGrace(p, now));
  }

  /**
   * Wer ist Spielleiter (VIP)?
   * 1. Der Gastgeber (erster Mensch im Raum), sobald er verbunden ist – auch wenn er zwischendurch weg war.
   * 2. Sonst bleibt der bisherige VIP – ist er ein Mensch, auch noch VIP_GRACE_MS nach dem Verbindungsabbruch.
   * 3. Sonst der am längsten verbundene Mensch. Bots werden nur VIP, wenn gar kein Mensch verbunden ist.
   */
  private ensureVip(now = Date.now()) {
    const list = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const humans = list.filter((p) => p.connected && !p.isBot).sort((a, b) => a.connectedSince - b.connectedSince);
    const host = this.hostId ? this.players.get(this.hostId) : undefined;
    const current = list.find((p) => p.isVip);
    let vip: Player | undefined;
    if (host?.connected && !host.isBot) vip = host;
    else if (current && !current.isBot && (current.connected || this.inGrace(current, now))) vip = current;
    else if (humans.length) vip = humans[0];
    else if (current?.connected) vip = current;
    else vip = list.find((p) => p.connected);
    for (const p of list) p.isVip = p === vip;
    if (!this.hostId && vip && !vip.isBot) this.hostId = vip.id;
  }

  // ================================================================ Ende VIP-Nachfolge


  // ---------------------------------------------------------------- Spieler entfernen & Offline
  // Kick vom VIP-Handy bzw. vom Laptop (TV-Panel „Spieler“), Offline-Frist in der Lobby.
  // Helfer/Konstanten: server/players.ts

  private handleKicks(socket: Socket, myId: () => string | null) {
    const reply = (ack: unknown, r: KickResponse) => typeof ack === 'function' && (ack as (r: KickResponse) => void)(r);
    const isVip = () => !!this.players.get(myId() ?? '')?.isVip;
    const isHost = () => isLaptop(socket.handshake);

    // VIP-Handy: einzelnen Spieler entfernen (nicht sich selbst)
    socket.on('vip:kick', (id: unknown, ack?: unknown) => {
      if (!isVip()) return reply(ack, { ok: false, error: 'Nur der VIP darf Spieler entfernen.' });
      const target = String(id ?? '');
      if (target === myId()) return reply(ack, { ok: false, error: 'Du kannst dich nicht selbst entfernen.' });
      const n = this.kickPlayers([target]);
      reply(ack, n ? { ok: true, removed: n } : { ok: false, error: 'Spieler nicht gefunden.' });
    });

    // VIP-Handy: alle anderen entfernen (VIP bleibt)
    socket.on('vip:kickOthers', (ack?: unknown) => {
      if (!isVip()) return reply(ack, { ok: false, error: 'Nur der VIP darf Spieler entfernen.' });
      const n = this.kickPlayers([...this.players.keys()].filter((id) => id !== myId()));
      reply(ack, { ok: true, removed: n });
    });

    // Laptop/TV: nur von Loopback-Verbindungen (127.0.0.1 / ::1) ohne Tunnel – die TV-Seite erfährt das über 'host:info'
    socket.on('host:kick', (id: unknown, ack?: unknown) => {
      if (!isHost()) return reply(ack, { ok: false, error: 'Nur direkt am Laptop (localhost) erlaubt.' });
      const n = this.kickPlayers([String(id ?? '')]);
      reply(ack, n ? { ok: true, removed: n } : { ok: false, error: 'Spieler nicht gefunden.' });
    });
    socket.on('host:kickAll', (ack?: unknown) => {
      if (!isHost()) return reply(ack, { ok: false, error: 'Nur direkt am Laptop (localhost) erlaubt.' });
      reply(ack, { ok: true, removed: this.kickPlayers([...this.players.keys()]) });
    });
  }

  /** Spieler entfernen. Lobby: sofort weg. Laufendes Spiel: als „entfernt“ markiert, das Spiel läuft ohne ihn weiter. */
  private kickPlayers(ids: string[]): number {
    let n = 0;
    let human = false;
    for (const id of ids) {
      const p = this.players.get(id);
      if (!p || p.removed) continue;
      n += 1;
      human ||= !p.isBot;
      this.kicks.add(id);
      // Handy informieren und trennen (es verbindet sich nicht von selbst neu)
      const sock = p.socketId ? this.io.sockets.sockets.get(p.socketId) : undefined;
      if (sock) {
        sock.emit('kicked');
        sock.leave('players');
        setTimeout(() => sock.disconnect(true), 200);
      }
      // Bot (über „+ Bot“ hinzugefügt) beenden
      const bi = this.bots.findIndex((b) => b.id === id);
      if (bi >= 0) this.bots.splice(bi, 1)[0].stop();
      p.socketId = null;
      p.connected = false;
      p.isVip = false;
      if (!p.disconnectedAt) p.disconnectedAt = Date.now();
      if (this.hostId === id) this.hostId = null;
      if (this.phase === 'lobby') {
        this.players.delete(id);
      } else {
        // Bleibt bis zur Lobby im Zustand (Namen/Avatare in laufenden Szenen), zählt aber nirgends mehr
        p.removed = true;
        this.playerGone(id);
      }
    }
    if (!n) return 0;
    if (this.phase !== 'lobby' && (this.connectedIds().length === 0 || (human && !this.humansOnline() && !this.anyHumanInGrace()))) {
      this.backToLobby();
    } else {
      this.ensureVip();
      this.changed();
    }
    return n;
  }

  /** Spieler wurde entfernt: laufendes Spiel/Brett soll nicht auf ihn warten (Brett überspringt ihn sofort). */
  private playerGone(id: string) {
    const game = this.liveGame();
    if (game) game.playerDisconnected(id);
    else if (this.phase === 'board') this.board?.playerGone(id);
  }

  /** Lobby: Offline-Mensch ist länger als OFFLINE_REMOVE_MS (5 min) weg → wird automatisch entfernt (in tick()). */
  private lobbyExpired(p: Player, now = Date.now()) {
    return !p.connected && !!p.disconnectedAt && now - p.disconnectedAt >= OFFLINE_REMOVE_MS;
  }

  /** „offline seit X min“ soll auf TV/Handys weiterzählen → einmal pro Minute neuen Zustand schicken. */
  private offlineLabelsChanged(now = Date.now()) {
    const bucket = [...this.players.values()]
      .filter((p) => !p.connected && p.disconnectedAt && !p.removed)
      .map((p) => `${p.id}:${Math.floor((now - p.disconnectedAt) / 60_000)}`)
      .join('|');
    if (bucket === this.offlineBucket) return false;
    this.offlineBucket = bucket;
    return true;
  }

  /** Lobby voll: den am längsten offline gebliebenen Spieler rauswerfen, damit Neue reinkommen. */
  private evictOffline() {
    const oldest = [...this.players.values()]
      .filter((p) => !p.connected && p.disconnectedAt)
      .sort((a, b) => a.disconnectedAt - b.disconnectedAt)[0];
    if (oldest) this.players.delete(oldest.id);
  }

  // ================================================================ Turnier (Playlist mit Gesamtwertung)
  // Spiele laufen nacheinander wie Einzelspiele (Regelkarte, Ergebnis, Leaderboard des Abends + ewige Tabelle),
  // dazu ein eigener Zwischenstand (`turnierBoard`) und am Ende die Siegerehrung mit Podest + Titeln des Abends.

  /** Turnier aus der Lobby starten (VIP-Handy oder Laptop). Liefert eine Fehlermeldung oder null. */
  private startTurnier(req: { playlist?: unknown; kinds?: unknown }): string | null {
    if (this.phase !== 'lobby') return 'Gerade läuft schon ein Spiel.';
    if (!this.connectedIds().length) return 'Noch keine Spieler da.';
    const id = String(req.playlist ?? '');
    let name: string;
    let icon: string;
    let kinds: MiniKind[];
    if (id === 'custom') {
      const raw = Array.isArray(req.kinds) ? req.kinds.map(String) : [];
      kinds = [...new Set(raw.filter((k): k is MiniKind => TURNIER_KINDS.includes(k as MiniKind)))];
      if (kinds.length < TURNIER_CUSTOM.MIN || kinds.length > TURNIER_CUSTOM.MAX) return `Eigenes Turnier: ${TURNIER_CUSTOM.MIN}–${TURNIER_CUSTOM.MAX} Spiele wählen.`;
      name = 'Eigenes Turnier';
      icon = '🏆';
    } else {
      const pl = TURNIER_PLAYLISTS.find((p) => p.id === id);
      if (!pl) return 'Unbekannte Playlist.';
      ({ name, icon, kinds } = pl);
    }
    for (const k of kinds) {
      const err = this.fitError(k);
      if (err) return err;
    }
    this.session.endSeries();
    this.turnierBoard.reset();
    this.turnier = { playlist: id, name, icon, kinds, index: 0, played: 0 };
    // Punkte wie bei Einzelspielen (Leaderboard des Abends + ewige Tabelle), aber ohne „Nochmal“ (siehe singleResults)
    this.singleActive = true;
    this.arcadeActive = false;
    this.startMini(kinds[0]);
    return null;
  }

  /** „Weiter“ im Turnier-Ergebnis: nächstes Spiel der Playlist (passt es nicht mehr zur Spielerzahl: überspringen) oder Siegerehrung */
  private turnierContinue() {
    const t = this.turnier;
    if (!t || this.results?.final) return this.backToLobby();
    let i = t.index + 1;
    while (i < t.kinds.length) {
      const err = this.fitError(t.kinds[i]);
      if (!err) break;
      this.io.to('players').emit('toast', `Übersprungen – ${err}`);
      i += 1;
    }
    if (i < t.kinds.length) {
      t.index = i;
      return this.startMini(t.kinds[i]);
    }
    this.results = this.turnierFinal();
    this.phase = 'results';
    this.changed();
  }

  /** Siegerehrung: Endstand des Turniers (Podest in ResultsScene) */
  private turnierFinal(): ResultsState {
    const t = this.turnier!;
    const rows = this.turnierBoard.rows(this.present()).filter((r) => r.status !== 'removed');
    const winners = rows.filter((r) => r.rank === 1).map((r) => r.name);
    const subtitle = !winners.length
      ? 'Niemand mehr da – trotzdem danke fürs Mitspielen!'
      : winners.length === 1
        ? `${winners[0]} gewinnt das Turnier!`
        : `${winners.slice(0, -1).join(', ')} und ${winners.at(-1)} teilen sich den Sieg!`;
    return {
      title: `${t.icon} ${t.name}`,
      subtitle: `${subtitle} (${t.played} ${t.played === 1 ? 'Spiel' : 'Spiele'})`,
      rows: rows.map((r) => ({ playerId: r.id, place: r.rank, detail: `${r.points} Pkt · ${r.wins} ${r.wins === 1 ? 'Sieg' : 'Siege'}`, coins: 0 })),
      final: true,
    };
  }

  private turnierState(): TurnierState | null {
    const t = this.turnier;
    if (!t) return null;
    return { playlist: t.playlist, name: t.name, icon: t.icon, kinds: t.kinds, index: t.index, played: t.played, table: this.turnierBoard.state(this.present()), final: !!this.results?.final };
  }

  // ================================================================ Protokoll des Abends (FxLog → „Titel des Abends“)

  /**
   * Nach jedem Minispiel: Siege, Serien, letzte Plätze und gewonnene Wetten protokollieren;
   * im Turnier die Punkte dieses Spiels (aus `results.points`) in den Zwischenstand buchen.
   */
  private logMiniEnd(kind: MiniKind, r: MiniResult, snap: ReturnType<MiniGame['snapshot']> | undefined) {
    this.fx.push('play', {}, kind);
    const groups = r.groups.filter((g) => g.length);
    // Gewinner nur bei Wettbewerben (nicht Koop/Herzen, nicht Trinkspiel-Schlücke)
    if (groups.length > 1 && r.hearts === undefined && !r.sips) {
      const winners = new Set(groups[0]);
      for (const id of groups.flat()) {
        if (!this.players.has(id)) continue;
        if (winners.has(id)) {
          const streak = (this.streaks.get(id) ?? 0) + 1;
          this.streaks.set(id, streak);
          this.fx.push('win', { p: id }, kind);
          this.fx.push('streak', { p: id, n: streak }, kind);
        } else this.streaks.set(id, 0);
      }
      for (const id of groups[groups.length - 1]) if (this.players.has(id)) this.fx.push('last', { p: id }, kind);
    }
    // Wetten der Zuschauer: Bonus aus dem Snapshot der Elimination-Spiele (BetBook, server/spectator.ts)
    const bonus = (snap?.state as { spectator?: { bonus?: Record<string, number> } } | undefined)?.spectator?.bonus;
    if (bonus) for (const [id, n] of Object.entries(bonus)) if (n > 0 && this.players.has(id)) this.fx.push('bet', { p: id, n }, kind);
    if (this.turnier && this.results?.points) {
      const winners = new Set(r.sips ? (groups[groups.length - 1] ?? []) : groups.length > 1 ? groups[0] : []);
      this.turnierBoard.score(kind, this.results.points, winners, this.present());
      this.turnier.played += 1;
    }
  }

  /** Brett: Münzen gewonnen/verloren (ohne Cocktail-Käufe) aus dem Unterschied zum letzten Flush */
  private trackBoardCoins() {
    const b = this.board?.state;
    if (!b) {
      this.boardCoins = null;
      return;
    }
    const prev = this.boardCoins;
    if (prev) {
      for (const id of b.order) {
        const bought = Math.max(0, (b.cocktails[id] ?? 0) - (prev.cocktails[id] ?? 0)) * COCKTAIL_PRICE;
        const d = (b.coins[id] ?? 0) - (prev.coins[id] ?? 0) + bought;
        if (d < 0) this.fx.push('coinloss', { p: id, n: -d });
        else if (d > 0) this.fx.push('coingain', { p: id, n: d });
      }
    }
    if (!prev || b.order.some((id) => b.coins[id] !== prev.coins[id] || b.cocktails[id] !== prev.cocktails[id])) {
      this.boardCoins = { coins: { ...b.coins }, cocktails: { ...b.cocktails } };
    }
  }

  // ---------------------------------------------------------------- Helfer

  private connectedIds() {
    return [...this.players.values()].filter((p) => p.connected && !p.removed).map((p) => p.id);
  }

  private humansOnline() {
    return this.connectedIds().some((id) => !this.players.get(id)!.isBot);
  }

  /** Online und nicht entfernt. */
  private isOnline(id: string) {
    const p = this.players.get(id);
    return !!p && p.connected && !p.removed;
  }

  /** Das sehen Spiele und Brett als „verbunden“: online oder erst seit < 3 s weg (Gnadenfrist). */
  private inPlay(id: string, now = Date.now()) {
    const p = this.players.get(id);
    if (!p || p.removed) return false;
    return p.connected || (!!p.disconnectedAt && now - p.disconnectedAt < DISCONNECT_GRACE_MS);
  }

  /** Seit wann ohne Verbindung (ms, 0 = verbunden) – Spiele lassen eingefrorene Figuren nach 15 s ausscheiden. */
  private offlineMs(id: string, now = Date.now()) {
    const p = this.players.get(id);
    if (!p) return Infinity;
    return p.connected || !p.disconnectedAt ? 0 : now - p.disconnectedAt;
  }

  // ---------------------------------------------------------------- Gnadenfrist & gehaltene Eingaben

  private startGrace(id: string) {
    this.clearGrace(id);
    this.graceTimers.set(
      id,
      setTimeout(() => {
        this.graceTimers.delete(id);
        const p = this.players.get(id);
        if (!p || p.connected || p.removed) return;
        // Erst jetzt erfährt das laufende Spiel (bzw. Übungsspiel) oder Brett vom Verbindungsverlust
        const game = this.liveGame();
        if (game) game.playerDisconnected(id);
        else if (this.phase === 'board') this.board?.playerDisconnected(id);
        this.changed();
      }, DISCONNECT_GRACE_MS),
    );
  }

  private clearGrace(id: string) {
    const t = this.graceTimers.get(id);
    if (t) clearTimeout(t);
    this.graceTimers.delete(id);
  }

  /** Merkt sich gehaltene Eingaben (Stick, Lenkung …), damit sie ohne Nachschub nicht ewig weiterlaufen. */
  private trackHold(id: string, kind: MiniKind, action: string, payload: unknown) {
    if (this.players.get(id)?.isBot) return; // Bots laufen im selben Prozess bzw. Netz und wiederholen nicht im Takt
    const h = holdRelease(kind, action, payload);
    if (!h) return;
    const key = `${id}|${action}`;
    if (h.active) this.holds.set(key, { id, action, at: Date.now(), neutral: h.neutral });
    else this.holds.delete(key);
  }

  /** 700 ms kein neuer Stick → (0,0) an das Spiel (z. B. Handy gesperrt, während der Daumen draufblieb). */
  private releaseStaleHolds() {
    if (!this.holds.size) return;
    const now = Date.now();
    for (const [key, h] of this.holds) {
      if (now - h.at < HOLD_TIMEOUT_MS) continue;
      this.holds.delete(key);
      this.liveGame()?.input(h.id, h.action, h.neutral);
    }
  }

  /** Wer beim nächsten Minispiel mitspielt: Party → nur Spieler auf dem Brett, Date → das Paar, sonst alle Verbundenen. */
  private gameIds() {
    if (this.dateRun) return this.dateRun.state.couple.filter((id) => this.players.has(id) && !this.players.get(id)!.removed);
    if (this.board) return this.board.state.order.filter((id) => this.isOnline(id));
    return this.connectedIds();
  }

  private nameOf(id: string) {
    return this.players.get(id)?.name ?? '?';
  }

  /** Für das Leaderboard des Abends: wer gerade im Raum ist */
  private present() {
    return [...this.players.values()].map(({ id, name, look, connected, removed, isBot }) => ({ id, name, look, connected, removed, isBot }));
  }

  /** Selten wechselnde Daten – gehen als `meta` nur bei Änderung raus. */
  private meta(now = Date.now()): GameMeta {
    return {
      players: [...this.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map(({ id, name, look, color, connected, isVip, disconnectedAt, removed, isBot }) => ({
          id,
          name,
          look,
          color,
          connected,
          isVip,
          ...(!connected && disconnectedAt ? { offlineMs: now - disconnectedAt } : {}),
          ...(removed ? { removed } : {}),
          ...(isBot ? { bot: true } : {}),
        })),
      joinUrl: this.joinUrl,
      onlineUrl: this.onlineUrl,
      customNhieCount: this.nhie.all.length,
      botCount: this.bots.length,
      leaderboard: this.leaderboard.list,
      customQuestionCount: this.questions.all.length,
      customPostCount: this.posts.all.length,
      customQuipCount: this.quips.all.length,
      customWerwarsCount: this.werwarsQ.all.length,
      session: this.session.state(this.present()),
      // Party: Tageszeit vom Brett (Runde 1 morgens … Finale nachts), sonst echte Uhrzeit
      timeOfDay: this.board?.state.timeOfDay ?? clockTimeOfDay(new Date(now)),
      evening: this.fx.stats([...this.players.keys()]),
      reviewed: reviewedKinds(now),
    };
  }

  /** Laufender Zustand – geht bei jeder Änderung als `state` raus. */
  private live(): GameLive {
    return {
      phase: this.phase,
      partyActive: !!this.board,
      mode: this.mode,
      date: this.dateRun?.state ?? null,
      drinkActive: !!this.drinkRun,
      arcadeActive: this.arcadeActive,
      board: this.board?.state ?? null,
      mini: this.liveGame()?.snapshot() ?? null,
      miniSeq: this.miniSeq,
      results: this.results,
      inGame: this.phase === 'mini' ? this.miniIds : this.phase === 'intro' && this.intro?.game ? this.intro.ids : null,
      arcadeVote: this.arcadeVotes ? { votes: Object.fromEntries(this.currentVotes()) } : null,
      skippable: this.skippable(),
      nochmal: this.nochmalState(),
      intro: this.introState(),
      showBoard: this.phase === 'lobby' && this.showBoard,
      partyResume: this.phase === 'lobby' ? partyResumeInfo() : null,
      emotes: this.emotes.state(),
      turnier: this.turnierState(),
    };
  }

  /** Bündelt Zustandsänderungen: sofort senden, aber höchstens alle 30 ms (bei 20-/30-Hz-Spielen also ohne Wartezeit). */
  private changed() {
    if (this.flushTimer) return;
    const wait = Math.max(0, FLUSH_MS - (Date.now() - this.lastFlush));
    this.flushTimer = setTimeout(() => this.flush(), wait);
  }

  private flush() {
    this.flushTimer = null;
    const now = Date.now();
    this.lastFlush = now;
    this.trackBoardCoins();
    // meta nur bei Änderung – „offline seit …“ zählt minutengenau (die Clients rechnen dazwischen selbst weiter)
    const meta = this.meta(now);
    const key = JSON.stringify(meta, (k, v) => (k === 'offlineMs' ? Math.floor(v / 60_000) : v));
    if (key !== this.metaKey) {
      this.metaKey = key;
      this.io.emit('meta', meta);
    }
    this.io.emit('state', this.live());
    // Geheime Infos (z. B. Rolle im Mörderspiel) nur an den jeweiligen Spieler – und nur, wenn sie sich geändert haben
    const seen = new Set<string>();
    for (const p of this.players.values()) {
      if (!p.socketId) continue;
      seen.add(p.socketId);
      const boardPriv = this.phase === 'board' ? this.board?.privateFor(p.id) : null;
      const priv: PrivateState = boardPriv ? { kind: 'board', state: boardPriv } : (this.liveGame()?.privateFor?.(p.id) ?? null);
      const json = JSON.stringify(priv);
      if (this.privKeys.get(p.socketId) === json) continue;
      this.privKeys.set(p.socketId, json);
      this.io.to(p.socketId).emit('private', priv);
    }
    for (const sid of this.privKeys.keys()) if (!seen.has(sid)) this.privKeys.delete(sid);
  }
}
