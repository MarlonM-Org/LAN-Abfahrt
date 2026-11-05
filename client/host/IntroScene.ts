import Phaser from 'phaser';
import type { GameState, IntroState, MiniKind } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { MINI_HOWTO, MINI_INFO, ORIENT_TEXT, miniInspired } from '../../shared/games';
import { paintWoodFloor } from '../art/ground';
import { bus, getState, playerById } from './store';
import { GREEN_INK, INK, RED_INK, background, ink, panel, txt } from './ui';
import { figure } from './textures';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say } from './speech';
import { toLocalPerf } from '../timesync';
import { setScene } from './music';

/**
 * Regelkarte vor jedem Minispiel (Raum-Phase `intro`): Icon, Titel, „à la …“, Ziel-Satz, bis zu 3 Steuer-Kacheln
 * aus `MINI_HOWTO`, Haltung des Handys, darunter alle Mitspieler mit Häkchen „bereit“ und der Countdown.
 * Das Spiel startet, sobald alle bereit sind (spätestens nach 15 s, bekannte Spiele nach 5 s).
 */
export class IntroScene extends Phaser.Scene {
  private juice!: Juice;
  private kind: MiniKind | null = null;
  private card!: Phaser.GameObjects.Container;
  private crowd!: Phaser.GameObjects.Container;
  private timer!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private figs = new Map<string, { fig: Phaser.GameObjects.Container; check: Phaser.GameObjects.Graphics; ready: boolean }>();
  private crowdKey = '';
  private endsAt = 0;
  private short = false;

  constructor() {
    super('intro');
  }

  create() {
    this.kind = null;
    this.crowdKey = '';
    this.figs = new Map();
    this.endsAt = 0;
    this.short = false;
    this.juice = new Juice(this);
    background(this, 'intro_wood', WORLD.W, WORLD.H, (p) => paintWoodFloor(p, 0, 0, WORLD.W, WORLD.H, 23));
    this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x1a1008, 0.35).setOrigin(0).setDepth(-900);
    this.card = this.add.container(0, 0);
    this.crowd = this.add.container(0, 0);
    this.timer = txt(this, 452, 14, '', { size: 16, color: '#ffd25e', origin: [1, 0] }).setDepth(10);
    this.status = txt(this, WORLD.W / 2, 186, '', { color: '#fff4d6' }).setDepth(10);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  update() {
    if (!this.endsAt) return;
    const sec = Math.max(0, Math.ceil((toLocalPerf(this.endsAt) - performance.now()) / 1000));
    const t = String(sec);
    if (this.timer.text !== t) this.timer.setText(t);
  }

  private render(s: GameState) {
    const it = s.phase === 'intro' ? s.intro : null;
    if (!it) return;
    this.endsAt = it.endsAt;
    this.short = it.short;
    if (it.kind !== this.kind) this.buildCard(it.kind, it.short);
    this.renderCrowd(it);
  }

