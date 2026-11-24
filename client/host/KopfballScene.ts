import Phaser from 'phaser';
import type { GameState, Team } from '../../shared/types';
import { WORLD, TEAM_INFO } from '../../shared/flunky';
import { KB, KB_WORDS, type KbField, type KbKind, type KbState, kbDir, kbField, kbMode } from '../../shared/kopfball';
import { kopfBall, kopfBody, kopfGoal, kopfHoop, kopfLeg, kopfLines, kopfMarker, kopfWall, paintKopfBackdrop } from '../art/kopfball';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { ensurePortrait } from './textures';
import { pcol } from './playerColor';
import { Countdown, GOLD, backPlate, ensureTex, ink, panel, tagName, txt } from './ui';
import { Juice } from './juice';
import { SnapBuffer, lerpJump } from './interp';
import { sfx } from './sfx';
import { say, spokenName } from './speech';
import { CameraRig } from './camera';
import { clouds, daylight, gulls, waves } from './ambient';

interface Fig {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  leg: Phaser.GameObjects.Image;
  head: Phaser.GameObjects.Image;
  marker: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  shadow: Phaser.GameObjects.Ellipse;
  team: Team;
  x: number;
  y: number;
  air: boolean;
  ks: number;
  /** Zeitpunkt (Szenenzeit) des letzten Schusses – für die Bein- bzw. Wurf-Animation */
  kickT: number;
  h: number;
}

const TEAMS: Team[] = ['A', 'B'];
/** Unterkante der Anzeigetafel (Bildschirm) */
const HUD_H = 30;
const fmtClock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const hexNum = (h: string) => parseInt(h.slice(1), 16);

/**
 * Kopfball-Duell / Kopf-Korb auf dem TV (eine Szene, zwei Schlüssel): Seitenansicht, Figuren mit Riesenköpfen
 * (Avatar-Porträt 3×) auf kleinen Körpern. Die Kamera steht und zoomt aufs Feld (`kbField().zoom` – je kleiner
 * das Team, desto größer). Tafel, Banner und Ansagen liegen auf der HUD-Kamera (`rig.hud`).
 * Figuren und Ball laufen über den SnapBuffer (60 ms hinter dem Server), Effekte über `buf.after`.
 */
export class KopfballScene extends Phaser.Scene {
  private readonly kind: KbKind;
  private figs = new Map<string, Fig>();
  private field: KbField | null = null;
  private fieldKey = '';
  private fieldObjs: Phaser.GameObjects.GameObject[] = [];
  private nets: Phaser.GameObjects.Image[] = [];
  private ball!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private rig!: CameraRig;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private juice!: Juice;
  private latest: KbState | null = null;
  private buf = new SnapBuffer<KbState>();
  private shown = { x: 240, y: 200 };
  private spin = 0;
  private hudKey = '';
  private phaseKey = '';
  private goalSeq = 0;
  private touchSeq = 0;
  private clankSeq = 0;
  private trailAt = 0;
  private cd = new Countdown();
  private clockCd = new Countdown();

  constructor(kind: KbKind = 'kopfball') {
    super(kind);
    this.kind = kind;
  }

