import Phaser from 'phaser';
import type { GameState, Team } from '../../shared/types';
import { WORLD, TEAM_INFO } from '../../shared/flunky';
import { AFB, AFB_CY, type AfbState } from '../../shared/autoball';
import { ballShine, beachBall, paintAutoballPitch } from '../art/autoball';
import { kartSprite } from '../art/kartsprites';
import { bus, getState, playerById } from './store';
import { ensurePortrait } from './textures';
import { pcol } from './playerColor';
import { Countdown, GOLD, LIGHT, background, ensureTex, panel, txt } from './ui';
import { Juice } from './juice';
import { SnapBuffer, lerpAngle, lerpJump } from './interp';
import { sfx } from './sfx';

interface CarView {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  /** Kleiner Pfeil in Spielerfarbe: dahin zeigt der Stick (solange das Auto noch nicht so steht) */
  aim: Phaser.GameObjects.Triangle;
  x: number;
  y: number;
  a: number;
  lastPuff: number;
  touches: number;
}

const hexNum = (h: string) => parseInt(h.slice(1), 16);
/** Tor-Wiederholung: so viel echte Zeit vor/nach dem Tor, abgespielt in so vielen ms (≈ 0,3×) */
const REPLAY_BACK_MS = 550;
const REPLAY_AHEAD_MS = 50;
const REPLAY_MS = 2000;
const fmtClock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Auto-Fußball auf dem TV: Draufsicht auf den Sandplatz neben dem Ferienhaus.
 * Karts in Teamfarbe mit Avatar-Kopf, großer Wasserball, Anzeigetafel oben, „TOR!“ mit Konfetti.
 */
export class AutoballScene extends Phaser.Scene {
  private cars = new Map<string, CarView>();
  private ball!: { root: Phaser.GameObjects.Container; spin: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Ellipse; x: number; y: number; rot: number };
  /** Wiedergabe-Uhr (60 ms hinter dem Server) mit 8 s Puffer – daraus kommt die Tor-Wiederholung */
  private buf = new SnapBuffer<AfbState>();
  private builtHalf = -1;
  private bg: Phaser.GameObjects.Image | null = null;
  private goalLabels: Phaser.GameObjects.Text[] = [];
  private score!: Phaser.GameObjects.Text;
  private clock!: Phaser.GameObjects.Text;
  private bannerBg!: Phaser.GameObjects.Image;
  private banner!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private intro!: Phaser.GameObjects.Container;
  /** Kleine Tafel oben im Feld für Countdown/LOS (die Autos an der Anstoß-Aufstellung bleiben sichtbar) */
  private small!: { bg: Phaser.GameObjects.Image; title: Phaser.GameObjects.Text; sub: Phaser.GameObjects.Text };
  private latest: AfbState | null = null;
  private lastGoal = 0;
  private lastSub = '';
  private lastRound = -1;
  private scoreKey = '';
  private bannerUntil = 0;
  private juice!: Juice;
  /** Anstoß-Countdown ohne Tafel (die Tafel lag sonst über dem Feld) */
  private kick!: Phaser.GameObjects.Text;
  private carFx = new Map<string, { bo: boolean }>();
  private cd = new Countdown();
  private clockCd = new Countdown();

  constructor() {
    super('autoball');
  }

