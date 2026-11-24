import Phaser from 'phaser';
import type { FlunkyState, GameState, Point, Team } from '../../shared/types';
import {
  BOTTLE,
  FLIGHT_MS,
  FLUNKY,
  RUN_TAPS,
  TEAM_INFO,
  THROW_SPOT,
  WIND_WORD,
  WORLD,
  aimDir,
  dist,
  flunkyDistance,
  fmtM,
  fwd,
  missHint,
  otherTeam,
  teamBeer,
  windLevel,
} from '../../shared/flunky';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintSand, paintShore, paintWater } from '../art/ground';
import { FONT, bus, getState, playerById } from './store';
import { ensureBall, ensureBottle, figure } from './textures';
import { BLUE_INK, INK, background, ink, panel, prop, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say } from './speech';
import { crowd, daylight, foam, gulls, sway } from './ambient';

interface Actor {
  root: Phaser.GameObjects.Container;
  barFill: Phaser.GameObjects.Rectangle;
  floorMark: Phaser.GameObjects.Rectangle;
  lastBeer: number;
  lastGluck: number;
}

interface Speck {
  r: Phaser.GameObjects.Rectangle;
  vx: number;
}

const BAR_W = 16;
const TEAM_INK: Record<Team, string> = { A: '#b9770e', B: BLUE_INK };
/** HUD-Bierbalken */
const HUD_BAR_W = 92;
/** Länge des Zielpfeils am Boden */
const ARROW_LEN = 46;

export class FlunkyScene extends Phaser.Scene {
  private actors = new Map<string, Actor>();
  private bottle!: Phaser.GameObjects.Image;
  private bottleDown = false;
  private bottlePos: Point = { ...BOTTLE };
  private status!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private windText!: Phaser.GameObjects.Text;
  private windGfx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private teamText: Partial<Record<Team, Phaser.GameObjects.Text>> = {};
  private hitText: Partial<Record<Team, Phaser.GameObjects.Text>> = {};
  private runBar!: Phaser.GameObjects.Graphics;
  private aimGfx!: Phaser.GameObjects.Graphics;
  private distText!: Phaser.GameObjects.Text;
  private markGfx!: Phaser.GameObjects.Graphics;
  private overLayer!: Phaser.GameObjects.Container;
  private lastSeq = 0;
  private flying = false;
  private juice!: Juice;
  private fans: ReturnType<typeof crowd> | null = null;
  private runTaps = 0;
  private specks: Speck[] = [];
  private wind = 0;
  private lastSub = '';

  constructor() {
    super('flunky');
  }

