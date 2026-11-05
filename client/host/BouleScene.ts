import Phaser from 'phaser';
import type { BouleState, BouleTrack, GameState, Point } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { BOULE, bouleDist } from '../../shared/boule';
import { bouleBall, cochonnet, paintBoulePitch } from '../art/boule';
import { crown } from '../art/objects';
import { bus, getState, playerById } from './store';
import { ensureAvatar, ensurePortrait } from './textures';
import { GOLD, LIGHT, RED_INK, background, ensureTex, fitText, ink, panel, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { cloudShadows, crowd, daylight, gulls } from './ambient';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const MAX_BALLS = 16;

interface Playback {
  seq: number;
  track: BouleTrack;
  t0: number;
  landed: boolean;
  hitIdx: number;
}

/**
 * Boule am Strand (TV): Bouleplatz von oben, Sonnenuntergang am Horizont.
 * Spielt die vom Server simulierten Würfe ab (Bogen mit Schatten, Sandwolke, Rollen) und misst am Ende jeder Aufnahme.
 */
export class BouleScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private balls: Phaser.GameObjects.Image[] = [];
  private jack!: Phaser.GameObjects.Image;
  private flyShadow!: Phaser.GameObjects.Ellipse;
  private thrower!: Phaser.GameObjects.Image;
  private styleTxt!: Phaser.GameObjects.Text;
  private hud!: Phaser.GameObjects.Container;
  private board!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private bannerSub!: Phaser.GameObjects.Text;
  private intro!: Phaser.GameObjects.Container;
  private latest: GameState | null = null;
  private play: Playback | null = null;
  private lastSeq = 0;
  private juice!: Juice;
  private fans: ReturnType<typeof crowd> | null = null;
  private hudKey = '';
  private boardKey = '';
  private placeT0 = 0;
  private placeEnd = -1;
  private measureT0 = 0;
  private measureEnd = -1;
  private measureShown = 0;
  private overShown = false;

  constructor() {
    super('boule');
  }

  create() {
    this.balls = [];
    this.play = null;
    this.lastSeq = 0;
    this.hudKey = '';
    this.boardKey = '';
    this.placeEnd = -1;
    this.measureEnd = -1;
    this.measureShown = 0;
    this.overShown = false;

    background(this, 'boule', WORLD.W, WORLD.H, (p) => paintBoulePitch(p, WORLD.W, WORLD.H));
    daylight(this, { depth: -950 });
    this.juice = new Juice(this, { depth: 1450 });
    // Leerer Sandplatz: Möwen, Wolkenschatten und Zuschauer am Rand
    gulls(this, { n: 3, y: [30, 120], depth: 1700 });
    cloudShadows(this, { n: 3, y: [40, 250], depth: 3, alpha: 0.06 });
    this.fans = crowd(this, [[16, 268], [32, 266], [448, 268], [464, 266], [456, 60]], { depth: 5 });
    this.g = this.add.graphics().setDepth(1);
    this.thrower = this.add.image(BOULE.CIRCLE.x, BOULE.CIRCLE.y + 2, ensureTex(this, 'boule_dummy', () => document.createElement('canvas'))).setOrigin(0.5, 1).setDepth(BOULE.CIRCLE.y + 2);
    this.styleTxt = txt(this, BOULE.CIRCLE.x + 4, BOULE.CIRCLE.y + 12, '', { origin: [0, 0] }).setDepth(900);
    for (let i = 0; i < MAX_BALLS; i++) this.balls.push(this.add.image(0, 0, ensureTex(this, 'boule_ball_888888', () => bouleBall('#888888'))).setVisible(false));
    this.jack = this.add.image(0, 0, ensureTex(this, 'boule_jack', cochonnet)).setVisible(false);
    this.flyShadow = this.add.ellipse(0, 0, 9, 4, 0x2d1b12, 0.3).setVisible(false).setDepth(2);

    this.hud = this.add.container(0, 0).setDepth(2000);
    this.board = this.add.container(0, 0).setDepth(2000);
    this.banner = txt(this, 240, 118, '', { size: 24, color: GOLD }).setOrigin(0.5).setDepth(2010);
    this.bannerSub = txt(this, 240, 142, '', { size: 8, color: LIGHT }).setDepth(2010);
    this.intro = this.add.container(0, 0).setDepth(2005);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private get st(): BouleState | null {
    return this.latest?.mini?.kind === 'boule' ? this.latest.mini.state : null;
  }

  private onState(s: GameState) {
    this.latest = s;
    const st = this.st;
    if (!st) return;
    if (st.sub === 'roll' && st.last?.track && st.last.seq !== this.lastSeq) {
      this.lastSeq = st.last.seq;
      this.play = { seq: st.last.seq, track: st.last.track, t0: this.time.now, landed: false, hitIdx: 0 };
      this.hideBanner();
      sfx(st.last.shoot ? 'throw' : 'whoosh', { x: st.last.track.from.x, pitch: st.last.shoot ? 0.9 : 0.6, vol: 0.6 });
      if (st.last.shoot) this.showBanner('SCHUSS!', playerById(st.last.playerId)?.name ?? '', '#ff9a7a', true);
    }
    if (st.sub === 'aim' || st.sub === 'place') this.play = null;
    if (st.sub === 'place' && this.placeEnd !== st.end) {
      this.placeEnd = st.end;
      this.placeT0 = this.time.now;
      this.showBanner(`AUFNAHME ${st.end}`, st.end === st.maxEnds ? 'Letzte Aufnahme!' : `Bis ${st.target} Punkte · max. ${st.maxEnds} Aufnahmen`, GOLD);
    }
    if (st.sub === 'aim' && this.banner.text.startsWith('AUFNAHME')) this.hideBanner();
    if (st.sub === 'measure' && this.measureEnd !== st.end) {
      this.measureEnd = st.end;
      this.measureT0 = this.time.now;
      this.measureShown = 0;
      this.hideBanner();
    }
    if (st.sub === 'over' && !this.overShown) {
      this.overShown = true;
      const best = [...st.sides].sort((a, b) => b.score - a.score);
      const tie = best.length > 1 && best[0].score === best[1].score;
      this.showBanner('ENDSTAND', tie ? 'Unentschieden!' : `${best[0].name} gewinnt!`, GOLD);
      sfx('fanfare');
      this.fans?.cheer();
      this.juice.burst(240, 110, 'confetti', 50);
    }
    this.renderIntro(st);
    this.renderHud(st);
    this.renderBoard(st);
  }

  // ---------------------------------------------------------------- Zeichnen

  update(time: number) {
    const st = this.st;
    if (!st) return;
    const g = this.g;
    g.clear();

    // Werfer am Kreis
    const thrower = st.sub === 'aim' ? st.turn : st.sub === 'roll' ? st.last?.playerId : null;
    const pl = playerById(thrower);
    this.thrower.setVisible(!!pl);
    if (pl) this.thrower.setTexture(ensureAvatar(this, pl.look));
    this.styleTxt.setVisible(st.sub === 'aim').setText(st.aimShoot ? 'SCHIESSEN' : 'LEGEN').setColor(st.aimShoot ? '#ff9a7a' : LIGHT);

    // Positionen bestimmen
    let jackPos: Point | null = st.jack;
    let ballPos: (Point | null)[] = st.balls.map((b) => b);
    let flying: { x: number; y: number; h: number } | null = null;

    if (st.sub === 'place' && st.jack) {
      const u = Math.min(1, (time - this.placeT0) / (BOULE.PLACE_MS * 0.65));
      if (u < 1) {
        jackPos = null;
        const x = BOULE.CIRCLE.x + (st.jack.x - BOULE.CIRCLE.x) * u;
        const y = BOULE.CIRCLE.y + (st.jack.y - BOULE.CIRCLE.y) * u;
        const h = 4 * 50 * u * (1 - u);
        this.jack.setVisible(true).setPosition(x, y - h).setScale(1 + h / 60).setDepth(1500);
        this.flyShadow.setVisible(true).setPosition(x, y + 1).setSize(6, 3);
      }
    }

    const pb = this.play;
    if (pb && st.sub === 'roll') {
      const tr = pb.track;
      const t = time - pb.t0;
      const n = tr.paths.length;
      const at = (i: number, f: number): Point => {
        const arr = tr.paths[i];
        if (arr.length <= 2) return { x: arr[0], y: arr[1] };
        const m = arr.length / 2;
        const a = Math.min(m - 1, Math.floor(f));
        const b = Math.min(m - 1, a + 1);
        const k = f - a;
        return { x: arr[a * 2] + (arr[b * 2] - arr[a * 2]) * k, y: arr[a * 2 + 1] + (arr[b * 2 + 1] - arr[a * 2 + 1]) * k };
      };
      if (t < tr.flightMs) {
        const u = t / tr.flightMs;
        flying = { x: tr.from.x + (tr.land.x - tr.from.x) * u, y: tr.from.y + (tr.land.y - tr.from.y) * u, h: 4 * tr.arc * u * (1 - u) };
        jackPos = at(0, 0);
        ballPos = Array.from({ length: n - 1 }, (_, i) => (i === n - 2 ? null : at(i + 1, 0)));
      } else {
        if (!pb.landed) {
          pb.landed = true;
          this.puff(tr.land.x, tr.land.y, st.last?.shoot ? 10 : 7);
          this.juice.burst(tr.land.x, tr.land.y, 'sand', st.last?.shoot ? 12 : 6);
          sfx('bonk', { x: tr.land.x, pitch: 0.55, vol: 0.6 });
        }
        const f = Math.min(tr.frames - 1, (t - tr.flightMs) / 1000 / tr.dt);
        jackPos = at(0, f);
        ballPos = Array.from({ length: n - 1 }, (_, i) => at(i + 1, f));
        while (pb.hitIdx < tr.hits.length && tr.hits[pb.hitIdx] <= f) {
          const p = ballPos[ballPos.length - 1]!;
          this.spark(p.x, p.y);
          // Kugel trifft Kugel: metallisches Klacken + kurzer Stopp
          sfx('crack', { x: p.x, pitch: 1.6, vol: 0.7 });
          this.juice.burst(p.x, p.y, 'spark', 8);
          this.juice.hitStop(50);
          if (st.last?.shoot) this.juice.shake(1);
          pb.hitIdx++;
        }
      }
    }

    // Kugeln
    for (let i = 0; i < MAX_BALLS; i++) {
      const img = this.balls[i];
      const b = st.balls[i];
      let p = ballPos[i] ?? null;
      const isFlying = !!flying && !!b && i === st.balls.length - 1;
      if (isFlying) p = { x: flying!.x, y: flying!.y - flying!.h };
      img.setVisible(!!b && !!p);
      if (!b || !p) continue;
      const col = hex(st.sides.find((s) => s.id === b.side)?.color ?? 0x888888);
      img.setTexture(ensureTex(this, `boule_ball_${col}`, () => bouleBall(col)));
      img.setPosition(p.x, p.y).setScale(isFlying ? 1 + flying!.h / 70 : 1).setDepth(isFlying ? 1500 : 10 + p.y);
      if (!isFlying) g.fillStyle(0x2d1b12, 0.22).fillEllipse(p.x + 1, p.y + 3, 9, 3);
    }
    if (flying) this.flyShadow.setVisible(true).setPosition(flying.x, flying.y + 2).setSize(9 - flying.h / 20, 4);
    else if (!(st.sub === 'place' && !jackPos)) this.flyShadow.setVisible(false);

    // Schweinchen
    if (jackPos) {
      this.jack.setVisible(true).setPosition(jackPos.x, jackPos.y).setScale(1).setDepth(10 + jackPos.y);
    } else if (st.sub !== 'place') this.jack.setVisible(false);

    // Wer liegt? Ring um die näheste Kugel
    if (st.sub === 'aim' && st.jack && st.leader) {
      let best = -1;
      let bd = Infinity;
      st.balls.forEach((b, i) => {
        const d = bouleDist(b, st.jack!);
        if (d < bd) (bd = d), (best = i);
      });
      if (best >= 0) {
        const b = st.balls[best];
        const col = st.sides.find((s) => s.id === b.side)?.color ?? 0xffffff;
        const pulse = 7 + Math.sin(time / 180) * 1.2;
        g.lineStyle(1, 0xfff4d6, 0.9).strokeCircle(b.x, b.y, pulse + 1);
        g.lineStyle(1, col, 1).strokeCircle(b.x, b.y, pulse);
      }
    }

    if (st.sub === 'measure') this.drawMeasure(st, time);
  }

  private drawMeasure(st: BouleState, time: number) {
    const r = st.endResult;
    const jack = st.jack;
    if (!r || !jack) return;
    const g = this.g;
    const t = time - this.measureT0;
    if (!r.side) {
      if (this.measureShown === 0 && t > 500) {
        this.measureShown = 1;
        this.showBanner('GLEICHSTAND', 'Keiner punktet in dieser Aufnahme', LIGHT);
        sfx('lose', { vol: 0.5 });
      }
      return;
    }
    // Messkreis: alle eigenen Kugeln darin zählen
    if (r.radius < 400) this.dashedCircle(jack.x, jack.y, r.radius, 0xfff4d6, Math.min(1, t / 500));
    const step = BOULE.MEASURE_STEP_MS;
    const shown = Math.max(0, Math.min(r.counting.length, Math.floor((t - 500) / step) + 1));
    const side = st.sides.find((s) => s.id === r.side)!;
    for (let k = 0; k < shown; k++) {
      const b = st.balls[r.counting[k]];
      if (!b) continue;
      this.dottedLine(jack.x, jack.y, b.x, b.y, side.color);
      g.lineStyle(1, side.color, 1).strokeCircle(b.x, b.y, 7);
    }
    if (shown > this.measureShown) {
      this.measureShown = shown;
      const last = shown === r.counting.length;
      this.showBanner(`${shown} ${shown === 1 ? 'PUNKT' : 'PUNKTE'}!`, last ? `für ${side.name}` : '', hex(side.color));
      // Messung: Tick pro gezählter Kugel, am Ende Münze + Jubel
      sfx('tick', { pitch: 1 + shown * 0.12 });
      if (last) {
        sfx('coin', { delay: 0.1 });
        this.fans?.cheer();
      }

    }
  }

  private dottedLine(x1: number, y1: number, x2: number, y2: number, color: number) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    for (let d = 0; d < len; d += 3) {
      const x = x1 + ((x2 - x1) * d) / len;
      const y = y1 + ((y2 - y1) * d) / len;
      this.g.fillStyle(0x2d1b12, 1).fillRect(Math.round(x), Math.round(y) + 1, 2, 2);
      this.g.fillStyle(color, 1).fillRect(Math.round(x), Math.round(y), 2, 2);
    }
  }

  private dashedCircle(cx: number, cy: number, r: number, color: number, alpha: number) {
    const n = Math.max(24, Math.round((r * Math.PI * 2) / 2));
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      if (i % 3 === 2) continue;
      const a = (i / n) * Math.PI * 2;
      pts.push([Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)]);
    }
    // erst alle Schatten, dann die hellen Punkte (sonst überdecken sich die Striche)
    this.g.fillStyle(0x2d1b12, alpha * 0.5);
    for (const [x, y] of pts) this.g.fillRect(x, y + 1, 2, 2);
    this.g.fillStyle(color, alpha);
    for (const [x, y] of pts) this.g.fillRect(x, y, 2, 2);
  }

  private puff(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const c = this.add.circle(x, y + 1, 1.5 + Math.random() * 1.5, i % 2 ? 0xfbe7bd : 0xdfb878).setDepth(1400);
      const a = Math.random() * Math.PI * 2;
      this.tweens.add({ targets: c, x: x + Math.cos(a) * (6 + Math.random() * 8), y: y + Math.sin(a) * 4 - 3, alpha: 0, duration: 450 + Math.random() * 250, ease: 'Quad.Out', onComplete: () => c.destroy() });
    }
  }

  private spark(x: number, y: number) {
    const s = txt(this, x, y - 12, 'KLACK', { color: '#fff4d6' }).setDepth(1600).setScale(0.6);
    this.tweens.add({ targets: s, y: y - 22, alpha: 0, duration: 600, onComplete: () => s.destroy() });
    for (let i = 0; i < 5; i++) {
      const c = this.add.rectangle(x, y, 2, 2, 0xffffff).setDepth(1600);
      this.tweens.add({ targets: c, x: x + (Math.random() - 0.5) * 18, y: y + (Math.random() - 0.5) * 14, alpha: 0, duration: 300, onComplete: () => c.destroy() });
    }
  }

  // ---------------------------------------------------------------- Banner

  private showBanner(text: string, sub: string, color: string, small = false) {
    // Banner nicht über das Schweinchen legen: liegt es oben, kommt der Text in die untere Feldhälfte
    const jack = this.st?.jack;
    const y = jack && jack.y < BOULE.CIRCLE.y ? 205 : 108;
    this.banner.setY(y);
    this.bannerSub.setY(y + 24);
    this.banner.setText(text).setColor(color).setAlpha(1);
    const base = small || text.length > 11 ? 0.67 : 1;
    this.bannerSub.setText(sub).setAlpha(1);
    this.banner.setScale(base * 0.3);
    this.tweens.add({ targets: this.banner, scale: base, duration: 380, ease: 'Back.Out' });
    if (small) this.tweens.add({ targets: [this.banner, this.bannerSub], alpha: 0, delay: 900, duration: 300 });
  }

  private hideBanner() {
    this.tweens.killTweensOf([this.banner, this.bannerSub]);
    this.banner.setText('');
    this.bannerSub.setText('');
  }

  // ---------------------------------------------------------------- HUD + Punkte

  private renderIntro(st: BouleState) {
    const want = st.sub === 'intro';
    if (want === this.intro.visible && this.intro.length) return;
    this.intro.removeAll(true).setVisible(want);
    if (!want) return;
    this.intro.add(panel(this, 80, 80, 320, 112));
    this.intro.add(ink(this, 240, 92, 'BOULE AM STRAND', { size: 16, color: RED_INK }));
    const mode = st.teams ? 'Team Sonne gegen Team Meer' : 'Jeder gegen jeden';
    this.intro.add(
      ink(this, 240, 118, `${mode}.\nKugeln ans Schweinchen legen!\nWer NICHT vorn liegt, wirft.\nLegen = Bogen · Schießen = hart\nBis ${st.target} Punkte, max. ${st.maxEnds} Aufnahmen.`),
    );
  }

  private renderHud(st: BouleState) {
    const who = st.sub === 'roll' && st.last ? st.last.playerId : st.sub === 'aim' ? st.turn : null;
    const key = JSON.stringify([st.sub, who, st.end, who ? st.left[who] : 0]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    if (st.sub === 'intro' || st.sub === 'over') return;
    this.hud.add(panel(this, 3, 3, 170, 32));
    const p = playerById(who);
    if (p && who) {
      this.hud.add(this.add.image(17, 27, ensurePortrait(this, p.look)).setOrigin(0.5, 1));
      const side = st.sides.find((s) => s.members.includes(who));
      if (side) this.hud.add(this.add.circle(27, 12, 3, side.color).setStrokeStyle(1, 0x2d1b12));
      this.hud.add(fitText(ink(this, 33, 9, tagName(p.name), { origin: [0, 0], color: RED_INK }), 13 * 8));
      const n = st.left[who] ?? 0;
      const status = st.sub === 'aim' ? `Aufn. ${st.end}/${st.maxEnds} · noch ${n} Kug.` : st.last?.shoot ? 'schießt …' : 'legt …';
      this.hud.add(ink(this, 33, 21, status, { origin: [0, 0] }));
    } else {
      this.hud.add(ink(this, 88, 9, `AUFNAHME ${st.end}/${st.maxEnds}`, { color: RED_INK }));
      this.hud.add(ink(this, 88, 21, st.sub === 'measure' ? 'Es wird gemessen …' : 'Schweinchen fliegt …'));
    }
  }

  private renderBoard(st: BouleState) {
    const left = (ids: string[]) => ids.reduce((a, id) => a + (st.left[id] ?? 0), 0);
    const key = JSON.stringify([st.sides.map((s) => [s.score, left(s.members)]), st.sub === 'over', st.sub === 'intro']);
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.removeAll(true);
    if (st.sub === 'intro') return;
    const rows = st.sub === 'over' ? [...st.sides].sort((a, b) => b.score - a.score) : st.sides;
    const w = 150;
    const x0 = WORLD.W - w - 3;
    const rowH = 11;
    const h = 8 + rows.length * rowH;
    this.board.add(panel(this, x0, 3, w, Math.max(24, h)));
    rows.forEach((s, i) => {
      const y = 9 + i * rowH + rowH / 2 - 1;
      this.board.add(this.add.circle(x0 + 10, y, 3.5, s.color).setStrokeStyle(1, 0x2d1b12));
      const name = st.teams ? s.name.replace(/^Team\s+/, '') : s.name.replace(/^Bot\s+/, '');
      this.board.add(ink(this, x0 + 17, y, name.slice(0, 8), { origin: [0, 0.5] }));
      const n = left(s.members);
      for (let k = 0; k < n; k++) this.board.add(this.add.circle(x0 + w - 26 - k * 6, y, 2, s.color).setStrokeStyle(1, 0x2d1b12));
      this.board.add(ink(this, x0 + w - 6, y, String(s.score), { origin: [1, 0.5], color: RED_INK }));
      if (st.sub === 'over' && i === 0) this.board.add(this.add.image(x0 + 10, y - 3, ensureTex(this, 'crown', crown)).setOrigin(0.5, 1));
    });
  }
}
