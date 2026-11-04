/**
 * Ein automatischer Testspieler. Wird vom Skript `npm run bots` und
 * direkt vom Server ("Bot hinzufügen" in der Lobby) benutzt.
 */
import { io, type Socket } from 'socket.io-client';
import type { ArenaState, GameState, IgelState, KurveState, ParcoursState, PrivateState, SmashFighter, SmashState, TttState, TurmLane } from '../shared/types';
import { ARENA, type ArenaCell, DIRS, FLOOD_ORDER, blastCells, cellIdx } from '../shared/arena';
import { BASE_SOLIDS, PARCOURS, PART_DEFS, type Rect, canPlace, overlaps, partRect, snap } from '../shared/parcours';
import { BAZOOKA, GRENADE, PUNCH, type Mask, buildTerrain, carve, simulateBazooka, surfaceY } from '../shared/igel';
import { randomLook } from '../shared/avatar';
import { BOTTLE, RANGE, THROW_SPOT, WIND_K } from '../shared/flunky';
import { KURVE, ROOMS, TTT, TURM, turmCellOffsets } from '../shared/games';
import { type TrailCursor, ingestTrail, walkLine } from '../shared/kurve';
import { lineFree, nextWaypoint, roomInner } from '../shared/house';
import { SMASH_STAGES, mainPlatform } from '../shared/smash';
import { GEIST, inCone, navTarget, roomCenter } from '../shared/geist';
import { CONSTELLATIONS, DESCENT_OBSTACLES, WRAP_DISTRACTORS, WRAP_RECIPE } from '../shared/dategames';
import { PROPS, VS, type PropType, baseRect, canStand, judgeSpot, nextWaypoint as verstWaypoint, overlap, pickTarget, zoneAt } from '../shared/verstecken';
import { autopilot, getTrack } from '../shared/kart';
import { WASSER, WASSER_BASE, WASSER_BLOCKERS, WASSER_HOSE, type WasserState } from '../shared/wasser';
import { grillBot } from './grillbot';
import { POST, POST_COLORS, POST_PROMPTS } from '../shared/stillepost';
import type { PostDrawing } from '../shared/types';
import { WALK_TILES, bfsFrom, distAt, isWalkTile, nextStepTowards, tileCenter, tileOf } from '../shared/fangen';
import type { FangenState } from '../shared/types';

export interface BotOptions {
  url: string;
  /** Leader startet Spiele und klickt "Weiter" (nur im Test-Skript) */
  leader?: boolean;
  game?: string;
  date?: boolean;
  count?: number;
  /** Ausgaben (z. B. Phasenwechsel) */
  log?: (msg: string) => void;
  onDone?: () => void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Bot {
  socket: Socket;
  id = '';
  state: GameState | null = null;
  priv: PrivateState = null;
  busy = new Set<string>();
  phasesSeen = new Set<string>();

  leader: boolean;
  private resultCount = 0;
  private resultsEntered = 0;
  private lastPhase = '';
  /** Stille Post: bereits erledigte Schritte/Abstimmungen */
  private postDone = new Set<string>();
  private timer: NodeJS.Timeout;
  /** Kurven-Duell: eigene Kopie aller Spuren (der Snapshot enthält nur die letzten Punkte) */
  private kv = {
    round: -1,
    others: new Uint8Array(480 * 270),
    /** eigene Spur: Punktindex + 1 */
    own: new Int32Array(480 * 270),
    cursors: new Map<string, TrailCursor>(),
    turn: 0,
    sentAt: 0,
    wanderUntil: 0,
    horizon: 30,
  };
  /** Ententeich: eigenes Fadenkreuz + aktuelles Ziel */
  private aim = { x: 200, y: 135 };
  private aimTarget: number | null = null;
  private lastFire = 0;
  /** Gedächtnis für "Verräter im Ferienhaus" */
  private ttt = { round: 0, grudges: new Set<string>(), lastAttack: 0, goal: null as { x: number; y: number } | null, stuckX: 0, stuckY: 0, stuckAt: 0 };
  /** Versteckspiel: Plan des Verstecker-Bots bzw. Gedächtnis des Sucher-Bots */
  vs = {
    round: 0,
    spot: null as { x: number; y: number; t: PropType } | null,
    seen: new Map<number, { x: number; y: number; movedAt: number }>(),
    checked: new Set<number>(),
    target: null as number | null,
    targetSince: 0,
    whistle: null as { x: number; y: number; at: number } | null,
    lastWhistleSeq: 0,
    lastPos: { x: 0, y: 0, at: 0 },
    wander: null as { x: number; y: number } | null,
  };
  /** Fallen-Parcours: Bauziel, gedrosselte Eingaben, Sprung-Halten */
  private pc = { target: null as { round: number; x: number; y: number; rot: number } | null, stick: '', stickAt: 0, actAt: 0, jumping: false, sloppy: Math.random() * 0.25 };
  /** Kart-Rennen: eigene Ideallinie (seitlicher Versatz) und Item-Zeitpunkt */
  private kartLane = rand(-6, 6);
  private kartItemAt = 0;
  /** Kurzzeitgedächtnis für die Smash-Arena */
  private sm = { shieldUntil: 0, lastJump: 0, lastA: 0, lastB: 0, stick: '', stickAt: 0 };
  /** Wasserbomben-Schlacht: kleines Bot-Gedächtnis */
  private ws = { nextThrow: 0, lastX: 0, lastY: 0, checkAt: 0, wanderUntil: 0, wx: 0, wy: 0, strafe: 1, strafeAt: 0 };
  /** Urlaubs-Fangen: Gedächtnis des Bots (nur, was auch auf dem TV zu sehen ist) */
  private fg: FangenMemory = { round: 0, seen: new Set(), goal: null, until: 0 };
  /** Geisterjagd: Gedächtnis gegen Festhängen an Möbeln */
  private gj = { px: 0, py: 0, checkAt: 0, jitterUntil: 0, jx: 0, jy: 0 };

  constructor(
    public name: string,
    private opts: BotOptions,
  ) {
    this.leader = !!opts.leader;
    this.socket = io(opts.url, { transports: ['websocket'], forceNew: true });
    // Regelmäßig "nachdenken" – der Zustand kommt nicht immer, wenn der Bot dran ist
    this.timer = setInterval(() => this.state && this.react(this.state), 200);
    this.socket.on('connect', () => {
      this.socket.emit('player:join', { name, look: randomLook(), bot: true }, (r: { ok: boolean; playerId?: string; error?: string }) => {
        if (r.ok) this.id = r.playerId!;
        else opts.log?.(`${name}: ${r.error}`);
      });
    });
    this.socket.on('private', (p: PrivateState) => (this.priv = p));
    this.socket.on('state', (s: GameState) => {
      this.state = s;
      this.react(s);
    });
  }

  /** Kurven-Duell: Spuren mitschreiben und per Vorausschau lenken */
  private playKurve(st: KurveState) {
    const kv = this.kv;
    if (st.round !== kv.round) {
      kv.round = st.round;
      kv.others.fill(0);
      kv.own.fill(0);
      kv.cursors.clear();
      kv.horizon = Math.round(rand(22, 48));
      kv.turn = 0;
    }
    for (const [id, h] of Object.entries(st.players)) {
      let cur = kv.cursors.get(id);
      if (!cur) kv.cursors.set(id, (cur = { idx: -1, x: 0, y: 0 }));
      const mine = id === this.id;
      const c = cur;
      ingestTrail(h, cur, (x0, y0, x1, y1) =>
        walkLine(x0, y0, x1, y1, (x, y) => {
          const cx = Math.round(x);
          const cy = Math.round(y);
          for (let yy = cy - 1; yy <= cy + 1; yy++) {
            for (let xx = cx - 1; xx <= cx + 1; xx++) {
              if (xx < 0 || yy < 0 || xx >= 480 || yy >= 270) continue;
              if (mine) kv.own[yy * 480 + xx] = c.idx + 2;
              else kv.others[yy * 480 + xx] = 1;
            }
          }
        }),
      );
    }
    const me = st.players[this.id];
    if (!me || !me.alive || st.sub !== 'play') {
      if (kv.turn !== 0) {
        kv.turn = 0;
        this.send('turn', { dir: 0 });
      }
      return;
    }
    this.once('kurve', async () => {
      await sleep(rand(40, 90));
      const ownLatest = (kv.cursors.get(this.id)?.idx ?? 0) + 1;
      const score = (d: number) => kurveLookAhead(st, this.id, kv, d, kv.horizon, ownLatest);
      const now = Date.now();
      const first = now < kv.wanderUntil ? kv.turn : 0;
      const opts = [first, kv.turn, 0, -1, 1].filter((d, i, arr) => arr.indexOf(d) === i).map((d) => ({ d, s: score(d) }));
      const best = Math.max(...opts.map((o) => o.s));
      let dir = opts.find((o) => o.s === best)!.d;
      // Alles frei? Ab und zu eine Kurve fahren – sieht lebendiger aus
      if (best > kv.horizon && Math.random() < 0.05) {
        const free = opts.filter((o) => o.s > kv.horizon);
        dir = free[Math.floor(Math.random() * free.length)].d;
        kv.wanderUntil = now + rand(250, 900);
      }
      if (dir !== kv.turn || now - kv.sentAt > 400) {
        kv.turn = dir;
        kv.sentAt = now;
        this.send('turn', { dir });
      }
    });
  }

  private arenaStick = false;

  /**
   * Bomben-Arena-KI: Gefahr erkennen (Explosionslinien inkl. Kettenreaktion, Flut),
   * bei Gefahr zur nächsten sicheren Kachel fliehen, sonst Kisten/Gegner/Power-ups ansteuern
   * und nur dann eine Bombe legen, wenn danach ein Fluchtweg frei ist.
   */
  private arenaThink(st: ArenaState) {
    const me = st.players[this.id];
    if (!me?.alive) return;
    const W = ARENA.COLS;
    const cellAt = (x: number, y: number): ArenaCell => (x < 0 || y < 0 || x >= W || y >= ARENA.ROWS ? '#' : (st.grid[cellIdx(x, y)] as ArenaCell));
    const bombCells = new Set(st.bombs.map((b) => cellIdx(b.x, b.y)));
    const bombAt = (x: number, y: number) => bombCells.has(cellIdx(x, y));
    const mx = Math.round(me.x);
    const my = Math.round(me.y);
    const myIdx = cellIdx(mx, my);
    const msPerTile = 1000 / (ARENA.SPEED + me.speed * ARENA.SPEED_STEP);

    // Gefahrenkarte: Zelle → ms bis zum Treffer
    const danger = new Map<number, number>();
    const mark = (i: number, t: number) => danger.set(i, Math.min(danger.get(i) ?? Infinity, t));
    for (const f of st.flames) mark(cellIdx(f.x, f.y), 0);
    const bombs = st.bombs.map((b) => ({ ...b, t: b.fuse }));
    for (let k = 0; k < 3; k++) {
      for (const b of bombs) {
        for (const c of blastCells(cellAt, bombAt, b.x, b.y, b.range)) {
          const o = bombs.find((ob) => ob.x === c.x && ob.y === c.y);
          if (o && o.t > b.t) o.t = b.t;
        }
      }
    }
    for (const b of bombs) for (const c of blastCells(cellAt, bombAt, b.x, b.y, b.range)) mark(cellIdx(c.x, c.y), b.t);
    const floodIn = st.floodActive ? 0 : st.endsIn;
    if (floodIn < 6000) {
      for (let j = st.flood; j < Math.min(FLOOD_ORDER.length, st.flood + 40); j++) mark(FLOOD_ORDER[j], floodIn + (j - st.flood) * ARENA.FLOOD_STEP_MS);
    }

    const walk = (x: number, y: number) => cellAt(x, y) === '.' && (!bombAt(x, y) || cellIdx(x, y) === myIdx);
    /** Breitensuche ab der eigenen Kachel; meidet Zellen, die beim Durchlaufen gerade explodieren */
    const bfs = (extra?: Map<number, number>, strict = false) => {
      const prev = new Map<number, number>([[myIdx, -1]]);
      const dist = new Map<number, number>([[myIdx, 0]]);
      const queue = [myIdx];
      while (queue.length) {
        const i = queue.shift()!;
        const x = i % W;
        const y = Math.floor(i / W);
        const d = dist.get(i)!;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          const ni = cellIdx(nx, ny);
          if (prev.has(ni) || !walk(nx, ny)) continue;
          const arrive = (d + 1) * msPerTile;
          const t = Math.min(danger.get(ni) ?? Infinity, extra?.get(ni) ?? Infinity);
          if (t <= arrive + 600 && t > arrive - 900) continue;
          if (t === 0 || (strict && t < Infinity)) continue;
          prev.set(ni, i);
          dist.set(ni, d + 1);
          queue.push(ni);
        }
      }
      return { prev, dist };
    };
    const firstStep = (prev: Map<number, number>, target: number) => {
      let cur = target;
      while (prev.get(cur) !== myIdx && prev.get(cur) !== -1 && prev.has(cur)) cur = prev.get(cur)!;
      return cur;
    };
    /** final = Zielkachel (dort anhalten). Wegen der Verzögerung früh bremsen, sonst rutscht man drüber. */
    const goTo = (i: number, final: boolean) => {
      const dx = (i % W) - me.x;
      const dy = Math.floor(i / W) - me.y;
      const len = Math.hypot(dx, dy);
      if (len < (final ? 0.4 : 0.05)) return this.stop2();
      this.arenaStick = true;
      this.send('stick', { x: Math.round((dx / len) * 100) / 100, y: Math.round((dy / len) * 100) / 100 });
    };
    const isSafe = (i: number, extra?: Map<number, number>) => !danger.has(i) && !extra?.has(i);

    // 1) In Gefahr → fliehen
    if (danger.has(myIdx)) {
      const { prev, dist } = bfs();
      let best = -1;
      let bestD = Infinity;
      for (const [i, d] of dist) if (isSafe(i) && d < bestD) ((best = i), (bestD = d));
      if (best < 0) for (const [i] of dist) if ((danger.get(i) ?? 0) > (danger.get(best) ?? -1)) best = i;
      if (best >= 0 && best !== myIdx) {
        const step = firstStep(prev, best);
        goTo(step, step === best);
      } else goTo(myIdx, true);
      return;
    }

    // 2) Bombe legen, wenn sie etwas trifft und ein Fluchtweg frei ist
    const enemies = Object.entries(st.players).filter(([id, p]) => id !== this.id && p.alive);
    const hits = (x: number, y: number) => {
      let boxes = 0;
      let foes = 0;
      for (const c of blastCells(cellAt, bombAt, x, y, me.range)) {
        if (cellAt(c.x, c.y) === 'b') boxes++;
        if (enemies.some(([, p]) => Math.round(p.x) === c.x && Math.round(p.y) === c.y)) foes++;
      }
      return { boxes, foes };
    };
    const mine = st.bombs.filter((b) => b.owner === this.id).length;
    const centered = Math.abs(me.x - mx) < 0.4 && Math.abs(me.y - my) < 0.4;
    if (mine < me.bombs && centered && !bombAt(mx, my)) {
      const h = hits(mx, my);
      const foeNear = enemies.some(([, p]) => Math.abs(p.x - mx) + Math.abs(p.y - my) <= 2.2);
      if (h.boxes > 0 || h.foes > 0 || (foeNear && Math.random() < 0.5)) {
        const extra = new Map<number, number>();
        for (const c of blastCells(cellAt, bombAt, mx, my, me.range)) extra.set(cellIdx(c.x, c.y), ARENA.FUSE_MS);
        const { dist } = bfs(extra);
        const escape = [...dist].some(([i, d]) => d <= 6 && d * msPerTile < ARENA.FUSE_MS - 700 && isSafe(i, extra));
        if (escape && Math.random() < 0.85) {
          // Erst anhalten – sonst landet die Bombe (Netzwerk-Verzögerung) eine Kachel weiter
          if (me.moving || this.arenaStick) this.stop2();
          else this.send('bomb');
          return;
        }
      }
    }

    // 3) Ziel suchen: Power-ups, Kisten, Gegner (nur über sichere Zellen)
    const { prev, dist } = bfs(undefined, true);
    const itemCells = new Set(st.items.map((it) => cellIdx(it.x, it.y)));
    const boxesLeft = [...st.grid].filter((c) => c === 'b').length;
    let best = -1;
    let bestScore = Infinity;
    for (const [i, d] of dist) {
      if (!isSafe(i)) continue;
      const x = i % W;
      const y = Math.floor(i / W);
      let score = d + Math.random() * 0.8;
      const near = Math.min(...enemies.map(([, p]) => Math.abs(p.x - x) + Math.abs(p.y - y)), 99);
      if (itemCells.has(i)) score -= 8;
      else {
        const h = hits(x, y);
        if (h.foes) score -= 6;
        else if (h.boxes) score -= 3 + h.boxes;
        // Gegner jagen – je weniger Kisten übrig sind, desto stärker
        score += near * (boxesLeft < 25 ? 0.9 : 0.35);
      }
      if (score < bestScore) ((bestScore = score), (best = i));
    }
    if (best >= 0 && best !== myIdx) {
      const step = firstStep(prev, best);
      goTo(step, step === best);
    } else goTo(myIdx, true);
  }

