import Phaser from 'phaser';
import type { GameState, Team, VolleyState } from '../../shared/types';
import { WORLD, TEAM_INFO } from '../../shared/flunky';
import { VOLLEY as V, type VollBall, vollWon } from '../../shared/volley';
import { paintVolleyBeach, volleyArrow, volleyBall, volleyNet } from '../art/volley';
import { bus, getState, playerById } from './store';
import { avatarSprite, ensurePortrait, playAvatar } from './textures';
import { pcol } from './playerColor';
import { Countdown, background, ensureTex, ink, panel, txt } from './ui';
import { Juice } from './juice';
import { SnapBuffer, lerp, lerpJump } from './interp';
import { sfx } from './sfx';

interface Fig {
  img: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  x: number;
  y: number;
  air: boolean;
  court: boolean;
}

const TEAMS: Team[] = ['A', 'B'];

/** Strand-Volleyball: Seitenansicht am Strand bei Sonnenuntergang */
export class VolleyScene extends Phaser.Scene {
  private figs = new Map<string, Fig>();
  private ball!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private arrow!: Phaser.GameObjects.Image;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private juice!: Juice;
  private sub!: Phaser.GameObjects.Text;
  private latest: VolleyState | null = null;
  /** Wiedergabe-Uhr (60 ms hinter dem Server): Ball und Spieler laufen interpoliert, Hit-Stop beim Schmettern */
  private buf = new SnapBuffer<VolleyState>();
  /** Ball, wie er gerade gezeichnet wird */
  private shown: VollBall = { x: V.NET_X, y: 110, vx: 0, vy: 0 };
  private hudKey = '';
  private phaseKey = '';
  private hitSeq = 0;
  private pointSeq = 0;
  private trailAt = 0;
  private clock = new Countdown();

  constructor() {
    super('volley');
  }

