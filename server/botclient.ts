/**
 * Ein automatischer Testspieler. Wird vom Skript `npm run bots` und
 * direkt vom Server ("Bot hinzufügen" in der Lobby) benutzt.
 */
import { io, type Socket } from 'socket.io-client';
import type { GameState, PrivateState, TttState } from '../shared/types';
import { randomLook } from '../shared/avatar';
import { BOTTLE, RANGE, THROW_SPOT, WIND_K } from '../shared/flunky';
import { ROOMS, TTT } from '../shared/games';
import { lineFree, nextWaypoint, roomInner } from '../shared/house';
import { CONSTELLATIONS, DESCENT_OBSTACLES, WRAP_DISTRACTORS, WRAP_RECIPE } from '../shared/dategames';

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
  /** Gedächtnis für "Verräter im Ferienhaus" */
  private ttt = { round: 0, grudges: new Set<string>(), lastAttack: 0, goal: null as { x: number; y: number } | null, stuckX: 0, stuckY: 0, stuckAt: 0 };

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

    if (m.kind === 'ttt') this.playTtt(m.state);

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