  private stop2() {
    if (!this.arenaStick) return;
    this.arenaStick = false;
    this.send('stick', { x: 0, y: 0 });
  }

  playVerstecken(m: VerstStateT) {
    vsStep(this, m);
  }

  private smashBrain(st: SmashState, me: SmashFighter) {
    smashThink(this, this.sm, st, me);
  }

  stop() {
    clearInterval(this.timer);
    this.socket.disconnect();
  }

  send(action: string, payload?: unknown) {
    this.socket.emit('mini:input', { action, payload });
  }

  /** Führt eine Aktion pro Schlüssel nur einmal gleichzeitig aus */
  once(key: string, fn: () => Promise<void> | void) {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    Promise.resolve(fn()).finally(() => setTimeout(() => this.busy.delete(key), 50));
  }

  private stickTo(x: number, y: number) {
    const key = `${x.toFixed(1)},${y.toFixed(1)}`;
    const now = Date.now();
    if (key === this.pc.stick && now - this.pc.stickAt < 400) return;
    this.pc.stick = key;
    this.pc.stickAt = now;
    this.send('stick', { x, y });
  }

  /** Bauen: zufälliges Teil an eine freie Stelle; Laufen: rennen und über Lücken/Fallen springen */
  private parcours(st: ParcoursState) {
    const now = Date.now();
    if (st.sub === 'build') {
      const b = st.builders[this.id];
      if (!b || b.stage === 'done') return;
      if (b.stage === 'pick') {
        this.pc.target = null;
        this.once(`pc-pick-${st.round}`, async () => {
          await sleep(rand(500, 1600));
          const opts = b.choice.filter((t) => t !== 'bomb' || st.parts.length > 3);
          const pool = opts.length ? opts : b.choice;
          this.send('pick', { type: pool[Math.floor(Math.random() * pool.length)] });
        });
        return;
      }
      const type = b.pick!;
      if (!this.pc.target || this.pc.target.round !== st.round) {
        const rot = Math.floor(Math.random() * PART_DEFS[type].rots);
        let spot: { x: number; y: number } | null = null;
        if (type === 'bomb' && st.parts.length) {
          const p = st.parts[Math.floor(Math.random() * st.parts.length)];
          spot = { x: p.x, y: p.y };
        }
        for (let i = 0; i < 60 && !spot; i++) {
          const x = snap(rand(100, 390));
          // gemein, aber schaffbar: meist knapp über der Laufhöhe
          const y = snap(Math.random() < 0.4 ? rand(165, 240) : rand(70, 165));
          if (canPlace(type, x, y, rot, st.parts)) spot = { x, y };
        }
        this.pc.target = { round: st.round, x: spot?.x ?? b.gx, y: spot?.y ?? b.gy, rot };
      }
      const t = this.pc.target;
      if (b.rot !== t.rot && now - this.pc.actAt > 250) {
        this.pc.actAt = now;
        this.send('rotate');
      }
      const dx = t.x - b.gx;
      const dy = t.y - b.gy;
      const d = Math.hypot(dx, dy);
      if (d <= 3) {
        this.stickTo(0, 0);
        if (b.rot === t.rot && now - this.pc.actAt > 300) {
          this.pc.actAt = now;
          if (b.ok) this.send('place');
          else this.pc.target = { ...t, x: snap(rand(100, 390)), y: snap(rand(70, 240)) };
        }
      } else {
        const k = Math.min(1, d / 25);
        this.stickTo((dx / d) * k, (dy / d) * k);
      }
      return;
    }
    if (st.sub !== 'run' && st.sub !== 'countdown') return;
    const r = st.runners[this.id];
    if (!r || r.st !== 'run') return;
    if (st.sub === 'countdown') return this.stickTo(0, 0);
    this.stickTo(1, 0);
    if (this.pc.jumping || !r.ground) return;
    const solids: Rect[] = [...BASE_SOLIDS];
    for (const p of st.parts) if (PART_DEFS[p.type].kind !== 'hazard' && p.type !== 'bomb') solids.push(partRect(p, st.t));
    const hit = (rc: Rect) => solids.some((s) => overlaps(rc, s));
    const gapAhead = !hit({ x: r.x + 3, y: r.y + 1, w: 6, h: 40 });
    const wallAhead = hit({ x: r.x + 4, y: r.y - PARCOURS.PH + 2, w: 10, h: PARCOURS.PH - 4 });
    const danger =
      st.parts.some((p) => p.type === 'urchin' && overlaps(partRect(p), { x: r.x + 2, y: r.y - 40, w: 26, h: 44 })) ||
      st.nuts.some((n) => Math.abs(n.x - r.x) < 34 && Math.abs(n.y - (r.y - 6)) < 14);
    if ((gapAhead || wallAhead || danger) && Math.random() > this.pc.sloppy) {
      this.pc.jumping = true;
      this.send('jump', { down: true });
      setTimeout(() => {
        this.send('jump', { down: false });
        this.pc.jumping = false;
      }, rand(200, 340));
    }
  }