  create() {
    this.figs.clear();
    this.latest = null;
    this.buf = new SnapBuffer();
    this.shown = { x: V.NET_X, y: 110, vx: 0, vy: 0 };
    this.hudKey = '';
    this.phaseKey = '';
    this.hitSeq = 0;
    this.pointSeq = 0;
    this.trailAt = 0;
    this.juice = new Juice(this, { depth: 1700, clock: this.buf });

    background(this, 'volley', WORLD.W, WORLD.H, (p) => paintVolleyBeach(p, WORLD.W, WORLD.H));
    // Wellen am Horizont glitzern
    for (let i = 0; i < 12; i++) {
      const x = 12 + ((i * 89) % 456);
      const y = 154 + ((i * 7) % 20);
      const w = this.add.rectangle(x, y, 5 + (i % 3) * 2, 1, 0xffe7b0, 0.7).setDepth(-900);
      this.tweens.add({ targets: w, x: x + 5, alpha: 0.1, duration: 1300 + (i % 4) * 280, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: i * 140 });
    }
    this.add.image(V.NET_X, V.NET_TOP - 1, ensureTex(this, 'vb_net', volleyNet)).setOrigin(0.5, 0).setDepth(50);
    this.ballShadow = this.add.ellipse(V.NET_X, V.GROUND + 1, 10, 3, 0x000000, 0.25).setDepth(40);
    this.ball = this.add.image(V.NET_X, 110, ensureTex(this, 'vb_ball', volleyBall)).setDepth(300);
    this.arrow = this.add.image(0, 36, ensureTex(this, 'vb_arrow', volleyArrow)).setOrigin(0.5, 0).setDepth(1900).setVisible(false);

    this.hud = this.add.container(0, 0).setDepth(2000);
    this.banner = txt(this, WORLD.W / 2, 84, '', { size: 16, color: '#ffd25e' }).setDepth(2001);
    this.sub = txt(this, WORLD.W / 2, 108, '', { size: 8, wrap: 440 }).setDepth(2001);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  update() {
    const st = this.latest;
    const s = this.buf.sample();
    if (!st || !s) return;
    const now = this.time.now;
    const { a, b, f } = s;

    // Ball: zwischen den zwei Ständen um die Wiedergabe-Uhr interpoliert (bei Aufschlag/Punkt steht er bzw. liegt er)
    this.shown = { x: lerpJump(a.ball.x, b.ball.x, f, 60), y: lerpJump(a.ball.y, b.ball.y, f, 60), vx: b.ball.vx, vy: b.ball.vy };
    const hover = b.sub === 'serve' ? Math.sin(now / 180) * 1.5 : 0;
    this.ball.setPosition(this.shown.x, this.shown.y + hover);
    this.ball.rotation += (b.ball.vx / 600) * (this.game.loop.delta / 16) * this.buf.rate;
    const hgt = V.GROUND - this.shown.y;
    const sh = Math.max(0.35, 1 - hgt / 220);
    this.ballShadow.setPosition(this.shown.x, V.GROUND + 1).setScale(sh).setAlpha(0.3 * sh + 0.05);
    this.arrow.setVisible(this.shown.y < 34).setX(Phaser.Math.Clamp(this.shown.x, 10, 470));
    // Schnelle Bälle ziehen eine Spur
    const speed = Math.hypot(b.ball.vx, b.ball.vy);
    if (b.sub === 'rally' && speed > 300 && now - this.trailAt > 30) {
      this.trailAt = now;
      const d = this.add.circle(this.shown.x, this.shown.y, 4, 0xfff4d6, 0.6).setDepth(290);
      this.tweens.add({ targets: d, scale: 0.2, alpha: 0, duration: 260, onComplete: () => d.destroy() });
    }

    // Spieler
    for (const [id, p] of Object.entries(b.players)) {
      const g = this.figs.get(id);
      if (!g) continue;
      g.img.setVisible(p.court);
      g.shadow.setVisible(p.court);
      if (!p.court) continue;
      const pa = a.players[id] ?? p;
      g.x = g.court ? lerpJump(pa.x, p.x, f, 30) : p.x;
      g.y = g.court ? lerp(pa.y, p.y, f) : p.y;
      g.court = true;
      const running = p.vx !== 0 && !p.air;
      g.img.setPosition(g.x, g.y).setFlipX(p.dir < 0);
      playAvatar(g.img, p.air ? 'jump' : running ? 'walk' : 'idle');
      if (p.spike) g.img.setAngle((p.team === 'A' ? 1 : -1) * 22).setScale(1.12, 0.95);
      else if (p.air) g.img.setAngle(0).setScale(0.94, 1.08);
      else g.img.setAngle(running ? Math.sin(now / 65) * 4 : 0).setScale(1);
      const hgtP = V.GROUND - g.y;
      g.shadow.setPosition(g.x, V.GROUND + 1).setScale(Math.max(0.5, 1 - hgtP / 90));
      // Landung: kleine Sandwolke
      if (g.air && !p.air) this.puff(g.x, V.GROUND, 3);
      g.air = p.air;
    }
    if (st.sub === 'intro') this.banner.setText(String(Math.max(1, this.clock.seconds)));
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'volley') return;
    const st = s.mini.state;
    if (!this.latest) {
      // TV erst mitten im Spiel geöffnet: alte Treffer/Punkte nicht nachspielen
      this.hitSeq = st.hitSeq;
      this.pointSeq = st.pointSeq;
      this.shown = { ...st.ball };
    }
    this.latest = st;
    this.buf.push(st.t, st);

    for (const [id, p] of Object.entries(st.players)) {
      if (this.figs.has(id)) continue;
      const pl = playerById(id);
      if (!pl) continue;
      const color = TEAM_INFO[p.team].colorNum;
      const shadow = this.add.ellipse(p.x, V.GROUND + 1, 16, 5, color, 0.75).setStrokeStyle(1, pcol(id).num, 1).setDepth(45);
      const img = avatarSprite(this, pl.look, p.x, p.y).setDepth(p.team === 'A' ? 120 : 110);
      this.figs.set(id, { img, shadow, x: p.x, y: p.y, air: p.air, court: p.court });
    }

    const key = `${st.sub}-${st.pointSeq}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.clock.set(st.endsIn);
      this.onPhase(st);
    }
    if (st.hitSeq !== this.hitSeq) {
      const fresh = st.hitSeq > this.hitSeq;
      this.hitSeq = st.hitSeq;
      if (fresh && st.lastHit) {
        const spike = st.lastHit.spike;
        this.buf.after(st.t, () => this.onHit(st, spike));
      }
    }
    if (st.pointSeq !== this.pointSeq) {
      this.pointSeq = st.pointSeq;
      if (st.lastPoint) {
        const { team, x } = st.lastPoint;
        this.buf.after(st.t, () => this.onPoint(team, x));
      }
    }
    this.drawHud(st);
  }

  private matchball(st: VolleyState): Team | null {
    for (const t of TEAMS) {
      const a = st.score.A + (t === 'A' ? 1 : 0);
      const b = st.score.B + (t === 'B' ? 1 : 0);
      if (vollWon(a, b)) return t;
    }
    return null;
  }

  private onPhase(st: VolleyState) {
    this.tweens.killTweensOf([this.banner, this.sub]);
    this.banner.setAlpha(1).setColor('#ffd25e');
    this.sub.setAlpha(1);
    if (st.sub === 'intro') {
      const n = Object.keys(st.players).length;
      this.banner.setText('4');
      this.sub.setText(
        `Team Sonne gegen Team Meer – bis ${st.target} (2 Vorsprung)!\n◀ ▶ laufen · SPRUNG · in der Luft SCHMETTERN${n > 6 ? '\nMax. 3 pro Seite im Feld – nach jedem Punkt wird gewechselt.' : ''}`,
      );
    } else if (st.sub === 'serve') {
      const name = st.server ? playerById(st.server)?.name ?? '?' : '?';
      const mb = this.matchball(st);
      const head = st.golden ? 'GOLDEN POINT!' : mb ? 'MATCHBALL!' : 'AUFSCHLAG';
      this.banner.setText(head).setColor(st.golden || mb ? '#ff9a6a' : '#ffd25e');
      sfx('whistle', { vol: 0.6 });
      if (st.golden || mb) sfx('drumroll', { vol: 0.6, delay: 0.3 });
      this.sub.setText(`${name} · ${TEAM_INFO[st.serving].name}`);
      this.tweens.add({ targets: [this.banner, this.sub], alpha: 0, delay: 1100, duration: 350 });
    } else if (st.sub === 'rally') {
      this.banner.setText('');
      this.sub.setText('');
    } else if (st.sub === 'over') {
      const w = st.winner;
      this.banner.setText(w ? `${TEAM_INFO[w].name.toUpperCase()} GEWINNT!` : 'UNENTSCHIEDEN').setColor(w ? TEAM_INFO[w].color : '#ffd25e');
      this.sub.setText(`${st.score.A} : ${st.score.B}`);
      if (w) this.confetti(w);
      sfx('fanfare');
      sfx('cheer', { delay: 0.3 });
    }
  }

  private onPoint(team: Team, x: number) {
    const st = this.latest!;
    const info = TEAM_INFO[team];
    // Sandfontäne, wo der Ball eingeschlagen ist
    for (let i = 0; i < 14; i++) {
      const d = this.add.circle(x, V.GROUND - 1, i % 3 ? 2 : 3, i % 2 ? 0xf1d49a : 0xdfb878).setDepth(310);
      const ang = -Math.PI * (0.1 + 0.8 * (i / 13));
      this.tweens.add({
        targets: d,
        x: x + Math.cos(ang) * (14 + (i % 4) * 6),
        y: V.GROUND - 1 + Math.sin(ang) * (12 + (i % 3) * 7),
        alpha: 0,
        duration: 600,
        ease: 'Quad.out',
        onComplete: () => d.destroy(),
      });
    }
    this.juice.shake(2);
    this.juice.burst(x, V.GROUND - 2, 'sand', 16);
    sfx('bonk', { x, pitch: 0.7 });
    sfx('coin', { x, delay: 0.12 });
    sfx('cheer', { x, vol: 0.6, delay: 0.15 });
    if (st.sub === 'over') return;
    this.tweens.killTweensOf([this.banner, this.sub]);
    this.banner.setAlpha(1).setText(`PUNKT ${info.name.toUpperCase()}!`).setColor(info.color);
    this.sub.setAlpha(1).setText(`${st.score.A} : ${st.score.B}${st.golden && st.score.A === st.score.B ? '\nZeit um – GOLDEN POINT!' : ''}`);
    this.tweens.add({ targets: [this.banner, this.sub], alpha: 0, delay: V.POINT_MS - 500, duration: 350 });
  }

  private onHit(st: VolleyState, spike: boolean) {
    const x = this.shown.x;
    const y = this.shown.y;
    if (spike) {
      const t = txt(this, x, y - 26, 'ZACK!', { color: '#ff9a6a' }).setDepth(1700);
      this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 650, onComplete: () => t.destroy() });
      // Schmettern: kurzer Hit-Stop + Zoom-Stoß
      this.juice.hitStop(70);
      this.juice.shake(2);
      this.juice.zoomPunch(0.04, 200);
      this.juice.burst(x, y, 'spark', 10);
      sfx('hitHard', { x });
      sfx('whoosh', { x, pitch: 1.3, delay: 0.04 });
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const l = this.add.rectangle(x, y, 6, 1, 0xffffff, 0.95).setRotation(ang).setDepth(320);
        this.tweens.add({ targets: l, x: x + Math.cos(ang) * 14, y: y + Math.sin(ang) * 14, alpha: 0, duration: 240, onComplete: () => l.destroy() });
      }
    } else {
      sfx('hit', { x, vol: 0.7, pitch: st.sub === 'serve' ? 1.2 : 1 });
      const ring = this.add.circle(x, y, 5).setStrokeStyle(1, 0xffffff, 0.9).setDepth(320);

      this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 220, onComplete: () => ring.destroy() });
    }
    void st;
  }

  private puff(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const d = this.add.circle(x + (i - 1) * 4, y, 2, 0xf1d49a, 0.9).setDepth(305);
      this.tweens.add({ targets: d, y: y - 3, x: d.x + (i - 1) * 3, scale: 1.8, alpha: 0, duration: 300, onComplete: () => d.destroy() });
    }
  }

  private confetti(team: Team) {
    const colors = team === 'A' ? [0xf4c542, 0xffe7a0, 0xf0973a] : [0x3fa7e0, 0x93d3f3, 0xeaf8ff];
    for (let i = 0; i < 40; i++) {
      const x = team === 'A' ? 20 + Math.random() * 210 : 250 + Math.random() * 210;
      const d = this.add.rectangle(x, 30, 2, 3, colors[i % 3]).setDepth(1800);
      this.tweens.add({ targets: d, y: 120 + Math.random() * 110, angle: 360, alpha: 0, duration: 1400 + Math.random() * 900, delay: Math.random() * 500, onComplete: () => d.destroy() });
    }
  }

  // ---------------------------------------------------------------- Anzeigetafel

  private drawHud(st: VolleyState) {
    const secs = Math.ceil(st.clock / 1000);
    const ids = Object.keys(st.players);
    const key = JSON.stringify([secs, st.sub, st.score, st.golden, st.serving, st.server, ids.map((id) => [st.players[id].court, st.players[id].team])]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 2, 1, 476, 32));
    // Mitte: Spielstand und Uhr
    this.hud.add(ink(this, 222, 5, String(st.score.A), { size: 16, origin: [1, 0], color: '#b07a10' }));
    this.hud.add(ink(this, 240, 5, ':', { size: 16 }));
    this.hud.add(ink(this, 258, 5, String(st.score.B), { size: 16, origin: [0, 0], color: '#2d64a8' }));
    const clock = st.golden ? 'GOLDEN POINT' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · bis ${st.target}`;
    this.hud.add(ink(this, 240, 23, clock, { color: st.golden ? '#a8342a' : undefined }));
    // Seiten: Team-Name und Porträts (Bank blass)
    for (const t of TEAMS) {
      const info = TEAM_INFO[t];
      const mine = ids.filter((id) => st.players[id].team === t);
      const left = t === 'A';
      this.hud.add(this.add.rectangle(left ? 8 : 472, 6, 4, 22, info.colorNum).setOrigin(left ? 0 : 1, 0).setStrokeStyle(1, 0x2d1b12));
      this.hud.add(ink(this, left ? 16 : 464, 23, info.name.toUpperCase(), { origin: [left ? 0 : 1, 0] }));
      const slot = 17;
      mine.forEach((id, i) => {
        const pl = playerById(id);
        if (!pl) return;
        const p = st.players[id];
        const cx = left ? 24 + i * slot : 456 - i * slot;
        this.hud.add(this.add.rectangle(cx, 3, 17, 17, pcol(id).num).setOrigin(0.5, 0).setAlpha(p.court ? 1 : 0.35));
        this.hud.add(this.add.image(cx, 4, ensurePortrait(this, pl.look)).setOrigin(0.5, 0).setAlpha(p.court ? 1 : 0.35));
        if (id === st.server && st.serving === t && (st.sub === 'serve' || st.sub === 'rally')) {
          this.hud.add(this.add.image(cx + 6, 16, ensureTex(this, 'vb_ball', volleyBall)).setScale(0.5));
        }
      });
      // Aufschlag-Seite markieren
      if (st.serving === t && st.sub !== 'over') {
        this.hud.add(this.add.image(left ? 172 : 308, 12, ensureTex(this, 'vb_ball', volleyBall)).setScale(0.75));
      }
    }
  }
}
