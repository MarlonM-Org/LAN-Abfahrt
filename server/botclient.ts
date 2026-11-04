/**
 * Ein automatischer Testspieler. Wird vom Skript `npm run bots` und
 * direkt vom Server ("Bot hinzufügen" in der Lobby) benutzt.
 */
import { io, type Socket } from 'socket.io-client';
import type { GameState, PrivateState } from '../shared/types';
import { randomLook } from '../shared/avatar';
import { BOTTLE, RANGE, THROW_SPOT, WIND_K } from '../shared/flunky';
import { ROOMS } from '../shared/games';
import { GEIST, inCone, navTarget, roomCenter } from '../shared/geist';
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