  /** Wasserbomben-Schlacht: hinlaufen, Abstand halten, mit Streuung werfen, nachfüllen, fliehen */
  private wasserStep(st: WasserState) {
    const me = st.players[this.id];
    if (!me) return;
    if (st.sub !== 'play') return this.send('stick', { x: 0, y: 0 });
    const now = Date.now();
    const mem = this.ws;
    const dist = (a: BotPoint, b: BotPoint) => Math.hypot(a.x - b.x, a.y - b.y);
    const bases = me.t ? [WASSER_BASE[me.t]] : [WASSER_BASE.A, WASSER_BASE.B];
    const nearest = (pts: BotPoint[]) => pts.reduce((a, b) => (dist(me, a) <= dist(me, b) ? a : b));
    const enemies = Object.entries(st.players).filter(([id, p]) => id !== this.id && (st.ffa || p.t !== me.t));
    const targets = enemies.filter(([, p]) => p.s === 'ok').map(([, p]) => p);
    const target = targets.length ? targets.reduce((a, b) => (dist(me, a) <= dist(me, b) ? a : b)) : null;
    let goal: BotPoint | null = null;

    if (me.s === 'drying') return this.send('stick', { x: 0, y: 0 });
    if (me.s === 'soaked') goal = nearest(bases.map((b) => b.towel));
    else if (me.w > 75 && target && dist(me, target) < 140) goal = nearest(bases.map((b) => b.bucket));
    else if (me.a === 0 && me.pi === 0) {
      const bucket = nearest(bases.map((b) => b.bucket));
      goal = dist(me, WASSER_HOSE) < dist(me, bucket) * 1.3 ? WASSER_HOSE : bucket;
    } else if (st.pistol && me.pi === 0 && dist(me, st.pistol) < 110) goal = st.pistol;
    else if (target) {
      const d = dist(me, target);
      const want = me.pi > 0 ? 34 : 90;
      if (now > mem.strafeAt) {
        mem.strafe = Math.random() < 0.5 ? 1 : -1;
        mem.strafeAt = now + rand(1200, 2600);
      }
      if (d > want + 15) goal = target;
      else if (d < want - 25) goal = { x: me.x + ((me.x - target.x) / d) * 30, y: me.y + ((me.y - target.y) / d) * 30 };
      else goal = { x: me.x + (-(target.y - me.y) / d) * 25 * mem.strafe, y: me.y + ((target.x - me.x) / d) * 25 * mem.strafe };
      // Werfen (mit Streuung) bzw. spritzen
      if (me.pi > 0) {
        if (d < WASSER.PISTOL_RANGE + 8) this.send('aim', { x: (target.x - me.x) / d, y: (target.y - me.y) / d });
      } else if (me.a > 0 && d < WASSER.RANGE * 0.95 && now > mem.nextThrow) {
        mem.nextThrow = now + rand(900, 1800);
        const vx = (target.x - me.x) / WASSER.RANGE + rand(-0.08, 0.08);
        const vy = (target.y - me.y) / WASSER.RANGE + rand(-0.08, 0.08);
        this.send('aim', { x: vx, y: vy });
        setTimeout(() => this.send('throw', { x: vx, y: vy }), rand(250, 450));
      }
    } else goal = nearest(bases.map((b) => b.bucket));

    // Festgefahren? Kurz zufällig laufen
    if (now > mem.checkAt) {
      const moved = Math.hypot(me.x - mem.lastX, me.y - mem.lastY);
      if (goal && moved < 3 && dist(me, goal) > 12) {
        const a = Math.random() * Math.PI * 2;
        mem.wx = Math.cos(a);
        mem.wy = Math.sin(a);
        mem.wanderUntil = now + 600;
      }
      mem.lastX = me.x;
      mem.lastY = me.y;
      mem.checkAt = now + 1000;
    }
    if (now < mem.wanderUntil) return this.send('stick', { x: mem.wx, y: mem.wy });
    this.send('stick', goal ? steer(me, goal) : { x: 0, y: 0 });
  }