  create() {
    this.actors.clear();
    this.bottleDown = false;
    this.flying = false;
    this.runTaps = 0;
    this.specks = [];
    this.wind = 0;
    this.lastSub = '';
    this.teamText = {};
    this.hitText = {};
    const st = getState();
    const f0 = st?.mini?.kind === 'flunky' ? st.mini.state : null;
    this.lastSeq = f0?.lastThrow?.seq ?? 0;
    this.bottlePos = { ...(f0?.bottle ?? BOTTLE) };

    background(this, 'beach-flunky', WORLD.W, WORLD.H, (p) => {
      paintWater(p, 0, 0, WORLD.W, 104, 21);
      paintSand(p, 0, 104, WORLD.W, WORLD.H - 104, 22);
      paintShore(p, 0, 104, WORLD.W, 23);
      // Wurfzonen: vorne eine Muschel-Linie, dahinter ein heller Streifen – der Werfer steht jedes Mal woanders darin
      for (const team of ['A', 'B'] as Team[]) {
        const s = THROW_SPOT[team];
        const front = s.x + fwd(team) * (FLUNKY.SPOT_DEPTH + 7);
        const x0 = Math.min(s.x - FLUNKY.SPOT_DEPTH - 4, s.x + FLUNKY.SPOT_DEPTH + 4);
        const y0 = s.y - FLUNKY.SPOT_LAT - 8;
        const y1 = s.y + FLUNKY.SPOT_LAT + 8;
        for (let y = y0; y < y1; y += 2) for (let x = x0; x < x0 + 2 * FLUNKY.SPOT_DEPTH + 8; x += 2) if ((x + y) % 6 === 0) p.px(x, y, C.sandDark);
        for (let y = y0; y < y1; y += 7) p.rect(front, y, 2, 2, C.white).px(front + 1, y + 1, C.sandDark);
      }
    });
    // Glitzern auf dem Wasser
    for (let i = 0; i < 10; i++) {
      const s = this.add.rectangle(Phaser.Math.Between(0, WORLD.W), Phaser.Math.Between(36, 98), 3, 1, 0xffffff).setAlpha(0);
      this.tweens.add({ targets: s, alpha: 0.9, duration: 600, yoyo: true, repeat: -1, delay: i * 230, repeatDelay: 1200 });
    }

    // Leerer Strand: Möwen, Wellenschaum an der Wasserkante, Zuschauer am Handtuch
    gulls(this, { n: 3, y: [40, 96], depth: 900 });
    foam(this, { y: 104, n: 16, depth: -900, spread: 2 });
    this.juice = new Juice(this, { depth: 4000 });
    this.fans = crowd(this, [[150, 266], [168, 268], [312, 268], [330, 266]], { depth: 262 });

    // Palmen wehen leicht, Tageszeit färbt den Strand (Figuren und HUD nicht)
    sway(this, [prop(this, 'palm', () => O.palm(6), 18, 150), prop(this, 'palm2', () => O.palm(9), 464, 160).setFlipX(true)]);
    daylight(this, { depth: -950 });
    prop(this, 'umbrella', () => O.umbrella(), 240, 262).setDepth(262);
    prop(this, 'towelR', () => O.towel(C.red), 214, 268);
    prop(this, 'towelB', () => O.towel(C.blue), 266, 268);

    // Sandkörner, die mit dem Wind treiben (zeigen Richtung und Stärke)
    for (let i = 0; i < 18; i++) {
      const r = this.add.rectangle(Phaser.Math.Between(0, WORLD.W), Phaser.Math.Between(110, 264), Phaser.Math.Between(1, 2), 1, 0xfff4d6).setAlpha(0.7).setDepth(5);
      this.specks.push({ r, vx: Phaser.Math.FloatBetween(-4, 4) });
    }

    this.markGfx = this.add.graphics().setDepth(2);
    this.aimGfx = this.add.graphics().setDepth(3);
    this.distText = ink(this, 0, 0, '', { color: '#5a3a1a', origin: [0.5, 0] }).setDepth(4).setAlpha(0.9);
    this.bottle = this.add.image(this.bottlePos.x, this.bottlePos.y, ensureBottle(this)).setOrigin(0.5, 1);

    // HUD: Bier-Pegel beider Teams, Runde, Wind
    panel(this, 0, 0, WORLD.W, 34).setDepth(1000);
    this.hud = this.add.graphics().setDepth(1001);
    this.teamText.A = ink(this, 18, 5, '', { origin: [0, 0], color: TEAM_INK.A, align: 'left' }).setDepth(1002);
    this.teamText.B = ink(this, WORLD.W - 18, 5, '', { origin: [1, 0], color: TEAM_INK.B, align: 'right' }).setDepth(1002);
    this.hitText.A = ink(this, 10 + HUD_BAR_W + 6, 18, '', { origin: [0, 0], align: 'left' }).setDepth(1002);
    this.hitText.B = ink(this, WORLD.W - 10 - HUD_BAR_W - 6, 18, '', { origin: [1, 0], align: 'right' }).setDepth(1002);
    this.roundText = ink(this, WORLD.W / 2, 5, '').setDepth(1002);
    this.windText = ink(this, WORLD.W / 2 - 18, 18, '', { origin: [0, 0], color: '#7a5a3a', align: 'left' }).setDepth(1002);
    this.windGfx = this.add.graphics().setDepth(1002);
    this.status = txt(this, WORLD.W / 2, 42, '', { align: 'center' }).setDepth(1001);
    this.runBar = this.add.graphics().setDepth(1001);
    this.overLayer = this.add.container(0, 0).setDepth(2000);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    if (st) this.render(st);
  }

