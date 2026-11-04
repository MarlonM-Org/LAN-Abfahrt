/**
 * Ein automatischer Testspieler. Wird vom Skript `npm run bots` und
 * direkt vom Server ("Bot hinzufügen" in der Lobby) benutzt.
 */
import { io, type Socket } from 'socket.io-client';
import type { GameState, PrivateState } from '../shared/types';
import { randomLook } from '../shared/avatar';
import { BOTTLE, RANGE, THROW_SPOT, WIND_K } from '../shared/flunky';
import { ROOMS } from '../shared/games';
import { CONSTELLATIONS, DESCENT_OBSTACLES, WRAP_DISTRACTORS, WRAP_RECIPE } from '../shared/dategames';
import { WASSER, WASSER_BASE, WASSER_BLOCKERS, WASSER_HOSE, type WasserState } from '../shared/wasser';

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
  /** Wasserbomben-Schlacht: kleines Bot-Gedächtnis */
  private ws = { nextThrow: 0, lastX: 0, lastY: 0, checkAt: 0, wanderUntil: 0, wx: 0, wy: 0, strafe: 1, strafeAt: 0 };

  constructor(
    public name: string,
    private opts: BotOptions,
  ) {
    this.leader = !!opts.leader;
    this.socket = io(opts.url, { transports: ['websocket'], forceNew: true });
    // Regelmäßig "nachdenken" – der Zustand kommt nicht immer, wenn der Bot dran ist
    this.timer = setInterval(() => this.state && this.react(this.state), 200);
    this.socket.on('connect', () => {
      this.socket.emit('player:join', { name, look: randomLook() }, (r: { ok: boolean; playerId?: string; error?: string }) => {
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

    if (m.kind === 'wasser') {
      const st = m.state;
      this.once('wasser', async () => {
        this.wasserStep(st);
        await sleep(110);
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