  react(s: GameState) {
    if (!this.id) return;
    const me = s.players.find((p) => p.id === this.id);
    const tag = s.phase === 'mini' ? `mini:${s.mini?.kind}` : s.phase;
    if (s.phase !== this.lastPhase) {
      if (s.phase === 'results') this.resultsEntered++;
      this.lastPhase = s.phase;
    }
    if (!this.phasesSeen.has(tag)) {
      this.phasesSeen.add(tag);
      if (this.leader) this.opts.log?.(`[${new Date().toLocaleTimeString()}] Phase: ${tag}`);
    }

    if (s.phase === 'lobby' && this.leader && me?.isVip && s.players.filter((p) => p.connected).length >= (this.opts.count ?? 1)) {
      this.once('start', async () => {
        await sleep(1500);
        this.socket.emit('vip:start', this.opts.date ? { mode: 'date' } : this.opts.game ? { mode: this.opts.game } : { mode: 'party', rounds: 3 });
      });
    }
    if (s.phase === 'results' && this.leader && me?.isVip) {
      this.once(`results-${this.resultsEntered}`, async () => {
        await sleep(4000);
        this.resultCount++;
        const drink = this.opts.game === 'drink';
        const done = s.results?.final || (this.opts.game && !drink);
        if (done && !this.opts.date) {
          const rows = s.results!.rows.map((r) => `${r.place}. ${s.players.find((p) => p.id === r.playerId)?.name} (${r.detail})`).join(' | ');
          this.opts.log?.(`Endstand: ${rows}`);
          this.opts.log?.(`FERTIG – alle Phasen durchlaufen: ${[...this.phasesSeen].join(', ')}`);
          this.opts.onDone?.();
        }
        this.socket.emit('vip:continue', drink && this.resultCount >= 4 ? 'end' : undefined);
      });
    }
    if (s.phase === 'story' && this.leader && s.date?.card) {
      const card = s.date.card;
      this.once(`story-${card.title}`, async () => {
        await sleep(2500);
        if (card.final) {
          this.opts.log?.(`Date vorbei: ${s.date!.totalHearts}/${s.date!.maxHearts} Herzen (${s.date!.hearts.join(', ')})`);
          this.opts.log?.(`FERTIG – alle Phasen durchlaufen: ${[...this.phasesSeen].join(', ')}`);
          setTimeout(() => this.opts.onDone?.(), 300);
        }
        this.socket.emit('story:next');
      });
    }
    if (s.phase === 'board' && s.board?.sub === 'roll' && s.board.order[s.board.turnIdx] === this.id) {
      this.once(`roll-${s.board.round}-${s.board.turnIdx}`, async () => {
        await sleep(rand(600, 1500));
        this.socket.emit('board:roll');
      });
    }
    if (s.phase !== 'mini' || !s.mini) return;

    const m = s.mini;
    if (m.kind === 'flunky') {
      const f = m.state;
      if (f.sub === 'aim' && f.throwerId === this.id) {
        this.once(`throw-${f.lastThrow?.seq ?? 0}`, async () => {
          await sleep(rand(800, 1800));
          const team = f.teams.A.includes(this.id) ? 'A' : 'B';
          const power = Math.abs(BOTTLE.x - THROW_SPOT[team].x) / RANGE + rand(-0.07, 0.07);
          this.send('throw', { angle: -f.wind * WIND_K + rand(-0.1, 0.1), power });
        });
      }
      if (f.sub === 'chug') {
        const drinking = f.teams[f.turnTeam].includes(this.id) && f.beer[this.id] > 0;
        if (drinking || f.runnerId === this.id) {
          this.once('tap', async () => {
            for (let i = 0; i < 6; i++) {
              this.send('tap');
              await sleep(rand(70, 140));
            }
          });
        }
      }
    }

    if (m.kind === 'wwe' && m.state.sub === 'question' && !m.state.voted.includes(this.id)) {
      this.once(`wwe-${m.state.round}`, async () => {
        await sleep(rand(1000, 4000));
        const ids = Object.keys(m.state.points);
        this.send('vote', { target: ids[Math.floor(Math.random() * ids.length)] });
      });
    }

    if (m.kind === 'sprint') {
      const sp = m.state;
      if (sp.sub === 'go' && sp.times[this.id] === null) {
        this.once(`sprint-${sp.goSeq}`, async () => {
          const ms = rand(180, 600);
          await sleep(ms);
          this.send('tap', { seq: sp.goSeq, ms: Math.round(ms) });
        });
      }
      if (sp.sub === 'wait' && Math.random() < 0.01) this.send('tap', { seq: -1, ms: 0 }); // seltener Fehlstart
    }

    if (m.kind === 'descent' && m.state.sub === 'run') {
      const r = m.state.runners[this.id];
      if (r && !r.finished && !r.stunned && r.jumpLeft === 0) {
        const stoneBehind = m.state.stones.some((st) => r.s - st.s > 0 && r.s - st.s < 20);
        const obAhead = DESCENT_OBSTACLES.some((o) => o.s - r.s > 3 && o.s - r.s < 16);
        if ((stoneBehind || obAhead) && Math.random() < 0.85) this.send('jump');
      }
    }

    if (m.kind === 'rhythm') {
      const rs = m.state;
      if (rs.sub === 'ready' && !rs.ready.includes(this.id)) this.once('rh-ready', () => this.send('ready'));
      if (rs.sub === 'play') {
        this.once(`rh-play-${rs.playSeq}`, async () => {
          const t0 = Date.now();
          const notes = rs.charts[this.id] ?? [];
          for (let i = 0; i < notes.length; i++) {
            const wait = notes[i].t - (Date.now() - t0);
            if (wait > 0) await sleep(wait);
            const roll = Math.random();
            this.send('hit', { i, q: roll < 0.6 ? 2 : roll < 0.85 ? 1 : 0 });
          }
          await sleep(5000);
        });
      }
    }

    if (m.kind === 'wrap' && m.state.sub === 'build') {
      const p = m.state.players[this.id];
      if (p && !p.done) {
        this.once('wrap', async () => {
          await sleep(rand(700, 1400));
          const item = Math.random() < 0.8 ? WRAP_RECIPE[p.step] : WRAP_DISTRACTORS[Math.floor(Math.random() * 3)];
          this.send('grab', { item });
        });
      }
    }

    if (m.kind === 'stars' && m.state.sub === 'draw') {
      const st = m.state;
      this.once(`stars-${st.round}-${st.found.length}`, async () => {
        await sleep(rand(900, 1800));
        const edges = solveConstellation(st.name, st.stars);
        const open = edges.filter(([a, b]) => !st.found.some(([x, y]) => (x === a && y === b) || (x === b && y === a)));
        if (!open.length) return;
        if (Math.random() < 0.12) {
          const ids = st.stars.map((s2) => s2.id);
          this.send('link', { a: ids[0], b: ids[ids.length - 1] });
        } else {
          const [a, b] = open[Math.floor(Math.random() * open.length)];
          this.send('link', { a, b });
        }
      });
    }

    if (m.kind === 'nhie' && m.state.sub === 'question' && !m.state.answered.includes(this.id)) {
      this.once(`nhie-${m.state.round}`, async () => {
        await sleep(rand(800, 3000));
        this.send('answer', { have: Math.random() < 0.45 });
      });
    }
    if (m.kind === 'hilo' && m.state.sub === 'guess' && !m.state.guessed.includes(this.id)) {
      const card = m.state.card;
      this.once(`hilo-${m.state.round}`, async () => {
        await sleep(rand(800, 3000));
        this.send('guess', { dir: card < 8 ? 'higher' : card > 8 ? 'lower' : Math.random() < 0.5 ? 'higher' : 'lower' });
      });
    }
    if (m.kind === 'bomb' && m.state.sub === 'pass' && m.state.holder === this.id) {
      this.once(`bomb-${m.state.passSeq}`, async () => {
        await sleep(rand(1200, 3500));
        this.send('pass');
      });
    }

    if (m.kind === 'sup' && m.state.sub === 'race') {
      const b = m.state.boards.find((bb) => bb.left === this.id || bb.right === this.id);
      if (b && !b.finished && !b.fallen) {
        this.once('sup', async () => {
          await sleep(rand(230, 380));
          const ahead = m.state.obstacles.find((o) => o.x > b.x && o.x - b.x < 70 && Math.abs(o.y - b.y) < o.r + 14);
          const targetY = ahead ? (ahead.y > b.y ? ahead.y - 34 : ahead.y + 34) : b.y;
          const want = Math.max(-0.5, Math.min(0.5, (targetY - b.y) / 60));
          const sides: ('left' | 'right')[] = b.left === b.right ? [b.strokes.left <= b.strokes.right ? 'left' : 'right'] : [b.left === this.id ? 'left' : 'right'];
          for (const side of sides) {
            const ok = side === 'left' ? b.heading <= want + 0.12 && b.balance < 0.55 : b.heading >= want - 0.12 && b.balance > -0.55;
            if (ok) this.send('paddle', { side });
          }
        });
      }
    }

    if (m.kind === 'turm' && m.state.sub === 'play') {
      const lane = m.state.lanes.find((l) => l.id === this.id);
      const act = lane?.active;
      if (lane && act) {
        this.once(`turm-${act.id}`, async () => {
          const plan = planTurm(lane);
          await sleep(rand(250, 600));
          for (let i = 0; i < (plan.rot - act.rot + 4) % 4; i++) {
            this.send('rotate');
            await sleep(rand(110, 200));
          }
          const cur = () => {
            const s2 = this.state?.mini?.kind === 'turm' ? this.state.mini.state : null;
            return s2?.lanes.find((l) => l.id === this.id)?.active;
          };
          for (let i = 0; i < 40; i++) {
            const a = cur();
            if (!a || a.id !== act.id) return;
            const dx = plan.x - a.x;
            if (Math.abs(dx) < TURM.BLOCK / 4) break;
            this.send('shift', { dir: Math.sign(dx) });
            await sleep(rand(100, 170));
          }
          await sleep(rand(100, 400));
          if (cur()?.id === act.id) this.send('drop', { on: true });
          for (let i = 0; i < 60 && cur()?.id === act.id; i++) await sleep(100);
          this.send('drop', { on: false });
        });
      }
    }

    if (m.kind === 'tidy' && m.state.sub === 'play') {
      const t = m.state;
      const me2 = t.players[this.id];
      const basket = t.baskets.find((bk) => bk.team === me2?.team) ?? t.baskets[0];
      if (me2 && basket) {
        this.once('tidy', async () => {
          await sleep(90);
          const item = [...t.items].sort((a, b) => Math.hypot(a.x - me2.x, a.y - me2.y) + Math.hypot(a.x - basket.x, a.y - basket.y) * 0.5 - (Math.hypot(b.x - me2.x, b.y - me2.y) + Math.hypot(b.x - basket.x, b.y - basket.y) * 0.5))[0];
          if (!item) return this.send('stick', { x: 0, y: 0 });
          const ux = basket.x - item.x;
          const uy = basket.y - item.y;
          const ul = Math.hypot(ux, uy) || 1;
          const px = item.x - (ux / ul) * 13;
          const py = item.y - (uy / ul) * 13;
          const dx = px - me2.x;
          const dy = py - me2.y;
          const dl = Math.hypot(dx, dy);
          if (dl > 5) this.send('stick', { x: dx / dl, y: dy / dl });
          else this.send('stick', { x: ux / ul, y: uy / ul });
          if (Math.random() < 0.02) this.send('dash');
        });
      }
    }

    if (m.kind === 'flieger' && m.state.sub === 'fly') {
      const p = this.priv?.kind === 'flieger' ? this.priv.state : null;
      for (const h of p?.botHints ?? []) {
        const c = p!.panel.find((x) => x.id === h.c);
        if (!c) continue;
        this.once(`fl-${h.c}`, async () => {
          // "Zuhören" dauert – und manchmal greift man daneben
          await sleep(rand(1200, 4000));
          if (Math.random() < 0.15) {
            const wrong = p!.panel[Math.floor(Math.random() * p!.panel.length)];
            this.send('act', { c: wrong.id, v: Math.floor(Math.random() * Math.max(1, wrong.labels.length)) });
            return;
          }
          if (c.type === 'tap') {
            for (let i = 0; i < h.taps; i++) {
              this.send('act', { c: c.id });
              await sleep(rand(90, 180));
            }
          } else {
            this.send('act', { c: c.id, v: h.v });
          }
          await sleep(300);
        });
      }
    }
    if (m.kind === 'kurve') this.playKurve(m.state);
    if (m.kind === 'arena') {
      const me2 = m.state.players[this.id];
      if (m.state.sub === 'play' && me2?.alive) {
        this.once('arena', async () => {
          await sleep(rand(15, 35));
          const cur = this.state?.mini?.kind === 'arena' ? this.state.mini.state : null;
          if (cur?.sub === 'play') this.arenaThink(cur);
        });
      } else if (this.arenaStick) {
        this.arenaStick = false;
        this.send('stick', { x: 0, y: 0 });
      }
    }

    if (m.kind === 'bowling' && m.state.sub === 'aim' && m.state.turn === this.id) {
      const bw = m.state;
      this.once(`bowl-${bw.aimSeq}`, async () => {
        // Startposition einstellen (sieht man auf dem TV), dann werfen
        const start = rand(-0.5, 0.5);
        await sleep(rand(500, 900));
        this.send('aim', { start: start / 2 });
        await sleep(rand(300, 600));
        this.send('aim', { start });
        await sleep(rand(500, 1200));
        // Haken grob Richtung Mitte, Richtung leicht korrigieren – mit Streuung
        const spin = -start * rand(0.4, 1.1) + rand(-0.2, 0.2);
        this.send('throw', { seq: bw.aimSeq, start, speed: rand(0.35, 1), angle: rand(-0.3, 0.3), spin });
      });
    }

    if (m.kind === 'enten' && (m.state.sub === 'play' || m.state.sub === 'banner')) {
      const en = m.state;
      const me2 = en.players[this.id];
      if (me2) {
        this.once('enten', async () => {
          await sleep(rand(55, 85));
          if (me2.ammo === 0 && !me2.reloading) {
            await sleep(rand(150, 450));
            this.send('reload');
            return;
          }
          const birds = en.targets.filter((t) => t.kind !== 'float' && (t.st === 'fly' || t.st === 'escape') && t.y < 200);
          let target = birds.find((t) => t.id === this.aimTarget);
          if (!target || Math.random() < 0.01) {
            target = [...birds].sort((a, b) => Math.hypot(a.x - this.aim.x, a.y - this.aim.y) - Math.hypot(b.x - this.aim.x, b.y - this.aim.y))[0];
            this.aimTarget = target?.id ?? null;
          }
          if (!target) {
            this.aim.x += (200 - this.aim.x) * 0.05 + rand(-2, 2);
            this.aim.y += (120 - this.aim.y) * 0.05 + rand(-2, 2);
            this.send('aim', { x: this.aim.x, y: this.aim.y });
            return;
          }
          // Mit Verzögerung + Zittern hinterherziehen, etwas vorhalten
          const tx = target.x + target.vx * 0.12;
          const ty = target.y + target.vy * 0.12;
          this.aim.x += (tx - this.aim.x) * rand(0.25, 0.45) + rand(-3, 3);
          this.aim.y += (ty - this.aim.y) * rand(0.25, 0.45) + rand(-3, 3);
          this.send('aim', { x: Math.round(this.aim.x * 10) / 10, y: Math.round(this.aim.y * 10) / 10 });
          const d = Math.hypot(tx - this.aim.x, ty - this.aim.y);
          if (en.sub === 'play' && d < 12 && !me2.reloading && Date.now() - this.lastFire > 300 && Math.random() < 0.6) {
            this.lastFire = Date.now();
            this.send('shoot', { x: this.aim.x + rand(-2, 2), y: this.aim.y + rand(-2, 2) });
          }
        });
      }
    }

    if (m.kind === 'ttt') this.playTtt(m.state);

    if (m.kind === 'verstecken') this.playVerstecken(m.state);

    if (m.kind === 'parcours') this.parcours(m.state);

    if (m.kind === 'kart' && m.state.sub === 'race') {
      const k = m.state;
      const car = k.karts[this.id];
      if (car && !car.finished) {
        this.once('kart', async () => {
          await sleep(rand(80, 130));
          const ap = autopilot(getTrack(k.track), car.x, car.y, car.angle, 70, this.kartLane);
          // etwas menschliche Unschärfe
          const steer = Math.max(-1, Math.min(1, ap.steer + rand(-0.15, 0.15)));
          this.send('steer', { x: Math.round(steer * 100) / 100, brake: ap.brake && Math.random() < 0.7 });
          if (car.item) {
            if (!this.kartItemAt) this.kartItemAt = Date.now() + rand(600, 3500);
            if (Date.now() >= this.kartItemAt) {
              this.kartItemAt = 0;
              this.send('item');
            }
          }
          if (Math.random() < 0.01) this.kartLane = rand(-6, 6);
        });
      }
    }

    if (m.kind === 'igel') igelBot(this, m.state);

    if (m.kind === 'smash' && m.state.sub === 'fight') {
      const me2 = m.state.fighters[this.id];
      if (me2?.state === 'fight') this.once('smash', async () => {
        await sleep(rand(50, 110));
        this.smashBrain(m.state, me2);
      });
    }

    if (m.kind === 'grill') {
      const st = m.state;
      this.once('grill', async () => {
        grillBot(this, st);
        await sleep(rand(90, 140));
      });
    }

    if (m.kind === 'wasser') {
      const st = m.state;
      this.once('wasser', async () => {
        this.wasserStep(st);
        await sleep(110);
      });
    }

    if (m.kind === 'stillepost') {
      const sp = m.state;
      const p = this.priv?.kind === 'stillepost' && this.priv.state.round === sp.round ? this.priv.state : null;
      const key = `${sp.sub}-${sp.round}-${sp.chain}`;
      if (p && !p.done && (p.task === 'write' || p.task === 'describe' || p.task === 'draw') && !this.postDone.has(key)) {
        this.postDone.add(key);
        this.once(`sp-${key}`, async () => {
          await sleep(rand(1500, 5000));
          if (p.task === 'draw') this.send('drawing', { round: sp.round, drawing: randomDrawing(), done: true });
          else {
            const text = POST_PROMPTS[Math.floor(Math.random() * POST_PROMPTS.length)];
            this.send('text', { round: sp.round, text: p.task === 'describe' ? `${text}?` : text, done: true });
          }
        });
      }
      if (p?.task === 'vote' && p.myVote === null && !this.postDone.has(key)) {
        const options = sp.entries.map((_, i) => i).filter((i) => !p.own.includes(i));
        if (options.length) {
          this.postDone.add(key);
          this.once(`sp-${key}`, async () => {
            await sleep(rand(800, 3000));
            this.send('vote', { entry: options[Math.floor(Math.random() * options.length)] });
          });
        }
      }
      // Bot-VIP führt die Vorführung weiter (sonst bleibt sie hängen)
      if (me?.isVip && (sp.sub === 'reveal' || sp.sub === 'tally')) {
        this.once(`sp-next-${sp.sub}-${sp.chain}-${sp.shown}`, async () => {
          await sleep(sp.sub === 'tally' ? 2500 : 1200);
          const s2 = this.state?.mini?.kind === 'stillepost' ? this.state.mini.state : null;
          if (s2 && s2.sub === sp.sub && s2.chain === sp.chain && s2.shown === sp.shown) this.socket.emit('vip:mini', 'next');
        });
      }
    }

    if (m.kind === 'fangen' && (m.state.sub === 'chase' || m.state.sub === 'intro')) {
      const st = m.state;
      this.once('fangen', async () => {
        await sleep(100);
        if (st.round !== this.fg.round) this.fg = { round: st.round, seen: new Set(), goal: null, until: 0 };
        if (st.runner === this.id) fangenRunner(this, st);
        else if (st.hunters[this.id] && st.sub === 'chase') fangenHunter(this, st, this.fg);
      });
    }

    if (m.kind === 'geist' && m.state.sub === 'play') {
      const g = m.state;
      const p = this.priv?.kind === 'geist' ? this.priv.state : null;
      if (p) this.once('geist', async () => {
        await sleep(rand(100, 160));
        const dir = p.role === 'ghost' ? this.geistGhost(g, p.x, p.y, p.lit) : this.geistHunter(g, p.fear);
        if (dir) this.send('stick', { x: Math.round(dir.x * 100) / 100, y: Math.round(dir.y * 100) / 100 });
      });
    }

    if (m.kind === 'murder') {
      const ms = m.state;
      const p = this.priv?.kind === 'murder' ? this.priv.state : null;
      if (!p) return;
      if (ms.sub === 'tasks') {
        this.once('murder-task', async () => {
          if (p.killTarget && Math.random() < 0.5) {
            await sleep(rand(300, 800));
            this.send('kill');
            return;
          }
          if (p.bodyHere) {
            await sleep(rand(500, 1500));
            this.send('report');
            return;
          }
          if (p.room === null || p.doneRooms.includes(p.room) || Math.random() < 0.02) {
            const open = ROOMS.map((_, i) => i).filter((i) => !p.doneRooms.includes(i));
            const room = open.length ? open[Math.floor(Math.random() * open.length)] : Math.floor(Math.random() * ROOMS.length);
            await sleep(rand(400, 1200));
            this.send('room', { room });
            return;
          }
          await sleep(rand(80, 160));
          this.send('task');
        });
      }
      if (ms.sub === 'meeting' && this.leader) {
        this.once(`meet-${ms.phaseNo}`, async () => {
          await sleep(4000);
          this.socket.emit('vip:mini', 'skip');
        });
      }
      if (ms.sub === 'vote' && p.alive && !p.myVote) {
        this.once(`vote-${ms.phaseNo}`, async () => {
          await sleep(rand(800, 2500));
          const alive = Object.keys(ms.alive).filter((id) => ms.alive[id] && id !== this.id);
          const target = Math.random() < 0.2 ? 'skip' : alive[Math.floor(Math.random() * alive.length)];
          this.send('vote', { target });
        });
      }
    }
  }