  create() {
    this.figs.clear();
    this.field = null;
    this.fieldKey = '';
    this.fieldObjs = [];
    this.nets = [];
    this.latest = null;
    this.buf = new SnapBuffer();
    this.shown = { x: 240, y: 200 };
    this.spin = 0;
    this.hudKey = '';
    this.phaseKey = '';
    this.goalSeq = 0;
    this.touchSeq = 0;
    this.clankSeq = 0;
    this.trailAt = 0;
    const mode = kbMode(this.kind);
    // Feste Kamera (vor allem anderen anlegen: alles Spätere ist Welt, außer in rig.hud())
    this.rig = new CameraRig(this, { w: WORLD.W, h: WORLD.H });
    this.juice = new Juice(this, { depth: 1700, clock: this.buf });

    this.add.image(0, 0, ensureTex(this, `kb_bg_${mode}`, () => {
      const p = new Pix(WORLD.W, WORLD.H);
      paintKopfBackdrop(p, mode);
      return p;
    })).setOrigin(0, 0).setDepth(-1000);
    clouds(this, { n: 3, y: [30, 120], depth: -995, alpha: 0.6, tint: mode === 'korb' ? 0xf6a07a : 0xffffff });
    daylight(this, { depth: -960, strength: 0.4 });
    waves(this, { y: [170, 186], n: 10, depth: -900, color: mode === 'korb' ? 0xffe7b0 : 0xeaf8ff });
    gulls(this, { n: 2, y: [40, 120], depth: -900 });

    this.ballShadow = this.add.ellipse(240, KB.GROUND + 1, KB.BALL_R * 2, 3, 0x000000, 0.25).setDepth(40);
    this.ball = this.add.image(240, 200, ensureTex(this, `kb_ball_${mode}`, () => kopfBall(mode))).setDepth(400);

    this.rig.hud(() => {
      this.hud = this.add.container(0, 0).setDepth(2000);
      this.banner = txt(this, WORLD.W / 2, 64, '', { size: 16, color: GOLD }).setDepth(2001);
      this.sub = txt(this, WORLD.W / 2, 90, '', { size: 8, wrap: 360 }).setDepth(2001);
      // Dunkle Plakette folgt den Texten (wächst mit mehrzeiligen Untertiteln)
      backPlate(this, [this.banner, this.sub], 2000, 8);
      this.clockText = ink(this, 240, 21, '', {}).setDepth(2002);
    });
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  /** Tore bzw. Körbe, Banden, Linien und Kamera passend zur Feldgröße (einmal pro Spiel) */
  private buildField(st: KbState) {
    const key = `${st.mode}-${st.size}`;
    if (key === this.fieldKey) return;
    this.fieldKey = key;
    for (const o of this.fieldObjs) o.destroy();
    this.fieldObjs = [];
    this.nets = [];
    const f = kbField(st.mode, st.size);
    this.field = f;
    this.rig.follow({ x: 240, y: f.camY }, f.zoom, { cut: true });
    const G = KB.GROUND;
    const keep = <T extends Phaser.GameObjects.GameObject>(o: T) => (this.fieldObjs.push(o), o);
    keep(this.add.image(0, G, ensureTex(this, `kb_lines_${key}`, () => kopfLines(f))).setOrigin(0, 0).setDepth(-890));
    // Banden bis unter die Decke
    const wallH = G - f.ceil + 4;
    const wall = ensureTex(this, `kb_wall_${wallH}`, () => kopfWall(wallH));
    keep(this.add.image(f.x0, G + 2, wall).setOrigin(1, 1).setDepth(30));
    keep(this.add.image(f.x1, G + 2, wall).setOrigin(0, 1).setDepth(30));
    if (st.mode === 'fuss') {
      const top = G - KB.GOAL_H - KB.BAR_T;
      this.nets.push(keep(this.add.image(f.x0 - 1, top, ensureTex(this, 'kb_goal_l', () => kopfGoal(false))).setOrigin(0, 0).setDepth(450)));
      this.nets.push(keep(this.add.image(f.x1 + 1, top, ensureTex(this, 'kb_goal_r', () => kopfGoal(true))).setOrigin(1, 0).setDepth(450)));
    } else {
      const top = G - KB.BOARD_TOP;
      this.nets.push(keep(this.add.image(f.x0, top, ensureTex(this, 'kb_hoop_l', () => kopfHoop(false))).setOrigin(0, 0).setDepth(450)));
      this.nets.push(keep(this.add.image(f.x1, top, ensureTex(this, 'kb_hoop_r', () => kopfHoop(true))).setOrigin(1, 0).setDepth(450)));
      // Dreier-Linie = Mittellinie: gestrichelt die Wand hoch, „3“ auf beiden Seiten
      for (let y = G - 44; y < G; y += 6) keep(this.add.rectangle(f.mid, y, 2, 3, 0xffd25e, 0.8).setDepth(-880));
      keep(txt(this, f.mid - 10, G - 54, '3', { color: '#ffd25e' }).setDepth(-880).setScale(0.75));
      keep(txt(this, f.mid + 10, G - 54, '3', { color: '#ffd25e' }).setDepth(-880).setScale(0.75));
    }
    // Teamfarben an den Toren
    for (const t of TEAMS) {
      const x = t === 'A' ? f.x0 + 14 : f.x1 - 14;
      keep(this.add.rectangle(x, G + 6, 18, 4, TEAM_INFO[t].colorNum).setStrokeStyle(1, 0x2d1b12).setDepth(-880));
    }
  }

  private fig(id: string, st: KbState): Fig | undefined {
    const have = this.figs.get(id);
    if (have) return have;
    const p = st.players[id];
    const pl = playerById(id);
    if (!p || !pl) return undefined;
    const lk = `${pl.look.skin}_${pl.look.hair}_${pl.look.hairStyle}_${pl.look.shirt}_${pl.look.beard ?? 0}`;
    const flip = p.t === 'B';
    const body = this.add.image(0, 0, ensureTex(this, `kb_body_${lk}_${p.t}`, () => kopfBody(pl.look, p.t))).setOrigin(0.5, 1).setFlipX(flip);
    // Bein: Drehpunkt an der Hüfte (Bildpunkt 4,3 von 14 × 12) – Phaser spiegelt um den Ursprung
    const leg = this.add.image(kbDir(p.t) * 3, -9, ensureTex(this, `kb_leg_${lk}_${p.t}`, () => kopfLeg(pl.look, p.t)))
      .setOrigin(4 / 14, 3 / 12)
      .setFlipX(flip);
    // Riesenkopf: Porträt 3× – Kopfmitte liegt im Porträt bei (8, 10) von 16 × 15
    const head = this.add.image(0, -KB.HEAD_Y, ensurePortrait(this, pl.look)).setScale(3).setOrigin(0.5, 10 / 15);
    const marker = this.add.image(0, -KB.HEAD_Y - KB.HEAD_R - 12, ensureTex(this, 'kb_marker', kopfMarker)).setTint(pcol(id).num);
    const name = txt(this, 0, -KB.HEAD_Y - KB.HEAD_R - 22, tagName(pl.name), { size: 8, color: pcol(id).hex }).setScale(0.6);
    const root = this.add.container(p.x, p.y, [body, leg, head, marker, name]).setDepth(p.t === 'A' ? 300 : 290);
    const shadow = this.add.ellipse(p.x, KB.GROUND + 1, 22, 5, 0x000000, 0.25).setStrokeStyle(1, TEAM_INFO[p.t].colorNum, 0.9).setDepth(45);
    const f: Fig = { root, body, leg, head, marker, name, shadow, team: p.t, x: p.x, y: p.y, air: p.air, ks: p.ks, kickT: -1e9, h: p.h };
    this.figs.set(id, f);
    return f;
  }

  // ---------------------------------------------------------------- Frame

  update() {
    const st = this.latest;
    const s = this.buf.sample();
    if (!st || !s || !this.field) return;
    const now = this.time.now;
    const { a, b, f } = s;
    const korb = st.mode === 'korb';

    // Ball
    const ox = this.shown.x;
    this.shown = { x: lerpJump(a.ball.x, b.ball.x, f, 70), y: lerpJump(a.ball.y, b.ball.y, f, 70) };
    const hover = b.hold ? Math.sin(now / 160) * 1.2 : 0;
    this.ball.setPosition(this.shown.x, this.shown.y + hover);
    this.spin += ((this.shown.x - ox) / KB.BALL_R) * (korb ? 0.6 : 1);
    this.ball.setRotation(this.spin);
    const hgt = KB.GROUND - this.shown.y;
    const sh = Math.max(0.3, 1 - hgt / 160);
    this.ballShadow.setPosition(this.shown.x, KB.GROUND + 1).setScale(sh).setAlpha(0.3 * sh + 0.05);
    const speed = Math.hypot(b.ball.vx, b.ball.vy);
    if ((b.sub === 'play' || b.sub === 'goal') && speed > 330 && now - this.trailAt > 28) {
      this.trailAt = now;
      const d = this.add.circle(this.shown.x, this.shown.y, KB.BALL_R - 2, korb ? 0xffc38a : 0xfff4d6, 0.6).setDepth(390);
      this.tweens.add({ targets: d, scale: 0.2, alpha: 0, duration: 240, onComplete: () => d.destroy() });
    }

    // Figuren
    const showNames = b.sub === 'countdown' || b.sub === 'kickoff' || b.hold;
    for (const [id, p] of Object.entries(b.players)) {
      const g = this.fig(id, st);
      if (!g) continue;
      const vis = !p.out;
      g.root.setVisible(vis);
      g.shadow.setVisible(vis);
      if (!vis) continue;
      const pa = a.players[id] ?? p;
      g.x = lerpJump(pa.x, p.x, f, 50);
      g.y = lerpJump(pa.y, p.y, f, 50);
      g.root.setPosition(g.x, g.y).setAlpha(p.off ? 0.45 : 1);
      g.shadow.setPosition(g.x, KB.GROUND + 1).setScale(Math.max(0.45, 1 - (KB.GROUND - g.y) / 90));
      g.name.setVisible(showNames);
      const d = kbDir(p.t);
      const running = Math.abs(p.vx) > 20 && !p.air;
      // Bein: Schuss = schneller Tritt nach vorn, Laufen = Pendeln, Sprung = angewinkelt
      const kt = now - g.kickT;
      let legA = 0;
      if (!korb && kt < KB.KICK_MS) {
        const u = kt / KB.KICK_MS;
        legA = u < 0.45 ? Phaser.Math.Linear(0.5, -1.7, u / 0.45) : Phaser.Math.Linear(-1.7, 0, (u - 0.45) / 0.55);
      } else if (p.air) legA = -0.5;
      else if (running) legA = Math.sin(now / 55) * 0.55;
      g.leg.setRotation(legA * d);
      // Wurf: Körper streckt sich, Kopf nickt nach hinten
      const throwing = korb && kt < 260;
      const bob = running ? Math.abs(Math.sin(now / 55)) * -1.5 : 0;
      g.head.setY(-KB.HEAD_Y + bob + (throwing ? -3 : 0)).setRotation(throwing ? -0.25 * d : p.air ? 0.08 * d : Math.sin(now / 55) * (running ? 0.05 : 0));
      g.body.setScale(1, throwing ? 1.15 : 1);
      // Landung: kleine Staubwolke
      if (g.air && !p.air) this.puff(g.x, KB.GROUND, 3);
      g.air = p.air;
    }

    if (st.sub === 'play' && !st.practice) this.clockText.setText(`${st.overtime ? (korb ? 'GOLDEN BASKET ' : 'GOLDEN GOAL ') : ''}${fmtClock(this.clockCd.remaining)}`);
    if (st.sub === 'countdown') this.banner.setText(String(Math.max(1, this.cd.seconds)));
  }

  private puff(x: number, y: number, n: number) {
    const col = this.latest?.mode === 'korb' ? 0xd0a080 : 0xf1d49a;
    for (let i = 0; i < n; i++) {
      const d = this.add.circle(x + (i - 1) * 5, y, 2, col, 0.9).setDepth(305);
      this.tweens.add({ targets: d, y: y - 3, x: d.x + (i - 1) * 3, scale: 1.8, alpha: 0, duration: 300, onComplete: () => d.destroy() });
    }
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== this.kind) return;
    const st = s.mini.state;
    if (!this.latest) {
      // TV erst mitten im Spiel geöffnet: alte Tore/Kontakte nicht nachspielen
      this.goalSeq = st.lastGoal?.seq ?? 0;
      this.touchSeq = st.touch?.seq ?? 0;
      this.clankSeq = st.clank?.seq ?? 0;
      this.shown = { x: st.ball.x, y: st.ball.y };
    }
    this.latest = st;
    this.buildField(st);
    this.buf.push(st.t, st);

    for (const [id, p] of Object.entries(st.players)) {
      const g = this.fig(id, st);
      if (!g) continue;
      if (p.ks !== g.ks) {
        g.ks = p.ks;
        this.buf.after(st.t, () => {
          g.kickT = this.time.now;
          sfx('whoosh', { x: g.x, vol: 0.35, pitch: 1.4 });
        });
      }
    }
    const tc = st.touch;
    if (tc && tc.seq !== this.touchSeq) {
      this.touchSeq = tc.seq;
      this.buf.after(st.t, () => this.onTouch(tc.how, tc.power, tc.x, tc.y));
    }
    const cl = st.clank;
    if (cl && cl.seq !== this.clankSeq) {
      this.clankSeq = cl.seq;
      this.buf.after(st.t, () => {
        sfx('crack', { x: cl.x, vol: 0.55, pitch: st.mode === 'korb' ? 1.4 : 0.9 });
        const ring = this.add.circle(cl.x, cl.y, 3).setStrokeStyle(1, 0xffffff, 0.9).setDepth(460);
        this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 260, onComplete: () => ring.destroy() });
      });
    }
    const g = st.lastGoal;
    if (g && g.seq !== this.goalSeq) {
      this.goalSeq = g.seq;
      this.buf.after(st.t, () => this.onGoal(st, g));
    }

    const key = `${st.sub}-${st.round}-${st.overtime}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.cd.set(st.endsIn);
      this.onPhase(st);
    }
    if (st.sub === 'play') this.clockCd.set(st.endsIn);
    this.drawHud(st);
  }

  private kickLine(st: KbState) {
    const w = KB_WORDS[st.mode];
    return `${w.kick}: ${TEAM_INFO[st.kick].name}${st.first ? ' (per Los)' : ''}`;
  }

  private onPhase(st: KbState) {
    // Tor/Korb: das Banner setzt onGoal() (über die Wiedergabe-Uhr, zeitgleich mit dem Ball im Netz)
    if (st.sub === 'goal') return;
    this.tweens.killTweensOf([this.banner, this.sub]);
    this.banner.setAlpha(1).setColor(GOLD).setFontSize(16);
    this.sub.setAlpha(1);
    const korb = st.mode === 'korb';
    if (st.sub === 'countdown') {
      this.banner.setText('3');
      this.sub.setText(`${this.kickLine(st)}\nBis ${st.target} ${KB_WORDS[st.mode].target} oder ${fmtClock(st.clock)} min${korb ? '\nWurf aus der eigenen Hälfte: 3 Punkte' : ''}`);
      say(`${KB_WORDS[st.mode].kick} für ${TEAM_INFO[st.kick].name}`, { rate: 1.25 });
    } else if (st.sub === 'kickoff') {
      this.banner.setText(st.overtime ? (korb ? 'GOLDEN BASKET' : 'GOLDEN GOAL') : KB_WORDS[st.mode].kick.toUpperCase()).setColor(st.overtime ? '#ff9a6a' : GOLD);
      this.sub.setText(`${TEAM_INFO[st.kick].name}${st.overtime ? ' · der nächste Treffer gewinnt!' : ''}${st.practice ? '\nAufwärmen – nichts zählt' : ''}`);
      sfx('whistle', { vol: 0.5 });
      if (st.overtime) {
        say(korb ? 'Golden Basket! Der nächste Korb gewinnt.' : 'Golden Goal! Das nächste Tor gewinnt.');
        sfx('drumroll', { vol: 0.6, delay: 0.3 });
      }
    } else if (st.sub === 'play') {
      this.tweens.add({ targets: [this.banner, this.sub], alpha: 0, duration: 260, onComplete: () => (this.banner.setText(''), this.sub.setText('')) });
    } else if (st.sub === 'over') {
      const w = st.winner;
      this.banner.setText(w ? `${TEAM_INFO[w].name.toUpperCase()} GEWINNT!` : 'UNENTSCHIEDEN').setColor(w ? TEAM_INFO[w].color : GOLD);
      this.sub.setText(`${st.score.A} : ${st.score.B}`);
      sfx('whistle');
      sfx('fanfare', { delay: 0.4 });
      sfx('cheer', { delay: 0.5 });
      if (w) {
        say(`Abpfiff! ${TEAM_INFO[w].name} gewinnt ${st.score[w]} zu ${st.score[w === 'A' ? 'B' : 'A']}.`);
        this.confetti(w);
      } else say('Abpfiff! Unentschieden.');
    }
  }

  private onTouch(how: 'kopf' | 'schuss' | 'koerper', power: number, x: number, y: number) {
    const st = this.latest;
    if (!st) return;
    if (how === 'schuss') {
      const hard = power > 330;
      sfx(hard ? 'hitHard' : 'hit', { x, vol: 0.8, pitch: st.mode === 'korb' ? 1.25 : 1 });
      if (hard && st.mode === 'fuss') {
        this.juice.hitStop(45);
        this.juice.shake(1);
        this.juice.burst(x, y, 'spark', 8);
      }
    } else if (how === 'kopf') {
      sfx('bonk', { x, vol: 0.7, pitch: 0.9 + Math.min(0.5, power / 800) });
    } else sfx('bonk', { x, vol: 0.4, pitch: 0.7 });
    const ring = this.add.circle(x, y, KB.BALL_R).setStrokeStyle(1, 0xffffff, 0.9).setDepth(410);
    this.tweens.add({ targets: ring, scale: 2, alpha: 0, duration: 220, onComplete: () => ring.destroy() });
  }

  private onGoal(st: KbState, g: NonNullable<KbState['lastGoal']>) {
    const korb = st.mode === 'korb';
    const info = TEAM_INFO[g.team];
    const name = g.scorer ? (playerById(g.scorer)?.name ?? '') : '';
    const head = korb ? (g.dunk ? 'DUNK!' : g.pts === 3 ? 'DREIER!' : 'KORB!') : g.own ? 'EIGENTOR!' : 'TOR!';
    // Netz zappelt, Konfetti in Teamfarbe, Blitz
    const net = this.nets[g.team === 'A' ? 1 : 0];
    if (net) this.tweens.add({ targets: net, scaleY: 1.06, scaleX: 0.96, duration: 90, yoyo: true, repeat: 3 });
    this.juice.flash(0xffffff, 120);
    this.juice.shake(2);
    this.rig.punch(0.04, 220);
    this.juice.burst(g.x, g.y, 'confetti', 26);
    sfx('goal', { x: g.x });
    sfx(g.own ? 'lose' : 'cheer', { x: g.x, delay: 0.2 });
    const short = tagName(name);
    const who = g.own ? `Eigentor von ${short} – ` : short ? `${short} trifft${korb ? ` (+${g.pts})` : ''} – ` : '';
    if (korb) say(`${head.replace('!', '')}${name && !g.own ? ` – ${spokenName(name)}` : ''}! ${g.pts} Punkte für ${info.name}.`, { interrupt: true });
    else say(g.own ? `Eigentor! Tor für ${info.name}.` : `Tor! ${name ? spokenName(name) : info.name}!`, { interrupt: true });
    if (st.sub === 'over') return;
    this.tweens.killTweensOf([this.banner, this.sub]);
    this.banner.setAlpha(1).setText(head).setColor(g.own ? '#ff8a7a' : info.color).setFontSize(korb && g.pts === 3 ? 16 : 24);
    this.sub.setAlpha(1).setText(`${who}${g.own || !short ? `Punkt für ${info.name}` : info.name}\n${st.score.A} : ${st.score.B}`);
    this.tweens.add({ targets: this.banner, scale: { from: 1.5, to: 1 }, duration: 260, ease: 'Back.out' });
  }

  private confetti(team: Team) {
    const f = this.field;
    if (!f) return;
    const cols = [hexNum(TEAM_INFO[team].color), 0xffd25e, 0xfdf7ea];
    for (let i = 0; i < 40; i++) {
      const x = f.x0 + Math.random() * f.w;
      const d = this.add.rectangle(x, f.ceil + 4, 2, 3, cols[i % 3]).setDepth(1600);
      this.tweens.add({ targets: d, y: KB.GROUND - Math.random() * 30, angle: 360, alpha: 0, duration: 1400 + Math.random() * 900, delay: Math.random() * 500, onComplete: () => d.destroy() });
    }
  }

  // ---------------------------------------------------------------- Anzeigetafel

  private drawHud(st: KbState) {
    const ids = Object.keys(st.players);
    const key = JSON.stringify([st.sub, st.score, st.kick, st.overtime, st.practice, ids.map((id) => [st.players[id].t, !!st.players[id].off, !!st.players[id].out])]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.rig.hud(() => this.buildHud(st, ids));
  }

  private buildHud(st: KbState, ids: string[]) {
    this.hud.removeAll(true);
    this.hud.add(panel(this, 2, 1, 476, HUD_H));
    this.hud.add(ink(this, 222, 4, String(st.score.A), { size: 16, origin: [1, 0], color: '#b07a10' }));
    this.hud.add(ink(this, 240, 4, ':', { size: 16 }));
    this.hud.add(ink(this, 258, 4, String(st.score.B), { size: 16, origin: [0, 0], color: '#2d64a8' }));
    const korb = st.mode === 'korb';
    const clock = st.practice ? 'AUFWÄRMEN' : st.sub === 'play' ? '' : `${st.overtime ? (korb ? 'GOLDEN BASKET ' : 'GOLDEN GOAL ') : ''}${fmtClock(st.clock)}`;
    this.clockText.setText(clock).setColor(st.overtime ? '#a8342a' : '#3d2414');
    for (const t of TEAMS) {
      const info = TEAM_INFO[t];
      const mine = ids.filter((id) => st.players[id].t === t);
      const left = t === 'A';
      this.hud.add(this.add.rectangle(left ? 8 : 472, 5, 4, 22, info.colorNum).setOrigin(left ? 0 : 1, 0).setStrokeStyle(1, 0x2d1b12));
      this.hud.add(ink(this, left ? 16 : 464, 21, info.name.toUpperCase(), { origin: [left ? 0 : 1, 0] }));
      mine.forEach((id, i) => {
        const pl = playerById(id);
        if (!pl) return;
        const p = st.players[id];
        const cx = left ? 24 + i * 17 : 456 - i * 17;
        const alpha = p.out ? 0.25 : p.off ? 0.5 : 1;
        this.hud.add(this.add.rectangle(cx, 3, 16, 15, pcol(id).num).setOrigin(0.5, 0).setAlpha(alpha));
        this.hud.add(this.add.image(cx, 3, ensurePortrait(this, pl.look)).setOrigin(0.5, 0).setAlpha(alpha));
      });
      // Anstoß bzw. Einwurf: kleiner Ball neben dem Team
      if (st.kick === t && (st.sub === 'countdown' || st.sub === 'kickoff' || st.hold)) {
        this.hud.add(this.add.image(left ? 172 : 308, 12, ensureTex(this, `kb_ball_${st.mode}`, () => kopfBall(st.mode))));
      }
    }
  }
}

/** Kopf-Korb: gleiche Szene unter eigenem Schlüssel */
export class KopfkorbScene extends KopfballScene {
  constructor() {
    super('kopfkorb');
  }
}

export const KOPF_SCENES = [KopfballScene, KopfkorbScene];

