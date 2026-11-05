import Phaser from 'phaser';
import type { FunkState, GameState, Team } from '../../shared/types';
import { TEAM_INFO, WORLD } from '../../shared/flunky';
import { FUNK_ZONES, funkOther } from '../../shared/funk';
import { C } from '../art/palette';
import { Pix, rng, shade } from '../art/pix';
import { paintSky } from '../art/ground';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { pcol } from './playerColor';
import { Countdown, GOLD, LIGHT, background, ensureTex, fitText, nameTag, panel, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';

/** Radio-Gehäuse (Welt-Koordinaten) */
const RADIO = { x: 30, y: 40, w: 420, h: 168 };
/** Skalenfenster: 0 → X0, 100 → X1 */
const WIN = { x: 56, y: 70, w: 368, h: 54 };
const X0 = 64;
const X1 = 416;
const vx = (v: number) => X0 + (Math.max(0, Math.min(100, v)) / 100) * (X1 - X0);
/** Anzeige-Fenster in der Mitte unter der Skala */
const DISP = { x: 158, y: 134, w: 164, h: 62 };
const ZONE_COL: Record<number, number> = { 2: 0xf0b13a, 3: 0xf0973a, 4: 0xe0503f };
const AMBER = '#ffcf5a';

/**
 * Funkfrequenz am TV: ein großes Holzradio mit Frequenzskala zwischen zwei Polen.
 * Der rote Zeiger zeigt live den Mittelwert der Team-Regler (kleine Marken = einzelne Regler),
 * in der Auflösung klappen die Zielzonen 2/3/4 auf. Unten stehen beide Teams am Tisch.
 */
export class FunkScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private needleG!: Phaser.GameObjects.Graphics;
  private zoneG!: Phaser.GameObjects.Graphics;
  private noiseG!: Phaser.GameObjects.Graphics;
  private timerBar!: Phaser.GameObjects.Graphics;
  private zoneLabels: Phaser.GameObjects.Text[] = [];
  private juice!: Juice;
  private countdown = new Countdown();
  private total = 1;
  private phaseKey = '';
  private stateKey = '';
  /** Angezeigte Zeigerposition (weich nachgezogen) */
  private shown = 50;
  private tickBucket = 25;
  private tickAt = 0;
  /** Zonen-Aufklappen 0 … 1 */
  private zoneOpen = 0;
  private zoneTween: Phaser.Tweens.Tween | null = null;
  private lastBets = 0;

  constructor() {
    super('funk');
  }

  create() {
    this.phaseKey = '';
    this.stateKey = '';
    this.shown = 50;
    this.tickBucket = 25;
    this.tickAt = 0;
    this.zoneOpen = 0;
    this.zoneTween = null;
    this.zoneLabels = [];
    this.lastBets = 0;
    this.total = 1;

    background(this, 'funk', WORLD.W, WORLD.H, paintRoom);
    this.add.image(RADIO.x, RADIO.y, ensureTex(this, 'funk_radio', radioPix)).setOrigin(0, 0).setDepth(-500);

    this.zoneG = this.add.graphics().setDepth(-400);
    this.noiseG = this.add.graphics().setDepth(-390);
    this.needleG = this.add.graphics().setDepth(-300);
    // Ziffern 2 3 4 3 2 in der Mitte der Zonenbänder (Abstand zum Ziel in Skaleneinheiten)
    FUNK_ZONES.forEach((z, i) => {
      const inner = i ? FUNK_ZONES[i - 1].r : 0;
      for (const side of i ? [-1, 1] : [0]) {
        const t = txt(this, 0, WIN.y + WIN.h - 12, String(z.points), { color: LIGHT }).setDepth(-350).setVisible(false);
        t.setData('off', side * (i ? (inner + z.r) / 2 : 0));
        this.zoneLabels.push(t);
      }
    });
    this.layer = this.add.container(0, 0).setDepth(900);
    panel(this, 6, 3, 468, 30).setDepth(800);
    this.timerBar = this.add.graphics().setDepth(1000);
    this.juice = new Juice(this, { depth: 1700 });

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  // ---------------------------------------------------------------- Frame

  update(_t: number, dtMs: number) {
    const s = getState();
    const f = s?.mini?.kind === 'funk' ? s.mini.state : null;
    if (!f) return;
    const dt = Math.min(0.1, dtMs / 1000);

    // Zeiger: im Überlegen rauscht er um die Mitte, sonst folgt er dem Team-Mittelwert
    const goal = f.sub === 'reveal' && f.reveal ? f.reveal.dial : f.sub === 'intro' || f.sub === 'clue' ? 50 + Math.sin(performance.now() / 260) * 6 + Math.sin(performance.now() / 97) * 2 : f.dial;
    this.shown += (goal - this.shown) * Math.min(1, dt * 9);
    const bucket = Math.round(this.shown / 2);
    if (bucket !== this.tickBucket && (f.sub === 'tune' || f.sub === 'bet')) {
      const now = performance.now();
      if (now - this.tickAt > 45) {
        this.tickAt = now;
        sfx('tick', { pitch: 0.8 + this.shown / 120, vol: 0.28, x: vx(this.shown) });
      }
    }
    this.tickBucket = bucket;

    this.drawNeedle(f);
    this.drawZones(f);
    this.drawNoise(f);

    // Zeitleiste unter dem Kopf
    this.timerBar.clear();
    const frac = this.countdown.none ? 0 : this.countdown.remaining / this.total;
    if (frac > 0 && f.sub !== 'reveal' && f.sub !== 'over' && f.sub !== 'intro') {
      this.timerBar.fillStyle(0x2d1b12).fillRect(12, 34, 456, 4);
      const col = f.sub === 'bet' ? TEAM_INFO[funkOther(f.active)].colorNum : frac < 0.2 ? 0xe04a3f : TEAM_INFO[f.active].colorNum;
      this.timerBar.fillStyle(col).fillRect(13, 35, 454 * frac, 2);
    }
  }

  private drawNeedle(f: FunkState) {
    const g = this.needleG.clear();
    // Einzelne Regler des Teams als kleine Marken (Spielerfarbe) unter dem Fenster
    if (f.sub === 'tune' || f.sub === 'bet') {
      for (const [id, v] of Object.entries(f.dials)) {
        const x = Math.round(vx(v));
        g.fillStyle(0x2d1b12).fillTriangle(x - 4, WIN.y + WIN.h + 7, x + 4, WIN.y + WIN.h + 7, x, WIN.y + WIN.h);
        g.fillStyle(pcol(id).num).fillTriangle(x - 3, WIN.y + WIN.h + 6, x + 3, WIN.y + WIN.h + 6, x, WIN.y + WIN.h + 1);
      }
    }
    const x = Math.round(vx(this.shown));
    const top = WIN.y - 4;
    const bot = WIN.y + WIN.h + 2;
    g.fillStyle(0x000000, 0.25).fillRect(x + 2, top + 2, 2, bot - top);
    g.fillStyle(0x2d1b12).fillRect(x - 2, top, 5, bot - top);
    g.fillStyle(f.locked || f.sub === 'reveal' ? 0xff4a3a : 0xd8302a).fillRect(x - 1, top + 1, 3, bot - top - 2);
    g.fillStyle(0xffd25e).fillRect(x - 3, top - 4, 7, 5);
    g.fillStyle(0x2d1b12).fillRect(x - 3, top - 4, 7, 1);
  }

  private drawZones(f: FunkState) {
    const g = this.zoneG.clear();
    const r = f.sub === 'reveal' ? f.reveal : null;
    const k = r ? this.zoneOpen : 0;
    for (const t of this.zoneLabels) t.setVisible(false);
    if (!r || k <= 0) return;
    const cx = vx(r.target);
    const unit = (X1 - X0) / 100;
    // Von außen nach innen, damit die 4er-Zone oben liegt
    for (const z of [...FUNK_ZONES].reverse()) {
      const half = z.r * unit * k;
      const a = Math.max(WIN.x, cx - half);
      const b = Math.min(WIN.x + WIN.w, cx + half);
      if (b <= a) continue;
      g.fillStyle(ZONE_COL[z.points] ?? 0xf0b13a).fillRect(a, WIN.y, b - a, WIN.h);
      g.fillStyle(0xffffff, 0.18).fillRect(a, WIN.y, b - a, 3);
    }
    g.fillStyle(0xfff6dc).fillRect(Math.round(cx), WIN.y, 1, WIN.h);
    if (k < 0.95) return;
    for (const t of this.zoneLabels) {
      const x = cx + Number(t.getData('off')) * unit;
      if (x > WIN.x + 5 && x < WIN.x + WIN.w - 5) t.setPosition(x, WIN.y + WIN.h - 12).setVisible(true);
    }
  }

  /** Rauschen im Skalenfenster, solange noch kein Hinweis da ist */
  private drawNoise(f: FunkState) {
    const g = this.noiseG.clear();
    if (f.sub !== 'intro' && f.sub !== 'clue') return;
    for (let i = 0; i < 46; i++) {
      const x = WIN.x + Math.random() * WIN.w;
      const y = WIN.y + Math.random() * WIN.h;
      g.fillStyle(Math.random() < 0.5 ? 0x3d2414 : 0xffffff, 0.35).fillRect(x, y, Math.random() < 0.3 ? 3 : 1, 1);
    }
  }

  // ---------------------------------------------------------------- Zustand

  private render(s: GameState) {
    if (s.mini?.kind !== 'funk') return;
    const f = s.mini.state;
    const pk = `${f.sub}-${f.phaseNo}`;
    if (pk !== this.phaseKey) {
      this.phaseKey = pk;
      this.countdown.set(f.endsIn);
      this.total = Math.max(1, f.endsIn);
      this.onPhase(f);
    }
    const nBets = Object.keys(f.bets).length;
    if (f.sub === 'bet' && nBets > this.lastBets) sfx('pop', { pitch: 1 + nBets * 0.06, vol: 0.5 });
    this.lastBets = f.sub === 'bet' ? nBets : 0;

    const players = s.players.map((p) => [p.id, p.name, p.connected]);
    const key = JSON.stringify([f.sub, f.round, f.phaseNo, f.clue, f.captain, f.funker, f.bets, f.score, f.pair, Object.keys(f.dials).sort(), players]);
    if (key === this.stateKey) return;
    this.stateKey = key;
    this.layer.removeAll(true);
    this.renderHud(f);
    this.renderPoles(f);
    this.renderDisplay(f);
    this.renderGrilles(f);
    this.renderTeams(f);
  }

  private onPhase(f: FunkState) {
    const team = TEAM_INFO[f.active].name;
    const other = TEAM_INFO[funkOther(f.active)].name;
    const funker = spokenName(playerById(f.funker)?.name);
    if (f.sub !== 'reveal') {
      this.zoneTween?.stop();
      this.zoneOpen = 0;
    }
    switch (f.sub) {
      case 'intro':
        sfx('select');
        this.juice.banner(`${f.active === 'A' ? 'SONNE' : 'MEER'} FUNKT!`, `Runde ${f.round}/${f.rounds} · Funker: ${tagName(playerById(f.funker)?.name ?? '?')}`, 2600);
        say(`Runde ${f.round}. ${team} funkt! Funker ist ${funker}.`, { interrupt: true });
        break;
      case 'clue':
        sfx('whoosh', { vol: 0.5 });
        break;
      case 'tune':
        sfx('go');
        say('Dreht die Frequenz!');
        break;
      case 'bet':
        sfx('select', { pitch: 1.2 });
        this.juice.zoomPunch(0.03);
        say(`${other}: weiter links oder weiter rechts?`, { interrupt: true });
        break;
      case 'reveal':
        this.reveal(f);
        break;
      case 'over': {
        sfx('fanfare');
        const { A, B } = f.score;
        const win: Team | null = A > B ? 'A' : B > A ? 'B' : null;
        this.juice.burst(240, 120, 'confetti', 60);
        this.juice.banner('FUNKSTILLE!', win ? `${TEAM_INFO[win].name} gewinnt ${Math.max(A, B)} : ${Math.min(A, B)}` : `Unentschieden ${A} : ${B}`, 3000);
        say(win ? `${TEAM_INFO[win].name} gewinnt mit ${Math.max(A, B)} zu ${Math.min(A, B)}!` : `Unentschieden, ${A} zu ${B}!`, { interrupt: true });
        break;
      }
    }
  }

  /** Auflösung: Trommelwirbel → Zonen klappen auf → Punkte */
  private reveal(f: FunkState) {
    const r = f.reveal;
    if (!r) return;
    const team = TEAM_INFO[f.active].name;
    const other = TEAM_INFO[funkOther(f.active)].name;
    sfx('drumroll');
    this.zoneOpen = 0;
    this.zoneTween?.stop();
    this.zoneTween = this.tweens.addCounter({
      from: 0,
      to: 1,
      delay: 1100,
      duration: 650,
      ease: 'Back.Out',
      onStart: () => sfx('whoosh'),
      onUpdate: (tw) => (this.zoneOpen = Math.max(0, tw.getValue() ?? 0)),
      onComplete: () => {
        this.zoneOpen = 1;
        const x = vx(r.dial);
        if (r.points > 0) {
          sfx(r.points === 4 ? 'fanfare' : 'win', { x });
          sfx('cheer', { vol: 0.5, delay: 0.2 });
          this.juice.burst(x, WIN.y + 10, r.points === 4 ? 'confetti' : 'spark', r.points === 4 ? 60 : 18);
          this.juice.float(x, WIN.y - 16, `+${r.points}`, 'gold');
          this.juice.shake(r.points === 4 ? 2 : 1);
          if (r.points === 4) this.juice.flash(0xffd25e, 160);
        } else {
          sfx('lose', { x });
          this.juice.burst(x, WIN.y + 20, 'smoke');
        }
        if (r.betRight) this.time.delayedCall(700, () => sfx('coin', { x: r.bet === 'left' ? 80 : 400 }));
        const pts = r.points ? `${r.points} Punkte für ${team}!` : `Rauschen! Keine Punkte für ${team}.`;
        const bet = r.betRight ? ` ${other} hat richtig gewettet: ein Punkt.` : '';
        say(pts + bet, { interrupt: true });
      },
    });
  }

  // ---------------------------------------------------------------- Aufbau

  private renderHud(f: FunkState) {
    const L = this.layer;
    const plate = (t: Team, x: number, align: 0 | 1) => {
      const g = this.add.graphics();
      const w = 104;
      const left = align === 0 ? x : x - w;
      g.fillStyle(0x2d1b12).fillRect(left, 7, w, 22);
      g.fillStyle(TEAM_INFO[t].colorNum).fillRect(left + 2, 9, w - 4, 18);
      if (f.active === t && f.sub !== 'over') g.lineStyle(2, 0xffffff).strokeRect(left + 1, 8, w - 2, 20);
      L.add(g);
      L.add(txt(this, left + 6, 10, t === 'A' ? 'SONNE' : 'MEER', { origin: [0, 0], color: '#3d2414', shadow: false }));
      L.add(txt(this, left + w - 6, 11, String(f.score[t]), { size: 16, origin: [1, 0], color: '#3d2414', shadow: false }));
      L.add(txt(this, left + 6, 20, `${f.teams[t].length} Spieler`, { origin: [0, 0], color: '#5e3518', shadow: false }).setScale(0.75));
    };
    plate('A', 12, 0);
    plate('B', 468, 1);
    L.add(txt(this, 240, 8, 'FUNKFREQUENZ', { color: '#a8342a', shadow: false }));
    const what: Record<FunkState['sub'], string> = {
      intro: `Runde ${f.round}/${f.rounds}`,
      clue: `Runde ${f.round}/${f.rounds} · Funker überlegt`,
      tune: `Runde ${f.round}/${f.rounds} · ${TEAM_INFO[f.active].name} dreht`,
      bet: `Runde ${f.round}/${f.rounds} · ${TEAM_INFO[funkOther(f.active)].name} wettet`,
      reveal: `Runde ${f.round}/${f.rounds} · Auflösung`,
      over: `Ziel: ${f.winScore} Punkte`,
    };
    L.add(fitText(txt(this, 240, 20, what[f.sub], { color: '#3d2414', shadow: false }), 236, 0.7));
  }

  private renderPoles(f: FunkState) {
    const [l, r] = f.pair;
    const L = this.layer;
    // Beide Pole gleich groß: groß nur, wenn beide kurz sind
    const big = Math.max(l.length, r.length) <= 11;
    const mk = (s: string, x: number, origin: number) => {
      const t = txt(this, x, RADIO.y + (big ? 8 : 12), s.toUpperCase(), { size: big ? 16 : 8, origin: [origin, 0], color: GOLD });
      return fitText(t, 176, 0.55);
    };
    L.add(mk(`◀ ${l}`, WIN.x + 4, 0));
    L.add(mk(`${r} ▶`, WIN.x + WIN.w - 4, 1));
  }

  private renderDisplay(f: FunkState) {
    const L = this.layer;
    const cx = DISP.x + DISP.w / 2;
    const name = tagName(playerById(f.funker)?.name ?? '?');
    const line = (y: number, s: string, size: 8 | 16 = 8, color = AMBER) => {
      const t = txt(this, cx, y, s, { size, color, shadow: false, wrap: DISP.w - 10 });
      fitText(t, DISP.w - 8, 0.6);
      L.add(t);
      return t;
    };
    switch (f.sub) {
      case 'intro':
        line(DISP.y + 10, TEAM_INFO[f.active].name.toUpperCase(), 8, TEAM_INFO[f.active].color);
        line(DISP.y + 24, 'FUNKT!', 16);
        line(DISP.y + 46, `Funker: ${name}`);
        break;
      case 'clue': {
        line(DISP.y + 8, `${name}`, 8, TEAM_INFO[f.active].color);
        const t = line(DISP.y + 22, 'sucht die\nFrequenz ...');
        this.tweens.add({ targets: t, alpha: 0.35, duration: 500, yoyo: true, repeat: -1 });
        line(DISP.y + 48, 'Gleich kommt der Hinweis');
        break;
      }
      case 'tune':
      case 'bet': {
        line(DISP.y + 6, `${name} funkt:`, 8, TEAM_INFO[f.active].color);
        if (f.clue) {
          const c = `„${f.clue}“`;
          line(DISP.y + (c.length <= 10 ? 22 : 20), c, c.length <= 10 ? 16 : 8, '#fff4d6');
        } else line(DISP.y + 22, '(Hinweis laut\ngesagt)', 8, '#e6c88a');
        line(DISP.y + 48, f.sub === 'tune' ? (f.captain ? `Kapitän: ${tagName(playerById(f.captain)?.name ?? '?')}` : 'Dreht am Regler!') : 'TIPP STEHT!', 8, f.sub === 'bet' ? '#ff8a7a' : AMBER);
        break;
      }
      case 'reveal': {
        const r = f.reveal!;
        const head = r.points === 4 ? 'VOLLTREFFER!' : r.points ? `${r.points} PUNKTE!` : 'RAUSCHEN ...';
        const t = line(DISP.y + 8, head, r.points === 4 ? 8 : 16, r.points ? GOLD : '#e6c88a');
        t.setAlpha(0);
        this.tweens.add({ targets: t, alpha: 1, delay: 1750, duration: 200 });
        const other = funkOther(f.active) === 'A' ? 'Sonne' : 'Meer';
        const bet = r.bet === null ? `${other}: keine Wette` : `${other} ${r.bet === 'left' ? 'links' : 'rechts'}: ${r.betRight ? '+1!' : 'falsch'}`;
        const b = line(DISP.y + 34, `Ziel ${Math.round(r.target)} · Zeiger ${Math.round(r.dial)}\n${bet}`);
        b.setAlpha(0);
        this.tweens.add({ targets: b, alpha: 1, delay: 1950, duration: 200 });
        break;
      }
      case 'over': {
        const { A, B } = f.score;
        line(DISP.y + 8, 'FUNKSTILLE', 16);
        line(DISP.y + 32, `SONNE ${A} : ${B} MEER`);
        line(DISP.y + 46, A === B ? 'Unentschieden!' : `${TEAM_INFO[A > B ? 'A' : 'B'].name} gewinnt!`, 8, '#fff4d6');
        break;
      }
    }
  }

  /** Links/rechts auf den Lautsprechern: Wette des Gegnerteams */
  private renderGrilles(f: FunkState) {
    if (f.sub !== 'bet' && f.sub !== 'reveal') return;
    const L = this.layer;
    const other = funkOther(f.active);
    const team = f.teams[other];
    const left = team.filter((id) => f.bets[id] === 'left').length;
    const right = team.filter((id) => f.bets[id] === 'right').length;
    const r = f.sub === 'reveal' ? f.reveal : null;
    const side = (x: number, arrow: string, n: number, s: 'left' | 'right') => {
      const won = r && r.bet === s;
      const g = this.add.graphics();
      g.fillStyle(0x2d1b12, 0.75).fillRect(x - 36, 152, 72, 42);
      if (won) g.lineStyle(2, r.betRight ? 0x9ad65a : 0xff8a7a).strokeRect(x - 35, 153, 70, 40);
      L.add(g);
      L.add(txt(this, x, 156, arrow, { size: 16, color: TEAM_INFO[other].color }));
      L.add(txt(this, x, 178, `${n}× ${s === 'left' ? 'links' : 'rechts'}`, { color: LIGHT }));
    };
    side(82, '◀', left, 'left');
    side(398, '▶', right, 'right');
  }

  private renderTeams(f: FunkState) {
    const L = this.layer;
    for (const t of ['A', 'B'] as Team[]) {
      const ids = f.teams[t];
      const n = ids.length;
      const x0 = t === 'A' ? 12 : 252;
      const w = 216;
      const spacing = Math.min(40, w / Math.max(1, n));
      const g = this.add.graphics();
      g.fillStyle(TEAM_INFO[t].colorNum, 0.85).fillRect(x0, 252, w, 4);
      L.add(g);
      ids.forEach((id, i) => {
        const p = playerById(id);
        if (!p) return;
        const x = Math.round(x0 + w / 2 + (i - (n - 1) / 2) * spacing);
        const y = 252;
        const fig = figure(this, p.look, x, y, 1.4);
        if (!p.connected) fig.setAlpha(0.4);
        L.add(fig);
        const isFunker = f.funker === id && f.sub !== 'over';
        const isCap = f.captain === id && f.active === t && (f.sub === 'tune' || f.sub === 'clue' || f.sub === 'intro');
        L.add(nameTag(this, x, y + 2, p.name, isFunker ? '#a8342a' : undefined, spacing - 2));
        if (isFunker) {
          // kleine Antenne über dem Funker
          const a = this.add.graphics();
          a.fillStyle(0x2d1b12).fillRect(x - 1, y - 52, 3, 14);
          a.fillStyle(0xd8302a).fillRect(x - 2, y - 56, 5, 5);
          L.add(a);
          this.tweens.add({ targets: a, alpha: 0.4, duration: 300, yoyo: true, repeat: -1 });
        }
        if (isCap) L.add(txt(this, x + 9, y - 44, 'K', { color: GOLD }));
        const bet = f.bets[id];
        if (bet && (f.sub === 'bet' || f.sub === 'reveal')) {
          const g2 = this.add.graphics();
          g2.fillStyle(0x2d1b12).fillRect(x - 8, y - 56, 16, 13);
          g2.fillStyle(TEAM_INFO[t].colorNum).fillRect(x - 7, y - 55, 14, 11);
          L.add(g2);
          L.add(txt(this, x, y - 53, bet === 'left' ? '<' : '>', { color: '#3d2414', shadow: false }));
        }
        if (f.sub === 'tune' && id in f.dials) {
          const d = this.add.graphics();
          d.fillStyle(pcol(id).num).fillRect(x - 3, y - 46, 6, 3);
          L.add(d);
        }
      });
    }
  }
}

// ---------------------------------------------------------------- Pixel-Art

/** Abendliches Wohnzimmer im Ferienhaus: Tapete, Fenster mit Meer, Holztisch */
function paintRoom(p: Pix) {
  const r = rng(31);
  p.rect(0, 0, WORLD.W, WORLD.H, '#3a2a4a');
  for (let x = 0; x < WORLD.W; x += 16) p.rect(x, 0, 8, 212, '#42304f');
  for (let i = 0; i < 160; i++) p.px(r() * WORLD.W, r() * 212, '#4d3a5c');
  // Fenster links und rechts mit Abendhimmel und Meer
  for (const wx of [0, 452]) {
    p.rect(wx - 2, 46, 32, 110, C.woodDarker);
    paintSky(p, wx, 48, 28, 70, ['#f6b26b', '#d96a86', '#8e5a9e']);
    p.rect(wx, 118, 28, 36, '#2b6ba6');
    for (let j = 0; j < 6; j++) p.hline(wx + 2 + (j * 5) % 18, 122 + j * 5, 8, '#4aa2dc');
    p.vline(wx + 14, 48, 106, C.woodDarker);
  }
  // Antenne (hinter dem Radio)
  for (let i = 0; i < 46; i++) {
    p.rect(388 + i * 0.9, 42 - i * 0.8, 2, 2, i % 6 < 3 ? '#cfcbc1' : '#a7a39a');
  }
  p.disc(430, 6, 3, '#e0503f');
  // Tisch
  p.rect(0, 206, WORLD.W, 64, C.woodDark);
  p.rect(0, 206, WORLD.W, 3, C.woodLight);
  for (let i = 0; i < 40; i++) p.hline(r() * WORLD.W, 212 + r() * 56, 10 + r() * 30, C.woodDarker);
  p.rect(0, 209, WORLD.W, 2, C.wood);
  // Schatten unter dem Radio
  p.rect(RADIO.x + 8, 206, RADIO.w - 16, 4, shade(C.woodDark, 0.6));
}

/** Holzradio mit Messingrahmen, Skala, Lautsprechern und zwei Drehknöpfen (lokale Koordinaten) */
function radioPix(): Pix {
  const W = RADIO.w;
  const H = RADIO.h;
  const p = new Pix(W, H);
  const r = rng(77);
  // Gehäuse mit abgerundeten Ecken
  p.rect(6, 0, W - 12, H, C.outline);
  p.rect(0, 6, W, H - 12, C.outline);
  p.rect(2, 2, W - 4, H - 4, C.outline);
  p.rect(6, 2, W - 12, H - 4, '#9a5a2c');
  p.rect(2, 6, W - 4, H - 12, '#9a5a2c');
  p.rect(4, 4, W - 8, H - 8, '#9a5a2c');
  for (let i = 0; i < 70; i++) p.hline(6 + r() * (W - 40), 6 + r() * (H - 12), 8 + r() * 30, r() < 0.5 ? '#8a4f26' : '#a8683a');
  p.hline(8, 4, W - 16, '#c98a4a');
  p.hline(8, H - 5, W - 16, '#6a3a1a');
  // Pol-Plakette oben
  p.rect(20, 5, W - 40, 22, '#2a1a12');
  p.rect(21, 6, W - 42, 1, '#5e3518');
  // Messingrahmen + Skalenfenster
  const wx = WIN.x - RADIO.x;
  const wy = WIN.y - RADIO.y;
  p.rect(wx - 4, wy - 4, WIN.w + 8, WIN.h + 8, '#6e5320');
  p.rect(wx - 3, wy - 3, WIN.w + 6, WIN.h + 6, '#d9b45a');
  p.rect(wx - 1, wy - 1, WIN.w + 2, WIN.h + 2, '#6e5320');
  p.rect(wx, wy, WIN.w, WIN.h, '#f6e7b8');
  p.rect(wx, wy, WIN.w, 2, '#fff6dc');
  p.rect(wx, wy + WIN.h - 6, WIN.w, 6, '#ead398');
  // Skalenstriche oben und unten, große alle 10
  for (let v = 0; v <= 100; v += 2) {
    const x = Math.round(vx(v)) - RADIO.x;
    const len = v % 10 === 0 ? 10 : v % 5 === 0 ? 6 : 3;
    const col = v % 10 === 0 ? '#3d2414' : '#7a5a3a';
    p.vline(x, wy + 2, len, col);
    p.vline(x, wy + WIN.h - 2 - len, len, col);
  }
  // Mittelstreifen der Skala
  p.hline(vx(0) - RADIO.x, wy + WIN.h / 2, vx(100) - vx(0) + 1, '#d3ad6c');
  // Lautsprecher links/rechts
  const grille = (gx: number) => {
    p.rect(gx, 108, 80, 52, '#2d1b12');
    p.rect(gx + 2, 110, 76, 48, '#6e4a2c');
    for (let y = 112; y < 157; y += 4) for (let x = gx + 4; x < gx + 77; x += 4) p.rect(x, y, 2, 2, '#4a2f1c');
  };
  grille(12);
  grille(W - 92);
  // Anzeige in der Mitte
  const dx = DISP.x - RADIO.x;
  const dy = DISP.y - RADIO.y;
  p.rect(dx - 3, dy - 3, DISP.w + 6, DISP.h + 6, '#6e5320');
  p.rect(dx - 2, dy - 2, DISP.w + 4, DISP.h + 4, '#d9b45a');
  p.rect(dx, dy, DISP.w, DISP.h, '#1e1410');
  for (let y = dy; y < dy + DISP.h; y += 3) p.hline(dx, y, DISP.w, '#251a14');
  // Drehknöpfe
  for (const kx of [106, W - 106]) {
    p.disc(kx, 124, 12, '#2d1b12');
    p.disc(kx, 124, 10, '#cfcbc1');
    p.disc(kx, 123, 8, '#e8e4da');
    for (let a = 0; a < 12; a++) p.px(kx + Math.cos((a / 12) * Math.PI * 2) * 9, 124 + Math.sin((a / 12) * Math.PI * 2) * 9, '#7f7b73');
    p.rect(kx - 1, 114, 2, 6, '#a8342a');
  }
  // Füße
  p.rect(30, H - 3, 30, 3, '#2d1b12');
  p.rect(W - 60, H - 3, 30, 3, '#2d1b12');
  return p;
}