  /** Einfache KI: herumlaufen, Sachen aufheben, Verräter jagen Einzelgänger, Unschuldige wehren sich */
  private playTtt(t: TttState) {
    const p = this.priv?.kind === 'ttt' ? this.priv.state : null;
    const mem = this.ttt;
    if (t.round !== mem.round) {
      mem.round = t.round;
      mem.grudges.clear();
      mem.goal = null;
      mem.lastAttack = t.attacks.at(-1)?.seq ?? 0;
    }
    if (!p || t.sub !== 'play' || !p.alive) return;
    // Was ist passiert? Wer hat mich (oder jemanden) angegriffen?
    for (const a of t.attacks) {
      if (a.seq <= mem.lastAttack) continue;
      mem.lastAttack = a.seq;
      if (!a.by || a.by === this.id || p.partners.includes(a.by)) continue;
      if (a.target === this.id) mem.grudges.add(a.by);
      else if (a.ko && p.role !== 'traitor' && Math.random() < 0.6) mem.grudges.add(a.by);
    }
    for (const g of mem.grudges) if (!t.alive[g]) mem.grudges.delete(g);

    this.once('ttt', async () => {
      await sleep(rand(70, 130));
      const me = { x: p.x, y: p.y };
      const dist = (o: { x: number; y: number }) => Math.hypot(o.x - me.x, o.y - me.y);
      const visible = Object.entries(t.players).filter(([id]) => id !== this.id);

      // Ziel wählen
      let target: [string, { x: number; y: number }] | undefined;
      const grudge = visible.filter(([id]) => mem.grudges.has(id)).sort((a, b) => dist(a[1]) - dist(b[1]))[0];
      if (grudge) target = grudge;
      else if (p.role === 'traitor') {
        const victims = visible.filter(([id]) => !p.partners.includes(id));
        const lonely = victims.filter(([, v]) => victims.filter(([, o]) => o !== v && Math.hypot(o.x - v.x, o.y - v.y) < 50).length === 0);
        const late = t.endsIn < TTT.ROUND_MS - 45000;
        const pool = (lonely.length ? lonely : late ? victims : []).sort((a, b) => dist(a[1]) - dist(b[1]));
        if (pool[0] && (dist(pool[0][1]) < 120 || late)) target = pool[0];
        if (p.credits > 0) {
          if (p.inDoor && Math.random() < 0.3) this.send('buy', { item: 'trap' });
          else if (target && p.cloakLeft === 0 && dist(target[1]) < 60 && Math.random() < 0.3) this.send('buy', { item: 'cloak' });
          else if (Math.random() < 0.01) this.send('buy', { item: 'radio', room: Math.floor(Math.random() * ROOMS.length) });
        }
      }

      if (target) {
        const [tid, tp] = target;
        const d = dist(tp);
        const range = p.weapon === 'pistol' ? 110 : p.weapon === 'coconut' ? 80 : TTT.NOODLE_RANGE - 4;
        const wp = nextWaypoint(me.x, me.y, tp.x, tp.y);
        // In Reichweite: kaum noch laufen, nur zum Ziel drehen (sonst tanzt man umeinander herum)
        if (d < range) this.steer(me, wp, 0.32, 0.32);
        else this.steer(me, wp);
        if (d < range && p.attackReady && lineFree(me.x, me.y, tp.x, tp.y)) this.send('attack');
        void tid;
        return;
      }

      // Nichts zu kämpfen: Sachen benutzen oder herumlaufen
      if (p.near && (/untersuchen|Spur/.test(p.near) || (/aufheben/.test(p.near) && !p.weapon) || (/benutzen/.test(p.near) && p.hp < TTT.HP))) {
        this.send('use');
      }
      const wanted = [
        ...t.items.filter((i) => (i.kind === 'medkit' ? p.hp < TTT.HP : !p.weapon)),
        ...t.bodies.filter((b) => !b.role || (p.role === 'detective' && Math.random() < 0.5)),
      ].sort((a, b) => dist(a) - dist(b))[0];
      if (wanted && dist(wanted) < 160) mem.goal = { x: wanted.x, y: wanted.y };
      const now = Date.now();
      if (now - mem.stuckAt > 1500) {
        const moved = Math.hypot(me.x - mem.stuckX, me.y - mem.stuckY);
        if (moved < 2) mem.goal = null;
        mem.stuckX = me.x;
        mem.stuckY = me.y;
        mem.stuckAt = now;
      }
      if (!mem.goal || dist(mem.goal) < 5) {
        const r = roomInner(Math.floor(Math.random() * ROOMS.length));
        mem.goal = { x: r.x + 16 + Math.random() * (r.w - 32), y: r.y + 16 + Math.random() * (r.h - 32) };
      }
      // Gemütlich schlendern – wer jagt, ist schneller
      this.steer(me, nextWaypoint(me.x, me.y, mem.goal.x, mem.goal.y), 0.6, 0.6);
    });
  }

  private steer(from: { x: number; y: number }, to: { x: number; y: number }, scale = 1, max = 1) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return this.send('stick', { x: 0, y: 0 });
    const k = Math.min(max, Math.max(scale, d / 12)) / d;
    this.send('stick', { x: Math.round(dx * k * 100) / 100, y: Math.round(dy * k * 100) / 100 });
  }

  // ---------------------------------------------------------------- Geisterjagd

  /** Richtung zum Ziel (über Türen), mit Ausweichen, falls man irgendwo hängt */
  private geistSteer(from: { x: number; y: number }, to: { x: number; y: number }, scale = 1) {
    const now = Date.now();
    const mem = this.gj;
    if (now >= mem.checkAt) {
      const moved = Math.hypot(from.x - mem.px, from.y - mem.py);
      if (moved < 3 && Math.hypot(to.x - from.x, to.y - from.y) > 10 && now > mem.jitterUntil) {
        const a = Math.random() * Math.PI * 2;
        mem.jx = Math.cos(a);
        mem.jy = Math.sin(a);
        mem.jitterUntil = now + 500;
      }
      mem.px = from.x;
      mem.py = from.y;
      mem.checkAt = now + 700;
    }
    if (now < mem.jitterUntil) return { x: mem.jx, y: mem.jy };
    const wp = navTarget(from, to);
    const dx = wp.x - from.x;
    const dy = wp.y - from.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) return { x: 0, y: 0 };
    return { x: (dx / d) * scale, y: (dy / d) * scale };
  }

  /** Geist-Bot: kennt alle Positionen (wie der echte Geist), meidet Licht, sucht sich einzelne Jäger */
  private geistGhost(g: import('../shared/types').GeistState, x: number, y: number, lit: boolean) {
    const me = { x, y };
    const alive = Object.values(g.hunters).filter((h) => !h.down);
    // Gefahr: Lichtkegel in der Nähe
    const threat = alive.find((h) => h.light && inCone(h.x, h.y, h.angle, x, y, 22));
    if (lit || threat) {
      const h = threat ?? alive.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
      if (h) {
        // Seitlich aus dem Kegel raus und weg
        const side = Math.sin(Math.atan2(y - h.y, x - h.x) - h.angle) >= 0 ? 1 : -1;
        const px = -Math.sin(h.angle) * side;
        const py = Math.cos(h.angle) * side;
        const ax = x - h.x;
        const ay = y - h.y;
        const al = Math.hypot(ax, ay) || 1;
        const vx = px * 0.8 + (ax / al) * 0.6;
        const vy = py * 0.8 + (ay / al) * 0.6;
        const vl = Math.hypot(vx, vy) || 1;
        return this.geistSteer(me, { x: x + (vx / vl) * 40, y: y + (vy / vl) * 40 });
      }
    }
    if (!alive.length) return { x: 0, y: 0 };
    // Ziel: möglichst einzelner Jäger, nicht zu weit weg
    const score = (h: (typeof alive)[number]) => {
      const iso = Math.min(200, ...alive.filter((o) => o !== h).map((o) => Math.hypot(o.x - h.x, o.y - h.y)));
      return iso - Math.hypot(h.x - x, h.y - y) * 0.4 - (h.light ? 40 : 0);
    };
    const target = [...alive].sort((a, b) => score(b) - score(a))[0];
    const d = Math.hypot(target.x - x, target.y - y);
    const iso = Math.min(200, ...alive.filter((o) => o !== target).map((o) => Math.hypot(o.x - target.x, o.y - target.y)));
    // Je länger die Runde läuft, desto mutiger; vorher lauern, bis jemand allein ist
    const elapsed = 1 - g.endsIn / GEIST.ROUND_MS;
    const brave = iso > 90 - 80 * elapsed || (!target.light && iso > 50);
    if (!brave) {
      const lurk = { x: target.x - Math.cos(target.angle) * 125, y: target.y - Math.sin(target.angle) * 125 };
      return this.geistSteer(me, { x: Math.max(20, Math.min(460, lurk.x)), y: Math.max(38, Math.min(256, lurk.y)) }, 0.8);
    }
    // Von hinten anschleichen: Punkt hinter dem Jäger anpeilen
    const behind = { x: target.x - Math.cos(target.angle) * 10, y: target.y - Math.sin(target.angle) * 10 };
    const facingMe = Math.abs(Math.atan2(Math.sin(Math.atan2(y - target.y, x - target.x) - target.angle), Math.cos(Math.atan2(y - target.y, x - target.x) - target.angle))) < 0.9;
    if (target.light && facingMe && d < GEIST.LIGHT_LEN + 25) {
      // Im Bogen drumherum
      const a = Math.atan2(y - target.y, x - target.x) + 0.9;
      return this.geistSteer(me, { x: target.x + Math.cos(a) * 50, y: target.y + Math.sin(a) * 50 });
    }
    return this.geistSteer(me, d < 30 ? target : behind);
  }

  /** Jäger-Bot: läuft in lockeren Gruppen, Licht an bei Gänsehaut, rettet Freunde */
  private geistHunter(g: import('../shared/types').GeistState, fear: number) {
    const me = g.hunters[this.id];
    if (!me || me.down || me.empty) return me?.down || me?.empty ? { x: 0, y: 0 } : null;
    const ids = Object.keys(g.hunters).sort();
    const now = Date.now();
    // Licht schalten
    const ghostNear = g.ghost && g.ghost.why !== 'flash' ? Math.hypot(g.ghost.x - me.x, g.ghost.y - me.y) < GEIST.LIGHT_LEN + 30 : false;
    const wantLight = (ghostNear || fear > 0.3) && me.battery > 0.12;
    if (wantLight !== me.light && (wantLight || fear < 0.15 || me.battery < 0.12)) {
      this.once('geist-light', async () => {
        await sleep(rand(150, 450));
        this.send('light', { on: wantLight });
        await sleep(300);
      });
    }
    // Erschreckte Freunde retten
    const downed = ids.filter((id) => id !== this.id && g.hunters[id].down).map((id) => g.hunters[id]);
    const help = downed.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
    if (help && Math.hypot(help.x - me.x, help.y - me.y) < 220) {
      if (Math.hypot(help.x - me.x, help.y - me.y) < GEIST.REVIVE_DIST - 6) {
        // Daneben stehen und mit der Lampe Wache halten (langsam drehen)
        const a = now / 500;
        return { x: Math.cos(a) * 0.2, y: Math.sin(a) * 0.2 };
      }
      return this.geistSteer(me, help);
    }
    // Sichtbarer Geist → hinterher
    if (g.ghost && g.ghost.why !== 'touch') return this.geistSteer(me, g.ghost);
    // Gänsehaut → umsehen (Leuchtturm)
    if (fear > 0.45) {
      const a = now / 380 + ids.indexOf(this.id);
      return { x: Math.cos(a) * 0.25, y: Math.sin(a) * 0.25 };
    }
    // Lockere Gruppen (ab 4 Jägern zwei Gruppen), wechselnde Räume
    const group = ids.length >= 4 ? ids.indexOf(this.id) % 2 : 0;
    const mates = ids.filter((id, i) => id !== this.id && !g.hunters[id].down && (ids.length >= 4 ? i % 2 : 0) === group).map((id) => g.hunters[id]);
    if (mates.length) {
      const cx = mates.reduce((s2, h) => s2 + h.x, 0) / mates.length;
      const cy = mates.reduce((s2, h) => s2 + h.y, 0) / mates.length;
      if (Math.hypot(cx - me.x, cy - me.y) > 70) return this.geistSteer(me, { x: cx, y: cy });
    }
    const room = (Math.floor(now / 8000) * (group ? 5 : 1) + group * 3) % 6;
    const c = roomCenter(room);
    const slot = ids.indexOf(this.id);
    return this.geistSteer(me, { x: c.x + ((slot % 3) - 1) * 18, y: c.y + (Math.floor(slot / 3) % 2) * 16 - 8 }, 0.9);
  }
}

