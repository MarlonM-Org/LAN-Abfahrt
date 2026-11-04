import Phaser from 'phaser';
import type { GameState, PlayerPublic, TourState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { tourOutcomeText } from '../../shared/tourist';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintSand, paintSky, paintWater } from '../art/ground';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { BLUE_INK, Countdown, GREEN_INK, RED_INK, background, ink, nameTag, panel, prop, txt } from './ui';

const clock = (ms: number) => {
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

/**
 * Wer ist der Tourist? – der TV zeigt nur Öffentliches:
 * Rundenzeit, wer wen fragt, Anklagen und am Ende die Auflösung.
 */
export class TouristScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private timerBar!: Phaser.GameObjects.Graphics;
  private clockText!: Phaser.GameObjects.Text;
  private countdown = new Countdown();
  private total = 1;
  private phaseKey = '';
  private stateKey = '';
  private clockShown = '';

  constructor() {
    super('tourist');
  }

  create() {
    this.phaseKey = '';
    this.stateKey = '';
    this.clockShown = '';
    this.total = 1;
    background(this, 'tourist', WORLD.W, WORLD.H, (p) => {
      // Sonnenuntergang über dem Meer, Strand mit Strandbar
      paintSky(p, 0, 0, WORLD.W, 120, ['#f6b26b', '#f58a6b', '#d96a86', '#8e5a9e']);
      p.disc(240, 118, 26, '#ffd25e');
      p.disc(240, 118, 20, '#ffe08a');
      paintWater(p, 0, 112, WORLD.W, 44, 23);
      for (let i = 0; i < 9; i++) p.hline(214 + ((i * 7) % 40), 118 + i * 4, 18 - i, '#ffd25e');
      paintSand(p, 0, 152, WORLD.W, WORLD.H - 152, 29);
      p.hline(0, 152, WORLD.W, C.foam);
      // Strandbar-Hütte links
      p.rect(8, 150, 70, 54, C.woodDark);
      for (let x = 8; x < 78; x += 6) p.vline(x, 150, 54, C.woodDarker);
      p.rect(2, 140, 82, 12, '#d9b45a');
      for (let x = 2; x < 84; x += 4) p.vline(x, 140, 14, '#b48d3c');
      p.rect(14, 160, 58, 16, '#2a1a12');
    });
    prop(this, 'tour_palmL', () => O.palm(3), 98, 214).setDepth(-600);
    prop(this, 'tour_palmR', () => O.palm(8), 452, 206).setDepth(-600);
    prop(this, 'tour_umbR', () => O.umbrella(C.red, C.white), 412, 214).setDepth(-590);
    prop(this, 'tour_cocktailT', O.cocktail, 30, 160).setDepth(-580);
    prop(this, 'tour_cocktailT2', O.cocktail, 56, 160).setDepth(-580);

    this.layer = this.add.container(0, 0).setDepth(950);
    this.timerBar = this.add.graphics().setDepth(1000);
    panel(this, 6, 4, 468, 34).setDepth(900);
    ink(this, WORLD.W / 2, 11, 'WER IST DER TOURIST?', { color: RED_INK }).setDepth(901);
    this.clockText = ink(this, 462, 13, '', { size: 16, origin: [1, 0] }).setDepth(901);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  update() {
    const s = getState();
    const t = s?.mini?.kind === 'tourist' ? s.mini.state : null;
    this.timerBar.clear();
    if (!t) return;
    // Rundenuhr oben rechts: läuft nur in der Fragerunde, sonst Restzeit (pausiert)
    const label = t.sub === 'play' ? clock(this.countdown.remaining) : t.sub === 'vote' ? `${clock(t.roundLeft)}` : t.sub === 'intro' ? clock(t.roundMs) : '';
    if (label !== this.clockShown) {
      this.clockShown = label;
      this.clockText.setText(label);
      this.clockText.setColor(t.sub === 'play' && this.countdown.remaining < 60000 ? RED_INK : t.sub === 'vote' ? BLUE_INK : '#3d2414');
    }
    const frac = this.countdown.remaining / this.total;
    if (frac <= 0 || t.sub === 'reveal' || t.sub === 'over') return;
    this.timerBar.fillStyle(0x2d1b12).fillRect(12, 40, 456, 5);
    this.timerBar.fillStyle(t.sub === 'vote' ? 0x3f8fe0 : frac < 0.2 ? 0xe04a3f : 0xf0b13a).fillRect(13, 41, 454 * frac, 3);
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'tourist') return;
    const t = s.mini.state;
    const pk = `${t.sub}-${t.phaseNo}-${t.vote?.passed ?? ''}`;
    if (pk !== this.phaseKey) {
      this.phaseKey = pk;
      this.countdown.set(t.endsIn);
      this.total = Math.max(1, t.sub === 'play' ? t.roundMs : t.endsIn);
    }
    const players = s.players.filter((p) => p.id in t.points);
    const sKey = JSON.stringify([t.sub, t.round, t.phaseNo, t.asker, t.askSeq, t.vote, t.reveal?.outcome, t.points, t.accusers, players.map((p) => [p.name, p.connected])]);
    if (sKey === this.stateKey) return;
    this.stateKey = sKey;

    this.layer.removeAll(true);
    this.layer.add(ink(this, 14, 13, `Runde ${t.round}/${t.rounds}`, { origin: [0, 0] }));
    this.layer.add(ink(this, 14, 25, t.touristCount > 1 ? '2 Touristen!' : '1 Tourist', { origin: [0, 0], color: BLUE_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 23, t.sub === 'vote' ? 'Uhr angehalten' : 'Fragt euch reihum aus!', { color: '#7a5a3a' }));

    if (t.sub === 'intro') this.renderIntro(t);
    else if (t.sub === 'play') this.renderAsk(t);
    else if (t.sub === 'vote') this.renderVote(t);
    else if (t.sub === 'reveal') this.renderReveal(t);
    else {
      this.layer.add(panel(this, 120, 80, 240, 50));
      this.layer.add(ink(this, WORLD.W / 2, 92, 'Spiel vorbei!', { size: 16 }));
      this.layer.add(ink(this, WORLD.W / 2, 114, 'Gleich gibt’s die Punkte ...'));
    }
    this.renderRow(t, players);
  }

  private renderIntro(t: TourState) {
    this.layer.add(panel(this, 70, 56, 340, 100));
    this.layer.add(ink(this, WORLD.W / 2, 66, `RUNDE ${t.round}`, { size: 24, color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 100, 'Schaut heimlich auf eure Handys!', {}));
    this.layer.add(ink(this, WORLD.W / 2, 116, 'Nur der Tourist kennt den Ort nicht.', { color: '#7a5a3a' }));
    this.layer.add(ink(this, WORLD.W / 2, 136, `${playerById(t.asker)?.name ?? '?'} stellt die erste Frage`, { color: BLUE_INK }));
  }

  private renderAsk(t: TourState) {
    const from = playerById(t.lastAsk?.from ?? t.asker);
    const to = playerById(t.lastAsk?.to);
    this.layer.add(panel(this, 70, 50, 340, 120));
    if (from && to) {
      const line = `${from.name} fragt ${to.name}`;
      this.layer.add(ink(this, WORLD.W / 2, 60, line, { size: line.length <= 19 ? 16 : 8, wrap: 320 }));
      const fa = figure(this, from.look, 170, 148, 2.5);
      const fb = figure(this, to.look, 310, 148, 2.5);
      fb.setScale(-1, 1);
      this.layer.add([fa, fb]);
      this.tweens.add({ targets: fa.getData('img'), y: -4, duration: 220, yoyo: true, repeat: 3 });
      // Sprechblase mit Fragezeichen
      const g = this.add.graphics();
      g.fillStyle(0x2d1b12).fillRoundedRect(219, 94, 42, 28, 6).fillTriangle(226, 120, 236, 120, 210, 130);
      g.fillStyle(0xfff6dc).fillRoundedRect(221, 96, 38, 24, 5).fillTriangle(227, 118, 235, 118, 213, 127);
      this.layer.add(g);
      const qm = ink(this, 240, 100, '?', { size: 16, color: RED_INK });
      this.layer.add(qm);
      this.tweens.add({ targets: qm, angle: { from: -10, to: 10 }, duration: 400, yoyo: true, repeat: -1 });
      this.layer.add(ink(this, WORLD.W / 2, 156, `Danach fragt ${to.name}.`, { color: BLUE_INK }));
    } else {
      const name = from?.name ?? '?';
      this.layer.add(ink(this, WORLD.W / 2, 62, `${name} stellt die erste Frage`, { size: name.length <= 6 ? 16 : 8, wrap: 320 }));
      if (from) {
        const f = figure(this, from.look, 240, 146, 2.5);
        this.layer.add(f);
        this.tweens.add({ targets: f.getData('img'), y: -4, duration: 300, yoyo: true, repeat: -1 });
      }
      this.layer.add(ink(this, WORLD.W / 2, 154, 'Wen fragst du? Tippe es am Handy an.', { color: BLUE_INK }));
    }
  }

  private renderVote(t: TourState) {
    const v = t.vote!;
    const accuser = playerById(v.accuser);
    const accused = playerById(v.accused);
    this.layer.add(panel(this, 70, 50, 340, 120));
    this.layer.add(ink(this, WORLD.W / 2, 58, 'ANKLAGE!', { size: 16, color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 80, `${accuser?.name ?? '?'} verdächtigt ${accused?.name ?? '?'}`, { wrap: 320 }));
    if (accused) {
      const f = figure(this, accused.look, 240, 148, 2);
      this.layer.add(f);
      this.tweens.add({ targets: f.getData('img'), x: { from: -1.5, to: 1.5 }, duration: 70, yoyo: true, repeat: -1 });
    }
    const need = Object.keys(t.points).length - 2;
    if (v.passed === null) {
      this.layer.add(ink(this, 112, 104, 'Alle\nanderen\nstimmen\nab', { color: '#7a5a3a' }));
      this.layer.add(ink(this, 368, 104, `${v.voted.length}/${need}\nStimmen`, { color: BLUE_INK }));
      this.layer.add(ink(this, WORLD.W / 2, 154, 'Nur einstimmig fliegt der Verdacht auf!', { color: '#7a5a3a' }));
    } else {
      const res = v.passed ? 'Einstimmig!' : 'Abgelehnt!';
      this.layer.add(ink(this, 122, 110, res, { color: v.passed ? RED_INK : GREEN_INK }));
      this.layer.add(ink(this, 368, 110, `${v.yes} ja\n${v.no} nein`));
      this.layer.add(ink(this, WORLD.W / 2, 154, v.passed ? 'Wer ist es wirklich ...?' : 'Weiter geht’s – die Uhr läuft wieder!', { color: '#7a5a3a' }));
    }
  }

  private renderReveal(t: TourState) {
    const r = t.reveal!;
    const name = (id: string | null) => playerById(id)?.name ?? '?';
    this.layer.add(panel(this, 50, 50, 380, 118));
    const head = tourOutcomeText(r, name);
    this.layer.add(ink(this, WORLD.W / 2, 58, head, { color: RED_INK, wrap: 360 }));
    this.layer.add(ink(this, WORLD.W / 2, 82, 'Ihr wart hier:', { color: '#7a5a3a' }));
    const loc = ink(this, WORLD.W / 2, 94, r.location.toUpperCase(), { size: r.location.length <= 18 ? 16 : 8, color: BLUE_INK });
    this.layer.add(loc);
    this.tweens.add({ targets: loc, scale: { from: 1.15, to: 1 }, duration: 500, ease: 'Back.Out' });
    const n = r.touristen.length;
    r.touristen.forEach((id, i) => {
      const p = playerById(id);
      if (!p) return;
      const x = WORLD.W / 2 + (i - (n - 1) / 2) * 90;
      this.layer.add(figure(this, p.look, x - 34, 158, 2));
      this.layer.add(ink(this, x + 6, 132, `Tourist:\n${p.name}`, { origin: [0, 0], color: RED_INK }));
    });
  }

  /** Alle Spieler unten mit Punkten; der Fragende bekommt einen Pfeil, Punkte-Gewinne steigen auf */
  private renderRow(t: TourState, players: PlayerPublic[]) {
    const n = players.length;
    const spacing = Math.min(56, 440 / Math.max(1, n));
    const maxChars = Math.max(4, Math.floor(spacing / 8) - 1);
    players.forEach((p, i) => {
      const x = WORLD.W / 2 + (i - (n - 1) / 2) * spacing;
      const y = 232;
      const f = figure(this, p.look, x, y, 2);
      if (!p.connected) f.setAlpha(0.4);
      this.layer.add(f);
      const isAsker = t.sub === 'play' && t.asker === p.id;
      const accused = t.sub === 'vote' && t.vote?.accused === p.id;
      this.layer.add(nameTag(this, x, y + 2, p.name.slice(0, maxChars), isAsker ? BLUE_INK : accused ? RED_INK : undefined));
      this.layer.add(txt(this, x, y + 16, `${t.points[p.id] ?? 0} P.`, { color: '#fff4d6' }));
      if (isAsker) {
        const arrow = this.add.graphics();
        arrow.fillStyle(0x2d1b12).fillTriangle(x - 6, 176, x + 6, 176, x, 184);
        arrow.fillStyle(0xffd25e).fillTriangle(x - 4, 177, x + 4, 177, x, 182);
        this.layer.add(arrow);
        this.tweens.add({ targets: arrow, y: 4, duration: 300, yoyo: true, repeat: -1 });
      }
      if (t.sub === 'vote' && t.vote?.voted.includes(p.id)) {
        this.layer.add(ink(this, x, 178, 'OK', { color: GREEN_INK }).setBackgroundColor('#f7e4b5').setPadding(2, 1, 2, 1));
      }
      const gain = t.sub === 'reveal' ? (t.reveal?.gains[p.id] ?? 0) : 0;
      if (gain) {
        const g = txt(this, x, 182, `+${gain}`, { color: '#ffd25e' });
        this.layer.add(g);
        this.tweens.add({ targets: g, y: 172, duration: 900, ease: 'Sine.Out' });
      }
    });
  }
}
