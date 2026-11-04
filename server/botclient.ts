/**
 * Ein automatischer Testspieler. Wird vom Skript `npm run bots` und
 * direkt vom Server ("Bot hinzufügen" in der Lobby) benutzt.
 */
import { io, type Socket } from 'socket.io-client';
import type { ArenaState, GameState, KurveState, ParcoursState, PrivateState, TttState } from '../shared/types';
import { ARENA, type ArenaCell, DIRS, FLOOD_ORDER, blastCells, cellIdx } from '../shared/arena';
import { BASE_SOLIDS, PARCOURS, PART_DEFS, type Rect, canPlace, overlaps, partRect, snap } from '../shared/parcours';
import { randomLook } from '../shared/avatar';
import { BOTTLE, RANGE, THROW_SPOT, WIND_K } from '../shared/flunky';
import { KURVE, ROOMS, TTT } from '../shared/games';
import { type TrailCursor, ingestTrail, walkLine } from '../shared/kurve';
import { lineFree, nextWaypoint, roomInner } from '../shared/house';
import { CONSTELLATIONS, DESCENT_OBSTACLES, WRAP_DISTRACTORS, WRAP_RECIPE } from '../shared/dategames';
import { PROPS, VS, type PropType, baseRect, canStand, judgeSpot, nextWaypoint as verstWaypoint, overlap, pickTarget, zoneAt } from '../shared/verstecken';

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

/** Findet das Sternbild im (verschobenen/skalierten) Himmel wieder – nur für Bots */
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