export interface KurveBrain {
  others: Uint8Array;
  own: Int32Array;
}

/** Wie viele Schritte (à 2 px) kommt man mit dieser Lenkrichtung, bevor es kracht? */
export function kurveLookAhead(st: KurveState, myId: string, brain: KurveBrain, dir: number, horizon: number, ownLatest: number): number {
  const me = st.players[myId];
  const A = KURVE.ARENA;
  const wrap = me.fx.includes('wrap');
  const v = Math.max(20, me.v || KURVE.SPEED);
  let { x, y, a } = me;
  const da = (dir * KURVE.TURN * 2) / v;
  // Andere Köpfe fahren (vermutlich) geradeaus weiter – nicht frontal reinrauschen
  const heads = Object.entries(st.players)
    .filter(([id, h]) => id !== myId && h.alive)
    .map(([, h]) => ({ x: h.x, y: h.y, dx: Math.cos(h.a) * (2 * h.v) / v, dy: Math.sin(h.a) * (2 * h.v) / v }));
  for (let k = 1; k <= horizon; k++) {
    a += da;
    x += Math.cos(a) * 2;
    y += Math.sin(a) * 2;
    // Ohne "Durch Wände" lieber etwas Abstand zum Rand halten
    const m = wrap ? 2 : 6;
    if (x < A.x + m || x > A.x + A.w - m || y < A.y + m || y > A.y + A.h - m) {
      if (!wrap) return k;
      if (x < A.x + m) x = A.x + A.w - 3;
      else if (x > A.x + A.w - m) x = A.x + 3;
      if (y < A.y + m) y = A.y + A.h - 3;
      else if (y > A.y + A.h - m) y = A.y + 3;
    }
    if (heads.some((h) => Math.hypot(h.x + h.dx * k - x, h.y + h.dy * k - y) < 7)) return k;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const [px, py] of [[x + c, y + s], [x - s * 1.5, y + c * 1.5], [x + s * 1.5, y - c * 1.5]]) {
      const cell = Math.floor(py) * 480 + Math.floor(px);
      if (cell < 0 || cell >= brain.others.length) continue;
      if (brain.others[cell]) return k;
      const o = brain.own[cell];
      if (o && o < ownLatest - 6) return k;
    }
  }
  return horizon + 1;
}

export type VerstStateT = Extract<NonNullable<GameState['mini']>, { kind: 'verstecken' }>['state'];

/** Versteckspiel-Bots: Verstecker suchen sich einen passenden Platz neben einem Möbel, Sucher prüfen Möbel. */
function vsStep(bot: Bot, m: VerstStateT) {
  const p = bot.priv?.kind === 'verstecken' ? bot.priv.state : null;
  if (!p) return;
  const v = bot.vs;
  if (v.round !== m.round) {
    v.round = m.round;
    v.spot = null;
    v.seen.clear();
    v.checked.clear();
    v.target = null;
    v.whistle = null;
    v.wander = null;
  }
  const goTo = (tx: number, ty: number, slow = 1) => {
    const wp = verstWaypoint(p.x, p.y, tx, ty);
    const dx = wp.x - p.x;
    const dy = wp.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) return true;
    const k = Math.min(1, d / 10) * slow;
    bot.send('stick', { x: (dx / d) * k, y: (dy / d) * k });
    return false;
  };

  if (p.role === 'hider') {
    if (p.found || (m.sub !== 'hide' && m.sub !== 'seek')) return;
    if (m.sub === 'seek') {
      bot.once('vs-hide-seek', async () => {
        await sleep(rand(1500, 3500));
        if (p.disguise && !p.locked) bot.send('lock');
        if (p.whistleIn <= 0 && Math.random() < 0.18) bot.send('whistle');
      });
      return;
    }
    // Verstecken: Platz planen
    if (!v.spot) {
      const objs = shuffleArr(m.objects);
      for (const o of objs) {
        const info = PROPS[o.t];
        for (let k = 0; k < 8 && !v.spot; k++) {
          const ang = Math.random() * Math.PI * 2;
          const dist = rand(info.w / 2 + 10, VS.MORPH_R - 8);
          const x = Math.round(o.x + Math.cos(ang) * dist);
          const y = Math.round(o.y + Math.sin(ang) * dist * 0.6);
          if (!canStand(x, y) || !canStand(x - 6, y) || !canStand(x + 6, y)) continue;
          const others = m.objects;
          if (judgeSpot({ t: o.t, x, y }, others, false, true).level !== 'ok') continue;
          if (others.some((q) => overlap(baseRect({ t: o.t, x, y }), baseRect(q)) > 0)) continue;
          if (!info.zones.includes(zoneAt(x, y))) continue;
          v.spot = { x, y, t: o.t };
        }
        if (v.spot) break;
      }
      if (!v.spot) return;
    }
    const s = v.spot;
    if (p.disguise && p.locked) return;
    if (!p.disguise || p.disguise.t !== s.t) {
      if (Math.hypot(p.x - s.x, p.y - s.y) > 3) {
        goTo(s.x, s.y);
        return;
      }
      bot.send('stick', { x: 0, y: 0 });
      bot.once('vs-morph', async () => {
        await sleep(rand(250, 500));
        bot.send('morph');
      });
      return;
    }
    if (Math.hypot(p.x - s.x, p.y - s.y) > 3) {
      goTo(s.x, s.y, 0.7);
      return;
    }
    bot.send('stick', { x: 0, y: 0 });
    bot.once('vs-lock', async () => {
      await sleep(rand(300, 900));
      if (!p.locked) bot.send('lock');
    });
    return;
  }

  // ---------------------------------------------------------------- Sucher
  if (m.sub !== 'seek' || p.stunIn > 0) return;
  const now = Date.now();
  for (const o of m.objects) {
    const old = v.seen.get(o.o);
    if (!old) v.seen.set(o.o, { x: o.x, y: o.y, movedAt: 0 });
    else if (Math.abs(old.x - o.x) + Math.abs(old.y - o.y) > 0) v.seen.set(o.o, { x: o.x, y: o.y, movedAt: now });
  }
  const lastW = m.whistles.at(-1);
  if (lastW && lastW.seq > v.lastWhistleSeq) {
    v.lastWhistleSeq = lastW.seq;
    v.whistle = { x: lastW.x, y: lastW.y, at: now };
  }
  const objs = m.objects.filter((o) => !v.checked.has(o.o));
  let target = objs.find((o) => o.o === v.target);
  if (target && now - v.targetSince > 9000) {
    // hängt fest → anderes Ziel
    v.checked.add(target.o);
    target = undefined;
  }
  if (!target) {
    const me = { x: p.x, y: p.y };
    const score = (o: (typeof objs)[number]) => {
      let sc = Math.hypot(o.x - me.x, o.y - me.y) + Math.random() * 60;
      const seen = v.seen.get(o.o);
      if (seen && now - seen.movedAt < 10000) sc -= 220;
      if (v.whistle && now - v.whistle.at < 15000 && Math.hypot(o.x - v.whistle.x, o.y - v.whistle.y) < 50) sc -= 150;
      return sc;
    };
    target = [...objs].sort((a, b) => score(a) - score(b))[0];
    if (!target) return;
    v.target = target.o;
    v.targetSince = now;
  }
  const info = PROPS[target.t];
  const side = p.x <= target.x ? -1 : 1;
  const ax = target.x + side * (info.w / 2 + 5);
  const ay = target.y;
  const standX = canStand(ax, ay) ? ax : target.x - side * (info.w / 2 + 5);
  const standY = canStand(standX, ay) ? ay : ay + 6;
  const av = m.avatars[bot.id];
  const dir = av?.dir ?? 1;
  const inFront = pickTarget(m.objects, p.x, p.y, dir);
  if (inFront?.o === target.o) {
    bot.send('stick', { x: 0, y: 0 });
    bot.once('vs-check', async () => {
      await sleep(rand(250, 700));
      bot.send('check');
      v.checked.add(target!.o);
      v.target = null;
    });
    return;
  }
  if (Math.hypot(p.x - standX, p.y - standY) < 3) {
    // Zum Möbel drehen
    bot.send('stick', { x: target.x > p.x ? 0.3 : -0.3, y: 0 });
    return;
  }
  goTo(standX, standY);
}

