import Phaser from 'phaser';
import type { GameState, PlayerPublic } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { WR_ROLES, WR_WINNER, type WrState, wrSummary } from '../../shared/wolfrunde';
import { cottage, tree } from '../art/objects';
import { nightCottage, nightTree, paintWolfDay, paintWolfNight, wolfHead } from '../art/werwolf';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { GOLD, RED_INK, ensureTex, fitText, ink, nameTag, panel, tagName, txt } from './ui';
import { sfx } from './sfx';

/**
 * Werwolf mit Erzähler – der TV ist nur Kulisse: Nacht/Tag (schaltet der Erzähler), wer erzählt, wer noch lebt.
 * Er zeigt bis zum Spielende KEINE Karten – die kennt nur der Erzähler (und jeder seine eigene).
 * Bewusst wenig Text: Erzählen tut der Erzähler.
 */
export class WolfrundeScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private bgNight!: Phaser.GameObjects.Image;
  private bgDay!: Phaser.GameObjects.Image;
  private propsNight: Phaser.GameObjects.Image[] = [];
  private propsDay: Phaser.GameObjects.Image[] = [];
  private eyes!: Phaser.GameObjects.Container;
  private stateKey = '';
  private moodKey = '';
  /** Lebend-Stand beim letzten Render (pro Austeilen) – für Tod-/Wiederbeleben-Töne und den Grabstein-Hopser */
  private lastAlive: Record<string, boolean> = {};
  private lastDeal = -1;
  private fresh = new Set<string>();

  constructor() {
    super('wolfrunde');
  }

  create() {
    this.stateKey = '';
    this.moodKey = '';
    this.lastAlive = {};
    this.lastDeal = -1;
    this.fresh = new Set();
    this.propsNight = [];
    this.propsDay = [];

    const bg = (key: string, paint: (p: Pix) => void) =>
      this.add.image(0, 0, ensureTex(this, key, () => {
        const p = new Pix(WORLD.W, WORLD.H);
        paint(p);
        return p;
      })).setOrigin(0).setDepth(-1000);
    this.bgNight = bg('bg_wolf_night', paintWolfNight);
    this.bgDay = bg('bg_wolf_day', paintWolfDay);
    const place = (key: string, make: () => Pix, x: number, y: number, list: Phaser.GameObjects.Image[]) =>
      list.push(this.add.image(x, y, ensureTex(this, key, make)).setOrigin(0.5, 1).setDepth(-900 + y / 10));
    place('wolf_cottage_n', nightCottage, 52, 200, this.propsNight);
    place('wolf_cottage_d', cottage, 52, 200, this.propsDay);
    for (const [i, x, y] of [[1, 432, 200], [2, 462, 206], [3, 412, 210]] as const) {
      place(`wolf_tree_n${i}`, () => nightTree(i), x, y, this.propsNight);
      place(`wolf_tree_d${i}`, () => tree(i), x, y, this.propsDay);
    }
    this.eyes = this.add.container(0, 0).setDepth(-800);
    for (const [x, y] of [[118, 190], [372, 194], [452, 176]]) {
      const pair = this.add.container(x, y);
      pair.add([this.add.rectangle(0, 0, 2, 2, 0xffd25e), this.add.rectangle(5, 0, 2, 2, 0xffd25e)]);
      this.eyes.add(pair);
      this.tweens.add({ targets: pair, alpha: { from: 1, to: 0 }, duration: 160, yoyo: true, repeat: -1, repeatDelay: 1800 + x * 7 });
    }
    this.layer = this.add.container(0, 0).setDepth(950);
    panel(this, 6, 4, 468, 34).setDepth(900);
    ink(this, WORLD.W / 2, 15, 'WERWOLF', { color: RED_INK, size: 16 }).setDepth(901).setOrigin(0.5, 0.5).setY(21);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'wolfrunde') return;
    const w = s.mini.state;
    if (w.deal !== this.lastDeal) {
      this.lastDeal = w.deal;
      this.lastAlive = { ...w.alive };
    }
    this.sounds(w);
    const players = w.players.map((id) => playerById(id)).filter((p): p is PlayerPublic => !!p);
    const key = JSON.stringify([w.sub, w.narrator, w.time, w.round, w.deal, w.alive, w.winner, w.config, players.map((p) => [p.id, p.name, p.connected]), playerById(w.narrator)?.name]);
    if (key === this.stateKey) return;
    this.stateKey = key;

    const night = w.sub !== 'over' && w.time !== 'day';
    this.bgNight.setVisible(night);
    this.bgDay.setVisible(!night);
    for (const p of this.propsNight) p.setVisible(night);
    for (const p of this.propsDay) p.setVisible(!night);
    this.eyes.setVisible(w.sub === 'play' && w.time === 'night');

    this.layer.removeAll(true);
    const phase = w.sub === 'setup' ? 'Vorbereitung' : w.sub === 'over' ? 'Ende' : w.time === 'dusk' ? 'Karten' : w.time === 'night' ? `Nacht ${w.round}` : `Tag ${w.round}`;
    this.layer.add(ink(this, 14, 17, phase, { origin: [0, 0] }));
    if (w.narrator) this.layer.add(fitText(ink(this, 466, 17, `Erzähler: ${tagName(playerById(w.narrator)?.name ?? '?')}`, { origin: [1, 0] }), 150));

    if (w.sub === 'setup') this.renderSetup(w, players.length);
    else if (w.sub === 'over') this.renderOver(w);
    else this.renderPlay(w, players);
    this.renderRow(w, players);
  }

  private renderSetup(w: WrState, n: number) {
    this.layer.add(panel(this, 90, 52, 300, 116));
    const head = this.add.image(WORLD.W / 2, 74, ensureTex(this, 'wolf_head', wolfHead)).setScale(1.5);
    this.layer.add(head);
    this.tweens.add({ targets: head, angle: { from: -6, to: 6 }, duration: 700, yoyo: true, repeat: -1 });
    if (!w.narrator) {
      this.layer.add(ink(this, WORLD.W / 2, 100, 'WER ERZÄHLT?', { size: 16, color: RED_INK }));
      this.layer.add(ink(this, WORLD.W / 2, 126, 'Der VIP wählt am Handy.', { color: '#7a5a3a' }));
      return;
    }
    this.layer.add(fitText(ink(this, WORLD.W / 2, 98, tagName(playerById(w.narrator)?.name ?? '?'), { size: 16 }), 280));
    this.layer.add(ink(this, WORLD.W / 2, 120, 'mischt die Karten ...', { color: '#7a5a3a' }));
    this.layer.add(ink(this, WORLD.W / 2, 140, wrSummary(w.config, n), { color: '#2d64a8', wrap: 280 }));
  }

  private renderPlay(w: WrState, players: PlayerPublic[]) {
    const night = w.time !== 'day';
    this.layer.add(panel(this, 120, 60, 240, 92, night ? 'dark' : 'paper'));
    const text = (y: number, s: string, o: Parameters<typeof txt>[4] = {}) => this.layer.add(night ? txt(this, WORLD.W / 2, y, s, o) : ink(this, WORLD.W / 2, y, s, o));
    if (w.time === 'dusk') {
      text(76, 'KARTEN ANSEHEN', { size: 16, color: night ? GOLD : RED_INK });
      text(102, 'Heimlich – dann Handy weg.', { color: '#d6dcff' });
      text(122, wrSummary(w.config, players.length), { color: '#b9c3ff', wrap: 220 });
      return;
    }
    const alive = players.filter((p) => w.alive[p.id]).length;
    if (night) {
      const t = txt(this, WORLD.W / 2, 78, `NACHT ${w.round}`, { size: 24, color: GOLD });
      this.layer.add(t);
      this.tweens.add({ targets: t, alpha: { from: 1, to: 0.6 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      text(118, 'Augen zu.', { color: '#d6dcff' });
    } else {
      text(78, `TAG ${w.round}`, { size: 24, color: RED_INK });
      text(118, `${alive} von ${players.length} leben`, { color: '#7a5a3a' });
    }
  }

  private renderOver(w: WrState) {
    this.layer.add(panel(this, 70, 52, 340, 112));
    const wolf = w.winner === 'wolf';
    const t = ink(this, WORLD.W / 2, 64, w.winner ? WR_WINNER[w.winner].title.toUpperCase() : 'SPIEL VORBEI', { size: 16, color: wolf ? RED_INK : w.winner === 'liebe' ? '#b0306a' : '#2f7d32', wrap: 320 });
    this.layer.add(t);
    this.tweens.add({ targets: t, scale: { from: 1.25, to: 1 }, duration: 600, ease: 'Back.Out' });
    const wolves = w.players.filter((id) => w.roles?.[id] === 'werwolf').map((id) => tagName(playerById(id)?.name ?? '?'));
    if (wolves.length) {
      this.layer.add(ink(this, WORLD.W / 2, 100, wolves.length > 1 ? 'Die Werwölfe waren:' : 'Der Werwolf war:', {}));
      this.layer.add(ink(this, WORLD.W / 2, 116, wolves.join(' & '), { color: RED_INK, wrap: 320 }));
    } else this.layer.add(ink(this, WORLD.W / 2, 104, 'Kein Werwolf im Spiel!', { color: '#7a5a3a' }));
    const head = this.add.image(WORLD.W / 2, 148, ensureTex(this, 'wolf_head', wolfHead));
    this.layer.add(head);
    if (wolf) this.tweens.add({ targets: head, angle: { from: -8, to: 8 }, duration: 300, yoyo: true, repeat: -1 });
  }

  /** Alle mit Karte unten: Lebende stehen, Tote liegen unterm Grabstein. Karten erst am Ende. */
  private renderRow(w: WrState, players: PlayerPublic[]) {
    const n = players.length;
    const spacing = Math.min(38, 456 / Math.max(1, n));
    const tagW = spacing - 2;
    const sleeping = w.sub === 'play' && w.time === 'night';
    players.forEach((p, i) => {
      const x = WORLD.W / 2 + (i - (n - 1) / 2) * spacing;
      const y = 236;
      const alive = w.sub === 'setup' || w.alive[p.id];
      if (alive) {
        const f = figure(this, p.look, x, y, 2);
        if (!p.connected) f.setAlpha(0.4);
        this.layer.add(f);
      } else {
        const g = this.grave(x, y);
        if (this.fresh.has(p.id)) this.tweens.add({ targets: g, y: { from: -24, to: 0 }, duration: 420, ease: 'Bounce.Out' });
      }
      if (alive && sleeping) {
        const z = txt(this, x + 8, y - 40, 'z', { color: '#b9c3ff' });
        this.layer.add(z);
        this.tweens.add({ targets: z, y: y - 50, alpha: { from: 1, to: 0 }, duration: 1600, repeat: -1, delay: i * 170 });
      }
      this.layer.add(nameTag(this, x, y + 2, p.name, alive ? undefined : '#7a5a3a', tagW));
      const role = w.sub === 'over' ? w.roles?.[p.id] : undefined;
      if (role) this.layer.add(fitText(txt(this, x, y + 16, WR_ROLES[role].name.toUpperCase(), { color: role === 'werwolf' ? '#ff9a8a' : '#fff4d6' }), tagW));
    });
    this.fresh.clear();
  }

  private grave(x: number, y: number) {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.22).fillEllipse(x, y - 1, 30, 6);
    g.fillStyle(0x2d1b12).fillRoundedRect(x - 12, y - 30, 24, 30, { tl: 10, tr: 10, bl: 0, br: 0 });
    g.fillStyle(0xa7a39a).fillRoundedRect(x - 10, y - 28, 20, 28, { tl: 9, tr: 9, bl: 0, br: 0 });
    g.fillStyle(0xcfcbc1).fillRect(x - 8, y - 22, 3, 18);
    g.fillStyle(0x7f7b73).fillRect(x - 1, y - 24, 2, 12).fillRect(x - 5, y - 20, 10, 2);
    this.layer.add(g);
    return g;
  }

  /** Nacht/Tag-Jingle, dumpfer Ton beim Tod, heller beim Wiederbeleben, Fanfare am Ende */
  private sounds(w: WrState) {
    const mood = `${w.sub}-${w.time}-${w.round}-${w.deal}`;
    if (mood !== this.moodKey) {
      const first = this.moodKey === '';
      this.moodKey = mood;
      if (!first) {
        if (w.sub === 'over') sfx('fanfare');
        else if (w.sub === 'play' && w.time === 'night') {
          sfx('lose', { pitch: 0.5, vol: 0.6 });
          sfx('whoosh', { pitch: 0.4, vol: 0.5, delay: 0.4 });
        } else if (w.sub === 'play' && w.time === 'day') {
          sfx('powerup', { pitch: 0.9 });
          sfx('win', { pitch: 1.2, vol: 0.6, delay: 0.35 });
        } else if (w.sub === 'play') sfx('select');
      }
    }
    if (w.sub !== 'play') return;
    for (const [id, alive] of Object.entries(w.alive)) {
      const was = this.lastAlive[id];
      if (was === undefined || was === alive) continue;
      if (!alive) {
        this.fresh.add(id);
        sfx('bonk', { pitch: 0.6 });
        sfx('lose', { pitch: 0.7, vol: 0.5, delay: 0.15 });
      } else sfx('powerup', { pitch: 1.1, vol: 0.6 });
    }
    this.lastAlive = { ...w.alive };
  }
}