  create() {
    this.cars.clear();
    this.builtHalf = -1;
    this.bg = null;
    this.goalLabels = [];
    this.latest = null;
    this.lastGoal = 0;
    this.lastSub = '';
    this.lastRound = -1;
    this.scoreKey = '';
    this.bannerUntil = 0;
    this.carFx.clear();
    this.buf = new SnapBuffer();
    this.juice = new Juice(this, { depth: 1500, clock: this.buf });

    // Ball
    const shadow = this.add.ellipse(2, 7, 20, 8, 0x000000, 0.22);
    const spin = this.add.image(0, 0, ensureTex(this, 'afb_ball', beachBall));
    const shine = this.add.image(0, 0, ensureTex(this, 'afb_shine', ballShine));
    this.ball = { root: this.add.container(WORLD.W / 2, AFB_CY, [shadow, spin, shine]), spin, shadow, x: WORLD.W / 2, y: AFB_CY, rot: 0 };

    // Anzeigetafel
    panel(this, 160, 2, 160, 38, 'dark').setDepth(1000);
    txt(this, 170, 8, 'SONNE', { color: TEAM_INFO.A.color, origin: [0, 0] }).setDepth(1001);
    txt(this, 310, 8, 'MEER', { color: TEAM_INFO.B.color, origin: [1, 0] }).setDepth(1001);
    this.score = txt(this, 240, 6, '0:0', { size: 16 }).setDepth(1001);
    this.clock = txt(this, 240, 26, '3:00', { color: GOLD }).setDepth(1001);

    this.bannerBg = panel(this, 70, 96, 340, 62, 'dark').setDepth(2000).setVisible(false);
    this.banner = txt(this, WORLD.W / 2, 104, '', { size: 24, color: GOLD }).setDepth(2001);
    this.sub = txt(this, WORLD.W / 2, 136, '', { size: 8, wrap: 320 }).setDepth(2001);
    this.kick = txt(this, WORLD.W / 2, AFB_CY - 44, '', { size: 24, color: GOLD }).setDepth(2001).setAlpha(0.9);
    this.intro = this.add.container(0, 0).setDepth(2002).setVisible(false);
    // Bildfest (scrollFactor 0): bleibt bei Kamera-Schwenk/Zoom der Tor-Wiederholung oben in der Mitte
    this.small = {
      bg: panel(this, 140, 46, 200, 46, 'dark').setDepth(2000).setVisible(false).setScrollFactor(0),
      title: txt(this, WORLD.W / 2, 50, '', { size: 24, color: GOLD }).setDepth(2001).setScrollFactor(0),
      sub: txt(this, WORLD.W / 2, 78, '', { size: 8 }).setDepth(2001).setScrollFactor(0),
    };

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private build(st: AfbState) {
    if (this.builtHalf === st.goalHalf) return;
    this.builtHalf = st.goalHalf;
    this.bg?.destroy();
    this.bg = background(this, `afb_${st.goalHalf}`, WORLD.W, WORLD.H, (p) => paintAutoballPitch(p, st.goalHalf));
    for (const t of this.goalLabels) t.destroy();
    const y = AFB_CY - st.goalHalf - 14;
    this.goalLabels = [
      txt(this, AFB.X0 - 9, y, 'SONNE', { color: TEAM_INFO.A.color }).setDepth(5),
      txt(this, AFB.X1 + 11, y, 'MEER', { color: TEAM_INFO.B.color }).setDepth(5),
    ];
  }

  private carView(id: string, st: AfbState): CarView | undefined {
    const have = this.cars.get(id);
    if (have) return have;
    const car = st.cars[id];
    const pl = playerById(id);
    if (!car || !pl) return undefined;
    const color = TEAM_INFO[car.t].color;
    // Ring in der Spielerfarbe des Abends (Kart selbst in Teamfarbe)
    const shadow = this.add.ellipse(1, 3, 15, 8, 0x000000, 0.25).setStrokeStyle(1, pcol(id).num);
    const body = this.add.image(0, 0, ensureTex(this, `afb_kart_${car.t}`, () => kartSprite(color)));
    const head = this.add.image(0, -3, ensurePortrait(this, pl.look)).setScale(0.62).setOrigin(0.5, 0.6);
    const aim = this.add.triangle(0, 0, 0, 0, 7, 3.5, 0, 7, pcol(id).num).setStrokeStyle(1, 0x2d1b12).setVisible(false);
    const root = this.add.container(car.x, car.y, [shadow, aim, body, head]);
    const v: CarView = { root, body, aim, x: car.x, y: car.y, a: car.a, lastPuff: 0, touches: car.k };
    this.cars.set(id, v);
    return v;
  }

  // ---------------------------------------------------------------- Frame

  update(_t: number, dms: number) {
    const st = this.latest;
    const s = this.buf.sample();
    if (!st || !s) return;
    const now = this.time.now;
    const { a, b, f } = s;
    const live = b.sub === 'play' || b.sub === 'goal';
    for (const [id, car] of Object.entries(b.cars)) {
      const v = this.carView(id, st);
      if (!v) continue;
      // Zwischen den zwei Ständen um die Wiedergabe-Uhr; beim Anstoß (Sprung) sofort an die Aufstellung
      const ca = a.cars[id] ?? car;
      v.x = lerpJump(ca.x, car.x, f, 60);
      v.y = lerpJump(ca.y, car.y, f, 60);
      v.a = lerpAngle(ca.a, car.a, f);
      v.body.setRotation(v.a + (car.d ? car.d * 0.35 : 0));
      // Stick-Richtung (absolute Lenkung): Pfeil, solange das Auto noch dorthin eindreht
      const off = car.s === null ? 0 : Math.abs(Phaser.Math.Angle.Wrap(car.s - v.a));
      v.aim.setVisible(live && off > 0.35);
      if (car.s !== null && off > 0.35) v.aim.setPosition(Math.cos(car.s) * 13, Math.sin(car.s) * 13).setRotation(car.s);
      v.root.setPosition(v.x, v.y).setDepth(10 + v.y);
      if (live && now - v.lastPuff > 70) {
        v.lastPuff = now;
        const bx = v.x - Math.cos(v.a) * 8;
        const by = v.y - Math.sin(v.a) * 8;
        if (car.bo) this.puff(bx, by, Math.random() < 0.5 ? 0xffd25e : 0xf0973a, 2.5, 260);
        else if (car.d) {
          const col = car.ch ? (Math.random() < 0.5 ? 0xf0973a : 0xffd25e) : 0x93d3f3;
          for (const side of [-1, 1]) this.puff(bx - Math.sin(v.a) * side * 5, by + Math.cos(v.a) * side * 5, col, 1.5, 200);
        }
      }
    }
    // Ball ebenfalls zwischen den Ständen (rollt mit dem zurückgelegten Weg)
    const bl = this.ball;
    const ox = bl.x;
    const oy = bl.y;
    bl.x = lerpJump(a.ball.x, b.ball.x, f, 80);
    bl.y = lerpJump(a.ball.y, b.ball.y, f, 80);
    const moved = Math.hypot(bl.x - ox, bl.y - oy);
    bl.rot += (moved / AFB.BALL_R) * (bl.x >= ox ? 1 : -1);
    bl.spin.setRotation(bl.rot);
    bl.root.setPosition(bl.x, bl.y).setDepth(10 + bl.y);
    if (b.sub === 'play' && moved * (1000 / Math.max(1, dms)) > 150 && Math.random() < 0.35) this.puff(bl.x, bl.y + 5, 0xe8d3a8, 2, 260);

    // Uhr
    if (st.sub === 'play') this.clock.setText(`${st.overtime ? 'GOLDEN GOAL ' : ''}${fmtClock(this.clockCd.remaining)}`);
    if (st.sub === 'countdown') this.countdownBanner(st);
    if (this.bannerUntil && now > this.bannerUntil) {
      this.bannerUntil = 0;
      if (this.latest?.sub === 'play') this.hideBanner();
    }
  }

  private puff(x: number, y: number, color: number, r: number, ms: number) {
    const c = this.add.circle(x, y, r, color, 0.85).setDepth(9 + y);
    this.tweens.add({ targets: c, scale: 0.2, alpha: 0, duration: ms, onComplete: () => c.destroy() });
  }

  private showBanner(text: string, sub: string, color = GOLD, size: 16 | 24 = 24) {
    this.banner.setText(text).setColor(color).setFontSize(size);
    this.sub.setText(sub);
    this.bannerBg.setVisible(true);
    this.showSmall('', '');
  }

  private hideBanner() {
    this.banner.setText('');
    this.sub.setText('');
    this.bannerBg.setVisible(false);
    this.showSmall('', '');
  }

  private showSmall(title: string, sub: string, color = GOLD, size: 16 | 24 = 24) {
    this.small.title.setText(title).setColor(color).setFontSize(size).setY(size === 24 ? 50 : 55);
    this.small.sub.setText(sub);
    this.small.bg.setVisible(title !== '');
  }

  private countdownBanner(st: AfbState) {
    const secs = this.cd.seconds;
    const showIntro = st.first && secs > 3;
    this.intro.setVisible(showIntro);
    if (showIntro) {
      this.hideBanner();
      return;
    }
    this.hideBanner();
    // Anstoß: Zahl frei über dem Mittelkreis, Text in der Anzeigetafel – keine Tafel über dem Feld
    const n = Math.max(1, secs);
    if (st.overtime && secs > 3) {
      this.kick.setText('GOLDEN GOAL').setFontSize(16);
      this.clock.setText('Nächstes Tor gewinnt!');
    } else {
      this.kick.setText(String(n)).setFontSize(24);
      this.clock.setText(st.overtime ? `GOLDEN GOAL · ${n}` : `ANSTOSS IN ${n}`);
    }
  }

  private buildIntro() {
    if (this.intro.length) return;
    this.intro.add(panel(this, 50, 64, 380, 140, 'dark'));
    this.intro.add(txt(this, WORLD.W / 2, 74, 'AUTO-FUSSBALL', { size: 16, color: GOLD }));
    const lines = [
      'Schiebt den Wasserball ins Tor des',
      'anderen Teams!',
      '',
      'SONNE spielt nach rechts ->',
      '<- MEER spielt nach links',
      '',
      'Handy quer: Stick = Richtung wie hier,',
      'dazu GAS, BREMSE und BOOST',
      '3 Minuten – bei Gleichstand Golden Goal',
    ];
    lines.forEach((l, i) => {
      const color = l.startsWith('SONNE') ? TEAM_INFO.A.color : l.startsWith('<-') ? TEAM_INFO.B.color : LIGHT;
      this.intro.add(txt(this, WORLD.W / 2, 98 + i * 11, l, { color }));
    });
  }

  private confetti(x: number, y: number, team: Team) {
    const cols = [hexNum(TEAM_INFO[team].color), 0xffd25e, 0xfdf7ea, hexNum(TEAM_INFO[team].color), 0xe04a3f];
    for (let i = 0; i < 46; i++) {
      const r = this.add.rectangle(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 30, 3, 3, cols[i % cols.length]).setDepth(1500);
      this.tweens.add({
        targets: r,
        x: r.x + (Math.random() - 0.5) * 220,
        y: r.y + (Math.random() - 0.6) * 160,
        angle: Math.random() * 360,
        alpha: 0,
        duration: 1300 + Math.random() * 700,
        ease: 'Quad.Out',
        onComplete: () => r.destroy(),
      });
    }
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'autoball') return;
    const st = s.mini.state;
    this.latest = st;
    this.build(st);
    this.buildIntro();
    this.buf.push(st.t, st);
    if (st.round !== this.lastRound) {
      this.lastRound = st.round;
      // Neuer Anstoß: eine laufende Wiederholung abbrechen
      if (this.buf.replaying) this.buf.live();
    }
    // Ballkontakt: kleiner Staub-Ring am Ball + Plopp; Boost mit Ton – erst, wenn die Wiedergabe-Uhr den Stand zeigt
    for (const [id, car] of Object.entries(st.cars)) {
      const v = this.cars.get(id);
      const fx = this.carFx.get(id) ?? { bo: false };
      if (v && st.sub === 'play' && car.bo && !fx.bo) sfx('powerup', { x: car.x, vol: 0.45, pitch: 1.4 });
      this.carFx.set(id, { bo: !!car.bo });
      if (v && car.k !== v.touches) {
        v.touches = car.k;
        const ball = { ...st.ball };
        const play = st.sub === 'play';
        this.buf.after(st.t, () => {
          if (play) {
            const sp = Math.hypot(ball.vx, ball.vy);
            sfx(sp > 200 ? 'hitHard' : 'bonk', { x: ball.x, vol: 0.6, pitch: 0.9 + Math.min(0.5, sp / 600) });
            this.juice.burst(ball.x, ball.y + 4, 'sand', sp > 200 ? 10 : 5);
            if (sp > 260) this.juice.shake(1);
          }
          const ring = this.add.circle(ball.x, ball.y, AFB.BALL_R + 2).setStrokeStyle(1, 0xfdf7ea, 0.9).setDepth(1400);
          this.tweens.add({ targets: ring, scale: 1.8, alpha: 0, duration: 260, onComplete: () => ring.destroy() });
        });
      }
    }

    const scoreKey = `${st.score.A}:${st.score.B}`;
    if (scoreKey !== this.scoreKey) {
      const changed = this.scoreKey !== '';
      this.scoreKey = scoreKey;
      this.score.setText(`${st.score.A}:${st.score.B}`);
      if (changed) this.tweens.add({ targets: this.score, scale: 1.6, duration: 160, yoyo: true, ease: 'Quad.Out' });
    }
    if (st.sub === 'play') this.clockCd.set(st.endsIn);
    else this.clock.setText(`${st.overtime ? 'GOLDEN GOAL ' : ''}${fmtClock(st.clock)}`);

    // Tor!
    const g = st.lastGoal;
    if (g && g.seq !== this.lastGoal) {
      this.lastGoal = g.seq;
      const name = g.scorer ? (playerById(g.scorer)?.name ?? '?') : '';
      const sub = g.own ? `Eigentor von ${name} – Punkt für ${TEAM_INFO[g.team].name}` : name ? `${name} trifft für ${TEAM_INFO[g.team].name}!` : `Punkt für ${TEAM_INFO[g.team].name}!`;
      const gx = g.team === 'A' ? AFB.X1 + 6 : AFB.X0 - 6;
      const goalT = st.t;
      // Sobald die Wiedergabe-Uhr den Torschuss zeigt: Blitz, dann 2 s Wiederholung des letzten Moments in
      // Zeitlupe (aus dem 8-s-Puffer, der Server pausiert dafür nicht), danach das große Banner mit dem Schützen
      this.buf.after(goalT, () => {
        this.confetti(gx, AFB_CY, g.team);
        sfx('goal', { x: gx });
        sfx(g.own ? 'lose' : 'cheer', { x: gx, delay: 0.25 });
        this.juice.flash(0xffffff, 140);
        this.juice.shake(2);
        this.showSmall(g.own ? 'EIGENTOR!' : 'TOR!', '◀◀ Wiederholung', g.own ? '#ff8a7a' : GOLD, 16);
        this.juice.slowMo(0.3, REPLAY_MS);
        this.buf.replay(goalT - REPLAY_BACK_MS, goalT + REPLAY_AHEAD_MS, (REPLAY_BACK_MS + REPLAY_AHEAD_MS) / REPLAY_MS);
        const cam = this.cameras.main;
        cam.pan(Phaser.Math.Linear(WORLD.W / 2, gx, 0.6), AFB_CY, 250, 'Quad.easeOut');
        cam.zoomTo(1.35, 250, 'Quad.easeOut');
        window.setTimeout(() => {
          if (!this.sys.isActive() || this.lastGoal !== g.seq) return;
          cam.pan(WORLD.W / 2, WORLD.H / 2, 300, 'Quad.easeInOut');
          cam.zoomTo(1, 300, 'Quad.easeInOut');
          this.showBanner(g.own ? 'EIGENTOR!' : 'TOR!', sub, g.own ? '#ff8a7a' : GOLD);
          this.confetti(WORLD.W / 2, 110, g.team);
        }, REPLAY_MS);
      });
    }

    if (st.sub === 'countdown') {
      this.cd.set(st.endsIn);
      this.countdownBanner(st);
    } else {
      this.intro.setVisible(false);
      if (this.lastSub === 'countdown') this.kick.setText('');
      if (st.sub === 'play' && this.lastSub === 'countdown') {
        this.hideBanner();
        this.kick.setText('LOS!').setFontSize(24).setColor('#b9e39a');
        this.time.delayedCall(700, () => this.kick.setText('').setColor(GOLD));
        this.bannerUntil = this.time.now + 700;
      } else if (st.sub === 'play' && this.lastSub !== 'play' && !this.bannerUntil) this.hideBanner();
      if (st.sub === 'over' && this.lastSub !== 'over') {
        if (st.winner) {
          this.showBanner('ABPFIFF!', `${TEAM_INFO[st.winner].name} gewinnt ${st.score[st.winner]}:${st.score[st.winner === 'A' ? 'B' : 'A']}!`);
          this.confetti(WORLD.W / 2, 120, st.winner);
          sfx('whistle');
          sfx('fanfare', { delay: 0.4 });

        } else this.showBanner('ABPFIFF!', `Unentschieden ${st.score.A}:${st.score.B}`);
      }
    }
    this.lastSub = st.sub;
  }
}