function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Igel-Krieg: kurz laufen, dann per Simulation zielen und schießen */
function igelBot(bot: Bot, st: IgelState) {
  if (st.active !== bot.id || st.activeHog === null) return;
  const cur = () => (bot.state?.mini?.kind === 'igel' ? bot.state.mini.state : null);
  if (st.sub === 'aim') {
    bot.once(`igel-${st.turn}`, async () => {
      await sleep(rand(700, 1400));
      const hog = st.hogs[st.activeHog!];
      const foe = st.hogs.filter((h) => h.state === 'ok' && h.owner !== bot.id).sort((a, b) => Math.abs(a.x - hog.x) - Math.abs(b.x - hog.x))[0];
      const dir = foe ? (foe.x > hog.x ? 1 : -1) : hog.x < 240 ? 1 : -1;
      // Nur laufen, wenn vorne sicherer Boden ist (nicht ins Meer stolpern)
      const mask = igelMask(st);
      const ahead = surfaceY(mask, hog.x + dir * 24);
      const safe = ahead < st.water - 12 && Math.abs(ahead - hog.y) < 20;
      if (safe && Math.random() < 0.4) {
        bot.send('move', { dir });
        await sleep(rand(300, 900));
        bot.send('move', { dir: 0 });
        if (Math.random() < 0.2) bot.send('jump');
        await sleep(600);
      }
      const now = cur();
      if (!now || now.active !== bot.id || now.sub !== 'aim' || now.turn !== st.turn) return;
      const plan = planIgelShot(now, bot.id);
      bot.send('weapon', { weapon: plan.weapon });
      await sleep(250);
      for (let i = 1; i <= 5; i++) {
        bot.send('aim', { angle: plan.angle, power: (plan.power * i) / 5 });
        await sleep(110);
      }
      await sleep(300);
      bot.send('fire', { angle: plan.angle, power: plan.power });
    });
  }
  if (st.sub === 'retreat') {
    bot.once(`igel-done-${st.turn}`, async () => {
      await sleep(rand(400, 1000));
      bot.send('done');
    });
  }
}

let terrainCache: { seed: number; n: number; mask: Mask } | null = null;

function igelMask(st: IgelState): Mask {
  if (!terrainCache || terrainCache.seed !== st.seed || terrainCache.n > st.craters.length) {
    terrainCache = { seed: st.seed, n: st.craters.length, mask: buildTerrain(st.seed, st.craters) };
  }
  for (; terrainCache.n < st.craters.length; terrainCache.n++) {
    const [x, y, r] = st.craters[terrainCache.n];
    carve(terrainCache.mask, x, y, r);
  }
  return terrainCache.mask;
}

/** Probiert viele Winkel/Stärken durch und nimmt den Schuss mit dem meisten Schaden beim Gegner */
export function planIgelShot(st: IgelState, me: string): { weapon: 'bazooka' | 'grenade' | 'teleport' | 'punch'; angle: number; power: number } {
  const hog = st.hogs[st.activeHog!];
  const enemies = st.hogs.filter((h) => h.state === 'ok' && h.owner !== me);
  const friends = st.hogs.filter((h) => h.state === 'ok' && h.owner === me);
  const near = [...enemies].sort((a, b) => Math.hypot(a.x - hog.x, a.y - hog.y) - Math.hypot(b.x - hog.x, b.y - hog.y))[0];
  if (near && Math.abs(near.x - hog.x) < PUNCH.REACH - 2 && Math.abs(near.y - hog.y) < 10) {
    return { weapon: 'punch', angle: near.x >= hog.x ? -0.3 : Math.PI + 0.3, power: 0.5 };
  }
  const ammo = st.ammo[me];
  if (ammo?.teleport && Math.random() < 0.05) {
    return { weapon: 'teleport', angle: -Math.PI / 2 + rand(-0.8, 0.8), power: rand(0.2, 0.45) };
  }
  const mask = igelMask(st);
  const from = { x: hog.x, y: hog.y - 4 };
  const all = st.hogs.filter((h) => h.state === 'ok').map((h) => ({ x: h.x, y: h.y, self: h.id === hog.id }));
  const reach = BAZOOKA.R + 10;
  const dmgAt = (p: { x: number; y: number }, list: typeof enemies) =>
    list.reduce((s, h) => {
      const d = Math.hypot(h.x - p.x, h.y - 4 - p.y);
      return s + (d < reach ? BAZOOKA.DMG * Math.min(1, (1 - d / reach) * 1.3) : 0);
    }, 0);
  let best = { angle: -Math.PI / 4, power: 0.6, score: -Infinity };
  for (let a = -Math.PI; a < Math.PI; a += 0.07) {
    for (let pw = 0.2; pw <= 1.001; pw += 0.08) {
      const hit = simulateBazooka(mask, from, a, pw, st.wind, st.water, all);
      if (!hit) continue;
      const self = dmgAt(hit, friends);
      const gain = dmgAt(hit, enemies);
      const closest = Math.min(...enemies.map((h) => Math.hypot(h.x - hit.x, h.y - 4 - hit.y)));
      const score = gain > 0 ? gain - self * 1.6 : -closest - self * 3;
      if (score > best.score) best = { angle: a, power: pw, score };
    }
  }
  const angle = best.angle + rand(-0.05, 0.05);
  const power = Math.max(0.15, Math.min(1, best.power + rand(-0.04, 0.04)));
  if (ammo?.grenade && best.score > 0 && Math.random() < 0.15) {
    return { weapon: 'grenade', angle, power: Math.min(1, power / GRENADE.SPEED) };
  }
  return { weapon: 'bazooka', angle, power };
}

const ATTACK_ANIMS = new Set(['jab', 'side', 'up', 'down', 'nair', 'dair', 'spec']);

export interface SmashBrainHost {
  send(action: string, payload?: unknown): void;
}

/** Smash-Arena-Bot: hinlaufen, hauen, manchmal blocken – und vor allem zurück auf die Bühne kommen */
export function smashThink(bot: SmashBrainHost & { id: string }, mem: { shieldUntil: number; lastJump: number; lastA: number; lastB: number; stick: string; stickAt: number }, st: SmashState, me: SmashFighter) {
  const now = Date.now();
  const stage = SMASH_STAGES.find((x) => x.id === st.stage)!;
  const main = mainPlatform(stage);
  const left = main.x;
  const right = main.x + main.w;
  const top = main.y;
  const stick = (x: number, y: number) => {
    const key = `${x},${y}`;
    if (key === mem.stick && now - mem.stickAt < 300) return;
    mem.stick = key;
    mem.stickAt = now;
    bot.send('stick', { x, y });
  };
  const btn = (b: string, x = 0, y = 0) => bot.send('btn', { b, down: true, x, y });
  if (me.anim === 'hurt' || me.anim === 'stun' || me.anim === 'dizzy') {
    stick(me.x < (left + right) / 2 ? 1 : -1, 0);
    return;
  }
  // Zurück auf die Bühne!
  const offstage = me.x < left - 2 || me.x > right + 2 || me.y > top + 4;
  if (offstage) {
    if (mem.shieldUntil) {
      bot.send('btn', { b: 'shield', down: false });
      mem.shieldUntil = 0;
    }
    const dir = me.x < (left + right) / 2 ? 1 : -1;
    stick(dir, 0);
    const low = me.y > top - 30;
    if (low && me.vy > -40 && now - mem.lastJump > 280) {
      if (me.jumps > 0) {
        mem.lastJump = now;
        btn('jump', dir, 0);
      } else if (me.special === 'schirm' && me.cd === 0) {
        mem.lastJump = now;
        btn('b', dir, 0);
      }
    }
    return;
  }
  if (mem.shieldUntil) {
    if (now < mem.shieldUntil) return;
    mem.shieldUntil = 0;
    bot.send('btn', { b: 'shield', down: false });
  }
  const others = Object.entries(st.fighters).filter(([id, f]) => id !== bot.id && f.state === 'fight');
  if (!others.length) return stick(0, 0);
  const [, t] = others.sort(([, a], [, b]) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
  const dx = t.x - me.x;
  const dy = t.y - me.y;
  const sgn = dx >= 0 ? 1 : -1;

  // Gegenstände
  if (!me.hold) {
    const it = st.items.find((i) => Math.abs(i.x - me.x) < 70 && Math.abs(i.y - me.y) < 30);
    if (it && Math.abs(dx) > 30) {
      if (it.type !== 'ananas' && Math.abs(it.x - me.x) < 12 && now - mem.lastA > 250) {
        mem.lastA = now;
        btn('a');
        return;
      }
      stick(it.x > me.x ? 1 : -1, 0);
      return;
    }
  } else if (Math.abs(dx) < 150 && Math.abs(dy) < 30 && now - mem.lastA > 300) {
    mem.lastA = now;
    btn('a', sgn, 0);
    return;
  }

  // Blocken, wenn der Gegner gerade zuschlägt
  if (me.ground && Math.abs(dx) < 34 && Math.abs(dy) < 26 && ATTACK_ANIMS.has(t.anim) && me.shield > 40 && Math.random() < 0.3) {
    mem.shieldUntil = now + 300 + Math.random() * 400;
    stick(0, 0);
    bot.send('btn', { b: 'shield', down: true, x: 0, y: 0 });
    return;
  }

  // Hinlaufen (aber nicht von der Bühne rennen)
  const tOnStage = t.x > left && t.x < right && t.y <= top + 2;
  const wantX = tOnStage ? t.x - sgn * 13 : Math.max(left + 14, Math.min(right - 14, t.x));
  const mx = Math.abs(wantX - me.x) > 6 ? (wantX > me.x ? 1 : -1) : 0;
  const drop = dy > 30 && me.ground && me.y < top - 4 && Math.abs(dx) < 60;
  stick(mx, drop ? 1 : 0);
  if (dy < -38 && me.ground && Math.abs(dx) < 90 && now - mem.lastJump > 700) {
    mem.lastJump = now;
    btn('jump', mx, 0);
    return;
  }

  // Angreifen
  if (Math.abs(dx) < 27 && Math.abs(dy) < 28 && now - mem.lastA > 240) {
    mem.lastA = now;
    if (dy < -16) btn('a', 0, -1);
    else if (!me.ground && dy > 10) btn('a', 0, 1);
    else {
      const r = Math.random();
      if (t.pct > 80 || r < 0.45) btn('a', sgn, 0);
      else if (r < 0.7) btn('a', 0, me.ground ? 1 : 0);
      else btn('a', 0, 0);
    }
    return;
  }
  if (me.cd === 0 && now - mem.lastB > 600) {
    const sp = me.special;
    const ranged = (sp === 'flipflop' || sp === 'wasser') && Math.abs(dy) < 18 && Math.abs(dx) > 25 && Math.abs(dx) < (sp === 'wasser' ? 95 : 160);
    const close = (sp === 'cocktail' && Math.abs(dx) < 36 && Math.abs(dy) < 20) || (sp === 'matratze' && Math.abs(dx) < 40 && Math.abs(dy) < 30);
    const up = sp === 'schirm' && Math.abs(dx) < 20 && dy < -10 && dy > -60;
    if ((ranged || close || up) && Math.random() < 0.5) {
      mem.lastB = now;
      btn('b', sgn, 0);
    }
  }
}

export interface BotPoint {
  x: number;
  y: number;
}

/** Läuft um Hecken/Pool herum: wählt die freie Richtung, die dem Ziel am nächsten kommt */
function steer(from: BotPoint, goal: BotPoint): BotPoint {
  const d = Math.hypot(goal.x - from.x, goal.y - from.y);
  if (d < 3) return { x: 0, y: 0 };
  const R = WASSER.PLAYER_R + 2;
  const blocked = (x: number, y: number) => WASSER_BLOCKERS.some((r) => x > r.x - R && x < r.x + r.w + R && y > r.y - R && y < r.y + r.h + R);
  let best = { x: 0, y: 0 };
  let bestScore = Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const look = Math.min(12, d);
    if (blocked(from.x + ux * look, from.y + uy * look) || blocked(from.x + ux * 5, from.y + uy * 5)) continue;
    const nx = from.x + ux * 12;
    const ny = from.y + uy * 12;
    const score = Math.hypot(goal.x - nx, goal.y - ny);
    if (score < bestScore) {
      bestScore = score;
      best = { x: ux, y: uy };
    }
  }
  const slow = d < 12 ? Math.max(0.3, d / 12) : 1;
  return { x: Math.round(best.x * slow * 100) / 100, y: Math.round(best.y * slow * 100) / 100 };
}