  update(_t: number, dtMs: number) {
    for (const a of this.actors.values()) {
      const tx = a.root.getData('tx') as number;
      const ty = a.root.getData('ty') as number;
      a.root.x += (tx - a.root.x) * 0.2;
      a.root.y += (ty - a.root.y) * 0.2;
      a.root.setDepth(a.root.y);
    }
    this.bottle.setDepth(this.bottle.y);
    // Wind: Sandkörner treiben am TV nach oben/unten (Stärke = Tempo)
    const dt = Math.min(0.05, dtMs / 1000);
    for (const s of this.specks) {
      s.r.x += s.vx * dt;
      s.r.y += this.wind * 46 * dt;
      if (s.r.y > 266) s.r.y = 110;
      if (s.r.y < 110) s.r.y = 266;
      if (s.r.x < 0) s.r.x = WORLD.W;
      if (s.r.x > WORLD.W) s.r.x = 0;
      s.r.setAlpha(Math.abs(this.wind) < 0.12 ? 0.25 : 0.75);
    }
  }

  private homePos(team: Team, index: number, count: number): Point {
    const x = team === 'A' ? 34 + (index % 2) * 20 : WORLD.W - 34 - (index % 2) * 20;
    const y = BOTTLE.y + (index - (count - 1) / 2) * 30;
    return { x, y };
  }

  private ensureActor(id: string, team: Team): Actor | null {
    const p = playerById(id);
    if (!p) return null;
    let a = this.actors.get(id);
    if (!a) {
      const root = figure(this, p.look, 0, 0);
      (root.getData('img') as Phaser.GameObjects.Image).setFlipX(team === 'B');
      const barBg = this.add.rectangle(-BAR_W / 2 - 1, -33, BAR_W + 2, 5, 0x2d1b12).setOrigin(0, 0.5);
      const barFill = this.add.rectangle(-BAR_W / 2, -33, BAR_W, 3, 0xf0b13a).setOrigin(0, 0.5);
      const floorMark = this.add.rectangle(-BAR_W / 2, -33, 1, 5, 0xffffff).setOrigin(0.5, 0.5).setVisible(false);
      root.add([barBg, barFill, floorMark]);
      a = { root, barFill, floorMark, lastBeer: 100, lastGluck: 0 };
      this.actors.set(id, a);
    }
    a.root.setAlpha(p.connected ? 1 : 0.45);
    return a;
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'flunky') return;
    const f = s.mini.state;
    this.wind = f.sub === 'aim' || f.sub === 'flight' ? f.wind : f.wind * 0.5;
    const chugging = f.sub === 'chug' || f.sub === 'reset';

    for (const team of ['A', 'B'] as Team[]) {
      const ids = f.teams[team];
      ids.forEach((id, i) => {
        const a = this.ensureActor(id, team);
        if (!a) return;
        const home = this.homePos(team, i, ids.length);
        let target = home;
        if (id === f.throwerId && (f.sub === 'aim' || f.sub === 'flight')) target = f.spot;
        if (id === f.runnerId && chugging) {
          const t = f.runProgress / RUN_TAPS;
          const b = f.lastThrow?.bottle ?? f.bottle;
          const bottleSide = { x: b.x + (team === 'A' ? -10 : 10), y: b.y };
          target = t < 0.5 ? lerpPt(home, bottleSide, t * 2) : lerpPt(bottleSide, home, (t - 0.5) * 2);
        }
        if (a.root.getData('tx') === undefined) a.root.setPosition(target.x, target.y);
        a.root.setData('tx', target.x).setData('ty', target.y);

        const beer = f.beer[id] ?? 0;
        a.barFill.width = Math.max(0, (beer / 100) * BAR_W);
        // Schluck-Limit dieses Treffers als weißer Strich im Balken
        const floor = f.sub === 'chug' && team === f.turnTeam ? f.sipFloor[id] : undefined;
        a.floorMark.setVisible(floor !== undefined && beer > floor);
        if (floor !== undefined) a.floorMark.x = -BAR_W / 2 + (floor / 100) * BAR_W;
        if (beer < a.lastBeer) this.gluck(a);
        a.lastBeer = beer;
      });
    }
    this.renderHud(f);

