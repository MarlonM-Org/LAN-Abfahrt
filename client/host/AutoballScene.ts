import Phaser from 'phaser';
import type { GameState, Team } from '../../shared/types';
import { WORLD, TEAM_INFO } from '../../shared/flunky';
import { AFB, AFB_CY, type AfbState } from '../../shared/autoball';
import { wrapAngle } from '../../shared/kart';
import { ballShine, beachBall, paintAutoballPitch } from '../art/autoball';
import { kartSprite } from '../art/kartsprites';
import { bus, getState, playerById } from './store';
import { ensurePortrait } from './textures';
import { Countdown, GOLD, LIGHT, background, ensureTex, panel, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';

interface CarView {
  root: Phaser.GameObjects.Container;
  lift: Phaser.GameObjects.Container;
  shadow: Phaser.GameObjects.Ellipse;
  body: Phaser.GameObjects.Image;
  x: number;
  y: number;
  a: number;
  hopStart: number;
  lastPuff: number;
  touches: number;
}

const hexNum = (h: string) => parseInt(h.slice(1), 16);
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
  private ballSnap = { x: 0, y: 0, vx: 0, vy: 0, at: 0 };
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
  /** Tor-Wiederholung light: bis dahin Zeitlupe + Zoom */
  private replayUntil = 0;
  private carFx = new Map<string, { bo: boolean; hop: boolean }>();
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
    this.replayUntil = 0;
    this.carFx.clear();
    this.ballSnap = { x: 0, y: 0, vx: 0, vy: 0, at: 0 };
    this.juice = new Juice(this, { depth: 1500 });

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
    this.small = {
      bg: panel(this, 140, 46, 200, 46, 'dark').setDepth(2000).setVisible(false),
      title: txt(this, WORLD.W / 2, 50, '', { size: 24, color: GOLD }).setDepth(2001),
      sub: txt(this, WORLD.W / 2, 78, '', { size: 8 }).setDepth(2001),
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
    const shadow = this.add.ellipse(1, 3, 15, 8, 0x000000, 0.25);
    const body = this.add.image(0, 0, ensureTex(this, `afb_kart_${car.t}`, () => kartSprite(color)));
    const head = this.add.image(0, -3, ensurePortrait(this, pl.look)).setScale(0.62).setOrigin(0.5, 0.6);
    const lift = this.add.container(0, 0, [body, head]);
    const root = this.add.container(car.x, car.y, [shadow, lift]);
    const v: CarView = { root, lift, shadow, body, x: car.x, y: car.y, a: car.a, hopStart: 0, lastPuff: 0, touches: car.k };
    this.cars.set(id, v);
    return v;
  }

  // ---------------------------------------------------------------- Frame

  update(_t: number, dms: number) {
    const st = this.latest;
    if (!st) return;
    const now = this.time.now;
    const live = st.sub === 'play' || st.sub === 'goal';
    for (const [id, car] of Object.entries(st.cars)) {
      const v = this.carView(id, st);
      if (!v) continue;
      // Tor-Wiederholung: Figuren laufen in Zeitlupe nach
      const slow = now < this.replayUntil ? 0.3 : 1;
      const k = st.sub === 'countdown' ? 1 : 0.45 * slow;
      v.x += (car.x - v.x) * k;
      v.y += (car.y - v.y) * k;
      v.a += wrapAngle(car.a - v.a) * k;
      v.body.setRotation(v.a + (car.d ? car.d * 0.35 : 0));
      // Hüpfer: lokal animiert (Start aus dem Rest-Wert)
      if (car.hop > 0 && !v.hopStart) v.hopStart = now - (AFB.HOP_MS - car.hop);
      let lift = 0;
      if (v.hopStart) {
        const t = (now - v.hopStart) / AFB.HOP_MS;
        if (t >= 1) v.hopStart = 0;
        else lift = Math.sin(Math.PI * t) * 7;
      }
      v.lift.setY(-lift).setScale(1 + lift * 0.035);
      v.shadow.setScale(1 - lift * 0.05);
      v.root.setPosition(Math.round(v.x), Math.round(v.y)).setDepth(10 + v.y + (lift ? 40 : 0));
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
    // Ball: letzten Stand mit seiner Geschwindigkeit fortschreiben, weich nachziehen
    const b = this.ball;
    const el = Math.min(0.08, (performance.now() - this.ballSnap.at) / 1000);
    const tx = this.ballSnap.x + this.ballSnap.vx * el;
    const ty = this.ballSnap.y + this.ballSnap.vy * el;
    const k = st.sub === 'countdown' ? 1 : now < this.replayUntil ? 0.12 : 0.5;
    const ox = b.x;
    const oy = b.y;
    b.x += (tx - b.x) * k;
    b.y += (ty - b.y) * k;
    const moved = Math.hypot(b.x - ox, b.y - oy);
    b.rot += (moved / AFB.BALL_R) * (b.x >= ox ? 1 : -1);
    b.spin.setRotation(b.rot);
    b.root.setPosition(Math.round(b.x), Math.round(b.y)).setDepth(10 + b.y);
    if (st.sub === 'play' && moved * (1000 / Math.max(1, dms)) > 150 && Math.random() < 0.35) this.puff(b.x, b.y + 5, 0xe8d3a8, 2, 260);

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
    this.intro.add(panel(this, 50, 64, 380, 128, 'dark'));
    this.intro.add(txt(this, WORLD.W / 2, 74, 'AUTO-FUSSBALL', { size: 16, color: GOLD }));
    const lines = [
      'Schiebt den Wasserball ins Tor des',
      'anderen Teams!',
      '',
      'SONNE spielt nach rechts ->',
      '<- MEER spielt nach links',
      '',
      'Handy quer: GAS, BREMSE, BOOST, HÜPFER',
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
    this.ballSnap = { ...st.ball, at: performance.now() };

    // Neuer Anstoß: alles sofort an die Startpositionen
    if (st.round !== this.lastRound) {
      this.lastRound = st.round;
      this.ball.x = st.ball.x;
      this.ball.y = st.ball.y;
      for (const [id, car] of Object.entries(st.cars)) {
        const v = this.carView(id, st);
        if (v) Object.assign(v, { x: car.x, y: car.y, a: car.a });
      }
    }
    // Ballkontakt: kleiner Staub-Ring am Ball + Plopp; Boost und Hüpfer mit Ton
    for (const [id, car] of Object.entries(st.cars)) {
      const v = this.cars.get(id);
      const fx = this.carFx.get(id) ?? { bo: false, hop: false };
      if (v && st.sub === 'play') {
        if (car.bo && !fx.bo) sfx('powerup', { x: car.x, vol: 0.45, pitch: 1.4 });
        if (car.hop > 0 && !fx.hop) sfx('jump', { x: car.x, vol: 0.6 });
      }
      this.carFx.set(id, { bo: !!car.bo, hop: car.hop > 0 });
      if (v && car.k !== v.touches) {
        v.touches = car.k;
        if (st.sub === 'play') {
          const sp = Math.hypot(st.ball.vx, st.ball.vy);
          sfx(sp > 200 ? 'hitHard' : 'bonk', { x: st.ball.x, vol: 0.6, pitch: 0.9 + Math.min(0.5, sp / 600) });
          this.juice.burst(st.ball.x, st.ball.y + 4, 'sand', sp > 200 ? 10 : 5);
          if (sp > 260) this.juice.shake(1);
        }
        const ring = this.add.circle(st.ball.x, st.ball.y, AFB.BALL_R + 2).setStrokeStyle(1, 0xfdf7ea, 0.9).setDepth(1400);
        this.tweens.add({ targets: ring, scale: 1.8, alpha: 0, duration: 260, onComplete: () => ring.destroy() });
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
      this.confetti(gx, AFB_CY, g.team);
      sfx('goal', { x: gx });
      sfx(g.own ? 'lose' : 'cheer', { x: gx, delay: 0.25 });
      this.juice.flash(0xffffff, 140);
      this.juice.shake(2);
      // Tor-Wiederholung light: 1 s Zeitlupe + Zoom aufs Tor, danach das große Banner
      this.replayUntil = this.time.now + 1000;
      this.juice.slowMo(0.3, 1000);
      const cam = this.cameras.main;
      cam.pan(Phaser.Math.Linear(WORLD.W / 2, gx, 0.6), AFB_CY, 250, 'Quad.easeOut');
      cam.zoomTo(1.35, 250, 'Quad.easeOut');
      window.setTimeout(() => {
        if (!this.sys.isActive()) return;
        cam.pan(WORLD.W / 2, WORLD.H / 2, 300, 'Quad.easeInOut');
        cam.zoomTo(1, 300, 'Quad.easeInOut');
        this.showBanner(g.own ? 'EIGENTOR!' : 'TOR!', sub, g.own ? '#ff8a7a' : GOLD);
        this.confetti(WORLD.W / 2, 110, g.team);
      }, 1000);
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