/** Ein paar zufällige Kritzel-Striche für Stille Post */
export function randomDrawing(): PostDrawing {
  const strokes = Array.from({ length: 3 + Math.floor(Math.random() * 6) }, () => {
    let x = rand(30, 225);
    let y = rand(30, 225);
    let a = rand(0, Math.PI * 2);
    const p: number[] = [];
    for (let i = 0, n = 6 + Math.floor(Math.random() * 20); i < n; i++) {
      p.push(Math.round(x), Math.round(y));
      a += rand(-0.6, 0.6);
      x = Math.max(0, Math.min(POST.GRID, x + Math.cos(a) * 9));
      y = Math.max(0, Math.min(POST.GRID, y + Math.sin(a) * 9));
    }
    return { c: Math.floor(Math.random() * POST_COLORS.length), w: Math.floor(Math.random() * 3), p };
  });
  return { s: strokes };
}

// ---------------------------------------------------------------- Urlaubs-Fangen

interface FangenMemory {
  round: number;
  seen: Set<number>;
  goal: { col: number; row: number } | null;
  until: number;
}

/** Läuft zur Mitte der nächsten Kachel auf dem Weg zum Ziel */
function fangenSteer(bot: Bot, me: { x: number; y: number }, goal: { col: number; row: number } | null) {
  if (!goal) return bot.send('stick', { x: 0, y: 0 });
  const next = nextStepTowards(me, goal);
  const dx = next.x - me.x;
  const dy = next.y - me.y;
  const d = Math.hypot(dx, dy);
  if (d < 1.5) return bot.send('stick', { x: 0, y: 0 });
  bot.send('stick', { x: Math.round((dx / d) * 100) / 100, y: Math.round((dy / d) * 100) / 100 });
}

const randomTileNear = (col: number, row: number, radius: number) => {
  const dist = bfsFrom([{ col, row }]);
  const opts = WALK_TILES.filter((t) => distAt(dist, t.col, t.row) <= radius && distAt(dist, t.col, t.row) >= 1);
  return opts[Math.floor(Math.random() * opts.length)] ?? { col, row };
};

/** Flüchtling: kennt alle Positionen (privat) und flieht per Breitensuche von den Fängern weg */
function fangenRunner(bot: Bot, st: FangenState) {
  const p = bot.priv?.kind === 'fangen' ? bot.priv.state : null;
  if (!p) return;
  const me = tileOf(p.x, p.y);
  const hunters = Object.values(st.hunters).map((h) => tileOf(h.x, h.y));
  const dh = hunters.length ? bfsFrom(hunters) : null;
  const danger = dh ? distAt(dh, me.col, me.row) : Infinity;
  if (st.sub === 'chase' && danger < 8 && p.decoyLeft <= 0 && !p.decoyActive && Math.random() < 0.05) bot.send('decoy');
  // Weit genug weg → stehen bleiben und abwarten (bewegt sich nur, wenn es eng wird)
  if (danger >= 11 && st.sub === 'chase') return fangenSteer(bot, p, null);
  const dm = bfsFrom([me]);
  let best: { col: number; row: number } | null = null;
  let bestScore = -Infinity;
  for (const t of WALK_TILES) {
    const mine = distAt(dm, t.col, t.row);
    if (mine > 10) continue;
    const theirs = dh ? distAt(dh, t.col, t.row) : 20;
    if (theirs <= mine) continue; // da wäre ein Fänger vor mir
    const score = theirs - mine * 0.35 + Math.random() * 0.8;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (!best && dh) {
    // eingekesselt: wenigstens auf die sicherste Nachbarkachel
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = { col: me.col + dc, row: me.row + dr };
      if (!isWalkTile(c.col, c.row)) continue;
      const sc = distAt(dh, c.col, c.row);
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
  }
  fangenSteer(bot, p, best);
}

/** Fänger: nur TV-Infos – Fußspuren, die eigene Fährte und wo die anderen Fänger "warm" sind */
function fangenHunter(bot: Bot, st: FangenState, fg: FangenMemory) {
  const meH = st.hunters[bot.id];
  const me = tileOf(meH.x, meH.y);
  const now = Date.now();
  const fresh = st.prints.filter((pr) => !fg.seen.has(pr.id));
  for (const pr of fresh) fg.seen.add(pr.id);
  const others = Object.entries(st.hunters).filter(([id]) => id !== bot.id);
  const hottest = others.sort((a, b) => b[1].heat - a[1].heat)[0]?.[1];
  if (fresh.length) {
    // Bei mehreren neuen Spuren: die nahe einem "warmen" Fänger ist wohl echt, sonst zufällig
    const pick = hottest && hottest.heat > 0 ? [...fresh].sort((a, b) => Math.hypot(a.x - hottest.x, a.y - hottest.y) - Math.hypot(b.x - hottest.x, b.y - hottest.y))[0] : fresh[Math.floor(Math.random() * fresh.length)];
    const t = tileOf(pick.x + (Math.random() - 0.5) * 20, pick.y + (Math.random() - 0.5) * 20);
    fg.goal = isWalkTile(t.col, t.row) ? t : tileOf(pick.x, pick.y);
    fg.until = now + 6000;
  } else if (meH.heat >= 2 && now > fg.until - 4500) {
    // Warm → in der Nähe absuchen
    fg.goal = randomTileNear(me.col, me.row, 3);
    fg.until = now + 1500 + 4500;
  } else if (!fg.goal || now > fg.until || (fg.goal.col === me.col && fg.goal.row === me.row)) {
    // Kein Hinweis → zum wärmsten Mitspieler oder irgendwohin
    const base = hottest && hottest.heat > meH.heat ? tileOf(hottest.x, hottest.y) : WALK_TILES[Math.floor(Math.random() * WALK_TILES.length)];
    fg.goal = randomTileNear(base.col, base.row, 2);
    fg.until = now + 5000;
  }
  if (meH.heat >= 2 && meH.sprintLeft <= 0 && Math.random() < 0.15) bot.send('sprint');
  const c = tileCenter(fg.goal!.col, fg.goal!.row);
  if (Math.hypot(c.x - meH.x, c.y - meH.y) < 3) fg.until = 0;
  fangenSteer(bot, meH, fg.goal);

}

/** Findet das Sternbild im (verschobenen/skalierten) Himmel wieder – nur für Bots */
/**
 * Wackelturm-Bot: wählt Drehung und Position fürs fallende Teil.
 * Grobe Oberflächen-Karte des Turms in Halbblock-Spalten; bevorzugt flach aufliegende
 * Teile (wenig Lücken), niedrige Stellen und die Nähe zum Turm-Schwerpunkt.
 */
export function planTurm(lane: TurmLane): { rot: number; x: number } {
  const B = TURM.BLOCK;
  const half = B / 2;
  const bw = B / 4;
  const n = Math.round((TURM.LANE_HALF * 2 * B) / bw);
  const binX = (i: number) => -TURM.LANE_HALF * B + (i + 0.5) * bw;
  const platHalf = (TURM.PLATFORM_W / 2) * B;
  const surf = Array.from({ length: n }, (_, i) => (Math.abs(binX(i)) < platHalf ? 0 : -Infinity));
  /** Spalten unter einer Zelle (r: halbe Breite) */
  const binsOf = (cx: number, r: number) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (Math.abs(binX(i) - cx) < r) out.push(i);
    return out;
  };
  let comX = 0;
  let count = 0;
  const p = lane.pieces;
  for (let k = 0; k < p.length; k += 6) {
    const [, shape, , x, y, a] = p.slice(k, k + 6);
    if (y < -B) continue;
    comX += x;
    count++;
    for (const o of turmCellOffsets(shape, a / 100)) {
      const top = y - o.y + B / 2 + 1;
      for (const i of binsOf(x + o.x, B / 2 + 1)) surf[i] = Math.max(surf[i], top);
    }
  }
  comX = count ? comX / count : 0;
  const act = lane.active!;
  let best = { rot: 0, x: 0, score: Infinity };
  // Nur flach liegende Drehungen (geringste Höhe) – hohe, schmale Teile kippen zu leicht
  const heightOf = (rot: number) => {
    const ys = turmCellOffsets(act.shape, (rot * Math.PI) / 2).map((o) => o.y);
    return Math.max(...ys) - Math.min(...ys);
  };
  const flat = Math.min(...[0, 1, 2, 3].map(heightOf));
  for (let rot = 0; rot < 4; rot++) {
    if (heightOf(rot) > flat + 1) continue;
    const offs = turmCellOffsets(act.shape, (rot * Math.PI) / 2);
    const minOx = Math.min(...offs.map((o) => o.x));
    const maxOx = Math.max(...offs.map((o) => o.x));
    for (let x = -platHalf; x <= platHalf; x += half) {
      // Nur Positionen, bei denen das Teil komplett über der Plattform liegt
      if (x + minOx - B / 2 < -platHalf - 0.5 || x + maxOx + B / 2 > platHalf + 0.5) continue;
      // Landehöhe des Schwerpunkts: höchster Kontakt unter irgendeiner Zelle
      let comY = -Infinity;
      const under: number[] = [];
      for (const o of offs) {
        const bins = binsOf(x + o.x, B / 2 - 1);
        const s = bins.length ? Math.max(...bins.map((i) => surf[i])) : -Infinity;
        under.push(s);
        comY = Math.max(comY, s + o.y + B / 2);
      }
      if (!Number.isFinite(comY)) continue;
      let holes = 0;
      let overSea = 0;
      let top = -Infinity;
      let supLo = Infinity;
      let supHi = -Infinity;
      offs.forEach((o, j) => {
        const bottom = comY - o.y - B / 2;
        top = Math.max(top, comY - o.y + B / 2);
        // Zellen, unter denen eine eigene Zelle liegt, zählen nicht
        if (offs.some((q) => Math.abs(q.x - o.x) < 2 && q.y > o.y + 2)) return;
        if (Number.isFinite(under[j])) holes += Math.max(0, bottom - under[j]);
        else overSea++;
        if (Number.isFinite(under[j]) && bottom - under[j] < 2) {
          supLo = Math.min(supLo, x + o.x - B / 2);
          supHi = Math.max(supHi, x + o.x + B / 2);
        }
      });
      // Liegt der Schwerpunkt nicht über der Auflage, kippt das Teil
      const tips = x < supLo + 3 || x > supHi - 3 ? B * 2 : 0;
      const score = top + holes * 0.8 + tips + overSea * B * 3 + Math.abs(x - comX) * 0.25 + Math.random() * B * 0.4;
      if (score < best.score) best = { rot, x, score };
    }
  }
  return { rot: best.rot, x: best.x };
}

export function solveConstellation(name: string, stars: { id: number; x: number; y: number }[]): [number, number][] {
  const c = CONSTELLATIONS.find((k) => k.name === name);
  if (!c) return [];
  const [o0, o1] = [c.stars[0], c.stars[1]];
  const d0 = Math.hypot(o1[0] - o0[0], o1[1] - o0[1]);
  for (const p of stars) {
    for (const q of stars) {
      if (p === q) continue;
      const sc = Math.hypot(q.x - p.x, q.y - p.y) / d0;
      const ox = p.x - o0[0] * sc;
      const oy = p.y - o0[1] * sc;
      const mapped = c.stars.map(([x, y]) => stars.find((s) => Math.hypot(s.x - (ox + x * sc), s.y - (oy + y * sc)) < 0.004));
      if (mapped.every(Boolean)) return c.edges.map(([a, b]) => [mapped[a]!.id, mapped[b]!.id]);
    }
  }
  return [];
}