    // Laufen: jeder Tap ein Tick
    if (chugging && f.runProgress > this.runTaps) sfx('tick', { pitch: 0.9 + (f.runProgress / RUN_TAPS) * 0.6, vol: 0.4 });
    this.runTaps = chugging ? f.runProgress : 0;
    if (f.sub === 'over' && !this.overLayer.length) {
      sfx('fanfare');
      this.fans?.cheer();
      this.juice.burst(WORLD.W / 2, 90, 'confetti', 50);
    }

    if (f.lastThrow && f.lastThrow.seq !== this.lastSeq) {
      this.lastSeq = f.lastThrow.seq;
      this.animateThrow(f);
    }

    // Flasche: steht wieder (nach dem Aufstellen etwas versetzt)
    if (f.sub === 'aim' || (f.sub === 'chug' && f.runProgress >= RUN_TAPS / 2) || f.sub === 'reset') {
      this.placeBottle(f.bottle);
      this.setBottleDown(false);
    }

    if (f.sub === 'aim' && this.lastSub !== 'aim') this.markGfx.setAlpha(0.55);
    this.lastSub = f.sub;
    this.renderAim(f);
    this.renderStatus(f);
    this.renderOver(f);
  }

  /** HUD: Team-Namen, Bier-Pegel als Balken (voll = 100 %), Treffer, Runde, Wind */
  private renderHud(f: FlunkyState) {
    const g = this.hud;
    g.clear();
    for (const team of ['A', 'B'] as Team[]) {
      const beer = teamBeer(f, team);
      const x = team === 'A' ? 10 : WORLD.W - 10 - HUD_BAR_W;
      g.fillStyle(0x2d1b12).fillRect(x - 1, 17, HUD_BAR_W + 2, 10);
      g.fillStyle(0xf7e4b5).fillRect(x, 18, HUD_BAR_W, 8);
      // Bier läuft von der Wurfseite aus leer
      const w = Math.round((beer / 100) * HUD_BAR_W);
      g.fillStyle(0xf0b13a).fillRect(team === 'A' ? x : x + HUD_BAR_W - w, 18, w, 8);
      g.fillStyle(0xfff4d6, 0.7).fillRect(team === 'A' ? x : x + HUD_BAR_W - w, 18, w, 2);
      // Drittel-Striche = ein voller Treffer (Schluck-Limit)
      for (let k = 1; k * FLUNKY.SIP_MAX < 100; k++) g.fillStyle(0x2d1b12, 0.35).fillRect(x + Math.round(((team === 'A' ? 100 - k * FLUNKY.SIP_MAX : k * FLUNKY.SIP_MAX) / 100) * HUD_BAR_W), 18, 1, 8);
      this.hitText[team]?.setText(`Bier ${Math.round(beer)}%`);
      const hits = f.hits[team];
      this.teamText[team]?.setText(team === 'A' ? `${TEAM_INFO.A.name} · ${hits} Tr.` : `${hits} Tr. · ${TEAM_INFO.B.name}`);
      // Wer gerade dran ist: kleines Dreieck vor dem Team-Namen
      if (f.sub !== 'over' && f.turnTeam === team) {
        const tx = team === 'A' ? 10 : WORLD.W - 10;
        const d = team === 'A' ? 1 : -1;
        g.fillStyle(TEAM_INFO[team].colorNum).fillTriangle(tx, 6, tx, 13, tx + d * 5, 9.5);
        g.lineStyle(1, 0x2d1b12).strokeTriangle(tx, 6, tx, 13, tx + d * 5, 9.5);
      }
    }
    this.roundText.setText(f.round > f.rounds ? 'Verlängerung!' : `Runde ${Math.min(f.round, f.rounds)}/${f.rounds}`);
    // Wind: Pfeil nach oben/unten, Länge = Stärke
    const wg = this.windGfx;
    wg.clear();
    const n = windLevel(f.wind);
    this.windText.setText(n ? WIND_WORD[n] : 'windstill');
    if (n) {
      const x = WORLD.W / 2 - 25;
      const down = f.wind > 0;
      const len = 3 + n * 3;
      const y0 = 22 - (down ? len / 2 : -len / 2);
      const y1 = 22 + (down ? len / 2 : -len / 2);
      wg.fillStyle(0x7a5a3a).fillRect(x - 1, Math.min(y0, y1), 2, len);
      wg.fillTriangle(x - 4, y1 - (down ? 2 : -2), x + 4, y1 - (down ? 2 : -2), x, y1 + (down ? 3 : -3));
    }
  }

  /** Wurfpunkt (Ring in Teamfarbe), Zielpfeil am Boden, Abstand zur Flasche */
  private renderAim(f: FlunkyState) {
    const g = this.aimGfx;
    g.clear();
    const show = f.sub === 'aim' || (f.sub === 'flight' && this.flying);
    this.distText.setVisible(f.sub === 'aim');
    if (!show) return;
    const team = f.turnTeam;
    const col = TEAM_INFO[team].colorNum;
    const s = f.spot;
    g.lineStyle(3, 0x2d1b12, 0.6).strokeEllipse(s.x, s.y, 20, 7);
    g.lineStyle(1, col, 1).strokeEllipse(s.x, s.y, 20, 7);
    if (f.sub !== 'aim') return;
    const d = aimDir(team, f.aim);
    const x0 = s.x + d.x * 9;
    const y0 = s.y + d.y * 9;
    const ex = s.x + d.x * ARROW_LEN;
    const ey = s.y + d.y * ARROW_LEN;
    // Schaft gestrichelt, dunkle Kontur
    for (let k = 0; k < 1; k += 0.16) {
      const a = { x: x0 + (ex - x0) * k, y: y0 + (ey - y0) * k };
      const b = { x: x0 + (ex - x0) * Math.min(1, k + 0.1), y: y0 + (ey - y0) * Math.min(1, k + 0.1) };
      g.lineStyle(4, 0x2d1b12, 0.85).lineBetween(a.x, a.y, b.x, b.y);
      g.lineStyle(2, col, 1).lineBetween(a.x, a.y, b.x, b.y);
    }
    const ang = Math.atan2(d.y, d.x);
    const tip = (r: number, da: number) => ({ x: ex + Math.cos(ang + da) * r, y: ey + Math.sin(ang + da) * r });
    const [t0, t1, t2] = [tip(5, 0), tip(8, 2.5), tip(8, -2.5)];
    g.fillStyle(0x2d1b12).fillTriangle(t0.x + Math.cos(ang), t0.y + Math.sin(ang), t1.x, t1.y, t2.x, t2.y);
    const [u0, u1, u2] = [tip(3.5, 0), tip(6, 2.5), tip(6, -2.5)];
    g.fillStyle(col).fillTriangle(u0.x, u0.y, u1.x, u1.y, u2.x, u2.y);
    // Abstand zur Flasche an der Pfeilspitze (unter dem Wurfpunkt stehen die Mitspieler)
    this.distText.setText(fmtM(dist(s, f.bottle))).setPosition(ex + d.x * 4, ey + (d.y >= 0 ? 5 : -15));
  }

  private renderStatus(f: FlunkyState) {
    const thrower = playerById(f.throwerId)?.name ?? '?';
    const runner = playerById(f.runnerId)?.name ?? '?';
    const drinkTeam = TEAM_INFO[f.turnTeam].name;
    this.runBar.clear();

    if (f.sub === 'aim') {
      this.status.setText(`${thrower} zielt …\nPfeil am Handy auf die Flasche drehen – dann werfen!`);
    } else if (f.sub === 'flight') {
      this.status.setText(`${thrower} wirft …`);
    } else if (f.sub === 'chug' || f.sub === 'reset') {
      this.status.setText(
        f.sub === 'chug'
          ? `TREFFER! ${drinkTeam} trinkt (max. ${FLUNKY.SIP_MAX} %)\n${runner} lauf! (${TEAM_INFO[otherTeam(f.turnTeam)].name})`
          : 'Flasche steht wieder! Wechsel …',
      );
      const w = 160;
      const x = (WORLD.W - w) / 2;
      this.runBar.fillStyle(0x2d1b12).fillRect(x - 1, 67, w + 2, 8);
      this.runBar.fillStyle(0xf7e4b5).fillRect(x, 68, w, 6);
      this.runBar.fillStyle(TEAM_INFO[otherTeam(f.turnTeam)].colorNum).fillRect(x, 68, w * (f.runProgress / RUN_TAPS), 6);
    } else if (f.sub === 'over') {
      this.status.setText('');
    }
  }

  private renderOver(f: FlunkyState) {
    this.overLayer.removeAll(true);
    if (f.sub !== 'over') return;
    const pct = (t: Team) => Math.round(100 - teamBeer(f, t));
    const win = f.winner;
    const why =
      f.reason === 'empty' ? 'hat zuerst ausgetrunken!' : f.reason === 'forfeit' ? 'gewinnt kampflos.' : win ? `hat mehr getrunken (${pct(win)} % zu ${pct(otherTeam(win))} %)` : '';
    const names = win ? f.teams[win].map((id) => playerById(id)?.name ?? '?').join(', ') : '';
    this.overLayer.add([
      this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x1a1008, 0.5).setOrigin(0),
      panel(this, 90, 64, 300, 142),
      ink(this, WORLD.W / 2, 82, win ? `${TEAM_INFO[win].name}\ngewinnt!` : 'Unentschieden!', { size: 16, color: win ? TEAM_INK[win] : INK }),
      ink(this, WORLD.W / 2, 130, win ? `${why}\n${names}` : `Beide ${pct('A')} % getrunken`, { wrap: 270 }),
      ink(this, WORLD.W / 2, 176, `Treffer ${f.hits.A} : ${f.hits.B} · Gleich kommen die Ergebnisse …`, { color: '#7a5a3a', wrap: 280 }),
    ]);
  }

  private animateThrow(f: FlunkyState) {
    const t = f.lastThrow!;
    const d = aimDir(t.team, t.aim);
    const reach = flunkyDistance(t.power);
    // Bodenpunkt: geradeaus entlang des Pfeils, der Wind verweht quadratisch (Kurve) – Ende genau am Aufprall
    const drift = { x: t.to.x - (t.from.x + d.x * reach), y: t.to.y - (t.from.y + d.y * reach) };
    // Treffer: der Ball fliegt in die Flasche statt dahinter auf den Boden
    const end = t.hit ? { x: t.bottle.x - fwd(t.team) * 2, y: t.bottle.y } : t.to;
    const fix = { x: end.x - t.to.x, y: end.y - t.to.y };
    const endH = t.hit ? 10 : 3;
    const ball = this.add.image(t.from.x, t.from.y - 22, ensureBall(this));
    const shadow = this.add.ellipse(t.from.x, t.from.y, 7, 3, 0x000000, 0.25);
    this.flying = true;
    this.markGfx.clear().setAlpha(1);
    sfx('throw', { x: t.from.x });
    const dur = FLIGHT_MS - 200;
    const apex = 46 + reach * 0.2;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: dur,
      onUpdate: (tw) => {
        const k = tw.getValue() ?? 0;
        const gx = t.from.x + d.x * reach * k + drift.x * k * k + fix.x * k;
        const gy = t.from.y + d.y * reach * k + drift.y * k * k + fix.y * k;
        shadow.setPosition(gx, gy).setDepth(gy - 1);
        ball.setPosition(gx, gy - Phaser.Math.Linear(22, endH, k) - Math.sin(Math.PI * k) * apex).setDepth(9999);
        ball.setAngle(k * 720);
      },
      onComplete: () => {
        this.flying = false;
        shadow.destroy();
        if (t.hit) {
          this.setBottleDown(true, t.team);
          // Treffer: Klirren, kurzer Stopp, Sandwolke, Jubel; der Ball prallt ab
          this.juice.shake(2);
          this.juice.hitStop(80);
          this.juice.burst(t.bottle.x, t.bottle.y - 4, 'sand', 14);
          this.juice.burst(t.bottle.x, t.bottle.y - 10, 'spark', 8);
          sfx('crack', { x: t.bottle.x });
          sfx('hitHard', { x: t.bottle.x, delay: 0.03 });
          sfx('cheer', { delay: 0.2 });
          say('Treffer!');
          this.fans?.cheer();
          this.popText(t.bottle.x, t.bottle.y - 40, 'TREFFER!', C.gold, '16px');
          this.tweens.add({ targets: ball, x: ball.x - fwd(t.team) * 14, y: ball.y + 8, duration: 380, ease: 'Quad.out' });
        } else {
          this.juice.burst(t.to.x, t.to.y, 'sand', 6);
          sfx('bonk', { x: t.to.x, pitch: 0.7, vol: 0.5 });
          sfx('lose', { x: t.to.x, vol: 0.4, delay: 0.1 });
          this.popText(t.to.x, t.to.y - 16, missHint(t.along, t.lat), '#ff6b5e', '8px');
          // Aufprall-Kreuz bleibt bis zum nächsten Zielen liegen – so sieht man, wie weit es daneben war
          const m = this.markGfx;
          m.lineStyle(2, 0x2d1b12, 0.6).lineBetween(t.to.x - 3, t.to.y - 2, t.to.x + 3, t.to.y + 2).lineBetween(t.to.x - 3, t.to.y + 2, t.to.x + 3, t.to.y - 2);
          m.lineStyle(1, 0xff6b5e, 1).lineBetween(t.to.x - 3, t.to.y - 2, t.to.x + 3, t.to.y + 2).lineBetween(t.to.x - 3, t.to.y + 2, t.to.x + 3, t.to.y - 2);
        }
        this.tweens.add({ targets: ball, alpha: 0, delay: 400, duration: 300, onComplete: () => ball.destroy() });
      },
    });
  }

  /** Flasche an ihren (neuen) Platz – beim Wiederaufstellen gleitet sie dorthin */
  private placeBottle(p: Point) {
    if (p.x === this.bottlePos.x && p.y === this.bottlePos.y) return;
    this.bottlePos = { ...p };
    this.tweens.add({ targets: this.bottle, x: p.x, y: p.y, duration: 260, ease: 'Quad.out' });
  }

  private setBottleDown(down: boolean, team: Team = 'A') {
    if (down === this.bottleDown || (this.flying && !down)) return;
    this.bottleDown = down;
    this.tweens.add({ targets: this.bottle, angle: down ? 90 * fwd(team) : 0, duration: 180, ease: 'Back.out' });
  }

  private gluck(a: Actor) {
    const now = this.time.now;
    if (now - a.lastGluck < 350) return;
    a.lastGluck = now;
    sfx('pop', { x: a.root.x, pitch: 0.5 + Math.random() * 0.2, vol: 0.45 });

    this.popText(a.root.x + Phaser.Math.Between(-6, 6), a.root.y - 40, 'gluck', C.white, '8px');
  }

  private popText(x: number, y: number, text: string, color: string, size: string) {
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: size, color })
      .setOrigin(0.5)
      .setShadow(1, 1, INK, 0, false, true)
      .setDepth(5000);
    this.tweens.add({ targets: t, y: y - 18, alpha: 0, duration: 900, ease: 'Quad.out', onComplete: () => t.destroy() });
  }
}

function lerpPt(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
