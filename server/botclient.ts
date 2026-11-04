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
import { PROPS, VS, type PropType, baseRect, canStand, judgeSpot, nextWaypoint, overlap, pickTarget, zoneAt } from '../shared/verstecken';

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

    if (m.kind === 'verstecken') this.playVerstecken(m.state);

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
    const wp = nextWaypoint(p.x, p.y, tx, ty);
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