  /** Statische Regelkarte: Titel, Ziel, Steuer-Kacheln, Haltung */
  private buildCard(kind: MiniKind, short: boolean) {
    this.kind = kind;
    this.card.removeAll(true);
    const info = MINI_INFO[kind];
    const how = MINI_HOWTO[kind];
    // Musik des Spiels läuft schon während der Regelkarte
    setScene(kind);
    say(short ? `${info.title}!` : `${info.title}. Macht euch bereit!`);

    const c = this.card;
    c.add(panel(this, 12, 6, 456, 176));
    c.add(ink(this, 28, 14, '~ Regelkarte ~', { color: RED_INK, origin: [0, 0] }));
    const title = ink(this, WORLD.W / 2, 24, `${info.icon} ${info.title}`, { size: 16, wrap: 380 });
    c.add(title);
    let y = title.y + title.height + 3;
    const insp = miniInspired(kind);
    if (insp) {
      c.add(ink(this, WORLD.W / 2, y, insp, { color: '#7a5a3a' }));
      y += 12;
    }
    const goal = ink(this, WORLD.W / 2, y + 4, how.goal, { wrap: 420 });
    c.add(goal);
    y = Math.max(goal.y + goal.height + 8, 84);

    // Steuer-Kacheln (2–3 nebeneinander)
    const tiles = how.controls.slice(0, 3);
    const tw = 138;
    const gap = 9;
    const x0 = WORLD.W / 2 - (tiles.length * tw + (tiles.length - 1) * gap) / 2;
    const th = Math.min(60, 150 - y);
    tiles.forEach((ctl, i) => {
      const x = x0 + i * (tw + gap);
      c.add(panel(this, x, y, tw, th, 'dark'));
      c.add(txt(this, x + tw / 2, y + 6, ctl.icon, { size: 16 }));
      c.add(txt(this, x + tw / 2, y + 26, ctl.text, { wrap: tw - 14 }));
      const tile = c.list[c.list.length - 1] as Phaser.GameObjects.Text;
      tile.setAlpha(0);
      this.tweens.add({ targets: tile, alpha: 1, duration: 250, delay: 150 + i * 120 });
    });
    const orient = info.orientation;
    c.add(ink(this, WORLD.W / 2, y + th + 6, ORIENT_TEXT[orient], { color: orient === 'landscape' ? GREEN_INK : INK }));

    c.setScale(0.6).setAlpha(0);
    c.setPosition(WORLD.W * 0.2, 270 * 0.2);
    this.tweens.add({ targets: c, scale: 1, x: 0, y: 0, alpha: 1, duration: 380, ease: 'Back.out' });
    sfx('whoosh', { vol: 0.6 });
  }

  /** Alle Mitspieler unten, abgedunkelt bis „bereit“ (dann Häkchen + Hüpfer + Ton) */
  private renderCrowd(it: IntroState) {
    const key = it.ids.join(',');
    if (key !== this.crowdKey) {
      this.crowdKey = key;
      this.crowd.removeAll(true);
      this.figs.clear();
      const n = it.ids.length;
      const rows = n > 6 ? 2 : 1;
      const perRow = Math.ceil(n / rows);
      const step = Math.min(76, 456 / perRow);
      it.ids.forEach((id, i) => {
        const p = playerById(id);
        if (!p) return;
        const row = Math.floor(i / perRow);
        const inRow = Math.min(perRow, n - row * perRow);
        const x = WORLD.W / 2 + (i % perRow - (inRow - 1) / 2) * step;
        const feet = rows === 1 ? 240 : 224 + row * 34;
        const fig = figure(this, p.look, x, feet, 1);
        const name = txt(this, x, feet + 1, p.name);
        if (name.width > step - 4) name.setScale((step - 4) / name.width);
        const check = this.add.graphics();
        check.fillStyle(0x2f7d32).fillCircle(x + 9, feet - 26, 6).lineStyle(2, 0xffffff);
        check.lineBetween(x + 6, feet - 26, x + 8, feet - 23).lineBetween(x + 8, feet - 23, x + 12, feet - 29);
        check.setVisible(false);
        this.crowd.add([fig, name, check]);
        this.figs.set(id, { fig, check, ready: false });
      });
    }
    const s = getState();
    let fresh = 0;
    for (const [id, f] of this.figs) {
      const ready = it.ready.includes(id);
      const online = !!s?.players.find((p) => p.id === id)?.connected;
      f.fig.setAlpha(ready ? 1 : online ? 0.5 : 0.25);
      f.check.setVisible(ready);
      if (ready && !f.ready) {
        fresh++;
        this.tweens.add({ targets: f.fig, y: f.fig.y - 6, duration: 110, yoyo: true, ease: 'Quad.out' });
        this.juice.burst(f.fig.x, f.fig.y - 20, 'spark', 6);
      }
      f.ready = ready;
    }
    if (fresh) sfx('select', { pitch: 1 + Math.min(0.4, it.ready.length * 0.04) });
    const online = it.ids.filter((id) => s?.players.find((p) => p.id === id)?.connected);
    const nReady = online.filter((id) => it.ready.includes(id)).length;
    this.status.setText(
      this.short
        ? `Kennt ihr schon – gleich geht's los! (${nReady}/${online.length} bereit)`
        : `Am Handy üben, dann BEREIT drücken · ${nReady}/${online.length} bereit`,
    );
  }
}
