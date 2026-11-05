import Phaser from 'phaser';
import type { BoardAward, BoardDuel, BoardState, GameState, Point } from '../../shared/types';
import { BOARD_SIZE, BOARD_TIMING, FIELD_POS, FIELD_TYPES, FINALE_COCKTAILS, FINALE_KINDS, FORK_FIELD, ITEM_INFO, MERGE_FIELD, MINI_INFO, SHORTCUT_FIELDS, miniInspired } from '../../shared/games';
import { WORLD } from '../../shared/flunky';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintGrass, paintPath, paintWater } from '../art/ground';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { ensurePortrait, figure } from './textures';
import { GOLD, INK, RED_INK, background, ensureTex, ink, panel, prop, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';

const { STEP_MS, MOVE_LEAD_MS, TAXI_MS, DUEL_FLIP_MS } = BOARD_TIMING;
const GEM: Record<string, [string, 'q' | 's' | 'd' | 'b' | undefined]> = {
  start: [C.green, 's'],
  blue: [C.blue, undefined],
  red: [C.red, undefined],
  event: [C.orange, 'q'],
  shop: [C.purple, 'b'],
  duel: [C.pink, 'd'],
};
const ASK_ICON = { bar: '🍹', shop: '🛒', fork: '⇄' };

/** Tageszeit → Farbe des Multiply-Overlays (0 Morgen, 0.35 Mittag, 0.8 Sonnenuntergang, 1 Nacht) */
const DAY_KEYS: [number, number][] = [
  [0, 0xffe9d2],
  [0.35, 0xffffff],
  [0.6, 0xfff0d2],
  [0.8, 0xf8a878],
  [0.9, 0xa07a9a],
  [1, 0x5868a8],
];

function dayColor(t: number): Phaser.Display.Color {
  let i = 0;
  while (i < DAY_KEYS.length - 2 && t > DAY_KEYS[i + 1][0]) i++;
  const [t0, c0] = DAY_KEYS[i];
  const [t1, c1] = DAY_KEYS[i + 1];
  const k = Phaser.Math.Clamp((t - t0) / (t1 - t0 || 1), 0, 1);
  const a = Phaser.Display.Color.ValueToColor(c0);
  const b = Phaser.Display.Color.ValueToColor(c1);
  const o = Phaser.Display.Color.Interpolate.ColorWithColor(a, b, 100, k * 100);
  return new Phaser.Display.Color(o.r, o.g, o.b);
}

const BULB_COLORS = [0xff5a5a, 0xffd25e, 0x6ad06a, 0x6ab0ff, 0xf07aa8];

export class BoardScene extends Phaser.Scene {
  private tokens = new Map<string, Phaser.GameObjects.Container>();
  private animating = new Set<string>();
  private lastRollSeq = 0;
  private roundText!: Phaser.GameObjects.Text;
  private msgText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private scoreLayer!: Phaser.GameObjects.Container;
  private bar!: Phaser.GameObjects.Image;
  private arrow!: Phaser.GameObjects.Text;
  private introLayer!: Phaser.GameObjects.Container;
  private bonusLayer!: Phaser.GameObjects.Container;
  private duelLayer!: Phaser.GameObjects.Container;
  private askLayer!: Phaser.GameObjects.Container;
  /** Item-Symbol neben der Figur */
  private itemIcons = new Map<string, Phaser.GameObjects.Text>();
  private prevItems: Record<string, string | null> | null = null;
  private prevUsing: Record<string, string> = {};
  private askKey = '';
  private askMs = 0;
  private askAt = 0;
  private askText: Phaser.GameObjects.Text | null = null;
  private duelKey = '';
  private introShown = false;
  private scoreKey = '';
  private juice!: Juice;
  /** Für Münzen-/Cocktail-Effekte: letzter bekannter Stand (null = noch nicht gesehen) */
  private prevCoins: Record<string, number> | null = null;
  private prevCocktails: Record<string, number> | null = null;
  private prevRolls: Record<string, number> = {};
  private msgSeq = -1;
  /** Würfelfenster: Restzeit (Server schickt ~1×/s, dazwischen zählt der TV selbst) */
  private rollMs = 0;
  private rollAt = 0;
  private roundSeen = '';
  private bonusKey = '';
  // Tageszeit
  private dayOverlay!: Phaser.GameObjects.Rectangle;
  private dayT = -1;
  private dayTween: Phaser.Tweens.Tween | null = null;
  private sun!: Phaser.GameObjects.Container;
  private moon!: Phaser.GameObjects.Container;
  private nightLayer!: Phaser.GameObjects.Container;

  constructor() {
    super('board');
  }

  create() {
    this.tokens.clear();
    this.animating.clear();
    this.itemIcons.clear();
    this.prevItems = null;
    this.prevUsing = {};
    this.askKey = '';
    this.askMs = 0;
    this.askAt = 0;
    this.askText = null;
    this.duelKey = '';
    this.introShown = false;
    this.scoreKey = '';
    this.prevCoins = null;
    this.prevCocktails = null;
    this.prevRolls = {};
    this.msgSeq = -1;
    this.rollMs = 0;
    this.rollAt = 0;
    this.roundSeen = '';
    this.bonusKey = '';
    this.dayT = -1;
    this.dayTween = null;
    this.juice = new Juice(this, { depth: 2500 });
    const st = getState();
    this.lastRollSeq = st?.board?.lastRoll?.seq ?? 0;

    background(this, 'board', WORLD.W, WORLD.H, (p) => {
      paintGrass(p, 0, 0, WORLD.W, WORLD.H, 12);
      // Rundweg (geschlossen) + Abkürzung durch den Garten (Gabelung → Einmündung)
      paintPath(p, FIELD_POS.slice(0, BOARD_SIZE), 12, 14, true);
      paintPath(p, [FIELD_POS[FORK_FIELD], ...SHORTCUT_FIELDS.map((i) => FIELD_POS[i]), FIELD_POS[MERGE_FIELD]], 10, 9);
      // Kleiner Teich zwischen Abkürzung und unterer Reihe
      p.ellipse(260, 236, 30, 9, C.stoneDark);
      const water = new Pix(60, 18);
      paintWater(water, 0, 0, 60, 18, 4);
      const pond = new Pix(60, 18);
      pond.ellipse(30, 9, 28, 7, '#000');
      pond.overlayOn(() => pond.draw(water, 0, 0));
      p.draw(pond, 230, 227);
    });

    // Felder
    FIELD_POS.forEach((pt, i) => {
      const [gem, sym] = GEM[FIELD_TYPES[i]];
      prop(this, `field_${FIELD_TYPES[i]}`, () => O.fieldStone(gem, sym), pt.x, pt.y + 7).setDepth(pt.y - 20);
    });

    // Deko innerhalb des Rundwegs
    prop(this, 'cottage', O.cottage, 120, 186);
    prop(this, 'bush3', () => O.bush(3), 70, 120);
    prop(this, 'bush4', () => O.bush(4, true), 176, 118);
    prop(this, 'flowerPink', () => O.flower(C.pink), 64, 186);
    prop(this, 'flowerWhite', () => O.flower(C.white), 178, 190);
    prop(this, 'rock', () => O.rock(), 466, 200);
    // Wegweiser an der Abkürzung
    ink(this, 254, 203, 'Abkürzung', { color: '#7a5a3a' }).setDepth(100);
    prop(this, 'tree7', () => O.tree(7), 466, 46);
    prop(this, 'tree1', () => O.tree(1), 14, 46);

    this.bar = this.add.image(0, 0, ensureTex(this, 'cocktail', O.cocktail)).setOrigin(0.5, 1).setDepth(800);
    this.tweens.add({ targets: this.bar, scale: 1.15, duration: 500, yoyo: true, repeat: -1 });

    this.createDaytime();

    panel(this, 60, 0, 360, 58).setDepth(1000);
    this.roundText = ink(this, 72, 9, '', { origin: [0, 0], color: RED_INK }).setDepth(1001);
    this.timerText = ink(this, 408, 9, '', { origin: [1, 0], color: RED_INK }).setDepth(1001);
    this.msgText = ink(this, WORLD.W / 2, 22, '', { wrap: 336 }).setDepth(1001);
    this.scoreLayer = this.add.container(0, 0).setDepth(900);
    this.arrow = txt(this, 0, 0, 'v', { color: C.gold }).setDepth(950).setVisible(false);
    this.tweens.add({ targets: this.arrow, y: '+=3', duration: 300, yoyo: true, repeat: -1 });
    this.introLayer = this.add.container(0, 0).setDepth(3000);
    this.bonusLayer = this.add.container(0, 0).setDepth(3000);
    this.duelLayer = this.add.container(0, 0).setDepth(2900);
    this.askLayer = this.add.container(0, 0).setDepth(2100);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    if (st) this.render(st);
  }

  update() {
    const b = getState()?.board;
    if (!b) return;
    // Item-Symbole laufen mit den Figuren mit
    for (const [id, icon] of this.itemIcons) {
      const t = this.tokens.get(id);
      if (t) icon.setPosition(t.x + 9, t.y - 30).setDepth(t.depth + 1);
    }
    if (this.askText && b.ask) {
      const left = Math.max(0, Math.ceil((this.askMs - (this.time.now - this.askAt)) / 1000));
      this.askText.setText(`${ASK_ICON[b.ask.kind]} ${left}s`);
    }
    if (b.sub !== 'roll') return;
    const left = Math.max(0, Math.ceil((this.rollMs - (this.time.now - this.rollAt)) / 1000));
    const here = b.order.filter((id) => !playerById(id)?.removed);
    const done = here.filter((id) => id in b.rolls).length;
    this.timerText.setText(`Alle würfeln! ${done}/${here.length} · ${left}s`);
  }

  // ---------------------------------------------------------------- Tageszeit (Overlay, Sonne/Mond, Lichterkette)

  private createDaytime() {
    // Multiply-Overlay über der Welt (unter Tafel und HUD): Morgen warm, Mittag neutral, Abend orange, Nacht blau
    this.dayOverlay = this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0xffffff, 1).setOrigin(0).setDepth(850).setBlendMode(Phaser.BlendModes.MULTIPLY);

    // Sonne oben rechts – sinkt im Lauf des Abends und wird orange
    this.sun = this.add.container(438, 12).setDepth(860);
    const halo = this.add.circle(0, 0, 11, 0xffe680, 0.35).setBlendMode(Phaser.BlendModes.ADD);
    const rays = this.add.graphics();
    rays.fillStyle(0xffd25e, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      rays.fillRect(Math.round(Math.cos(a) * 9) - 1, Math.round(Math.sin(a) * 9) - 1, 2, 2);
    }
    const disc = this.add.circle(0, 0, 6, 0xffd25e).setStrokeStyle(1, 0xc0761f);
    this.sun.add([halo, rays, disc]);
    this.sun.setData('disc', disc);
    this.tweens.add({ targets: rays, angle: 360, duration: 12000, repeat: -1 });

    // Mond + Sterne oben links (nur nachts)
    this.moon = this.add.container(34, 14).setDepth(860).setAlpha(0);
    const glow = this.add.circle(0, 0, 10, 0xc8d4ff, 0.25).setBlendMode(Phaser.BlendModes.ADD);
    const moon = this.add.circle(0, 0, 6, 0xf4f0d8);
    const crater = this.add.circle(-2, 1, 1.5, 0xd8d2b0);
    this.moon.add([glow, moon, crater]);

    // Nachts: Sterne, leuchtende Fenster und eine Lichterkette über dem Ferienhaus
    this.nightLayer = this.add.container(0, 0).setDepth(860).setAlpha(0);
    const starPts = [[8, 6], [22, 30], [50, 8], [436, 34], [472, 6], [428, 6], [56, 30], [470, 26]];
    for (const [x, y] of starPts) {
      const s = this.add.rectangle(x, y, 1, 1, 0xffffff);
      this.nightLayer.add(s);
      this.tweens.add({ targets: s, alpha: 0.3, duration: 600 + ((x * 7) % 900), yoyo: true, repeat: -1 });
    }
    const x0 = 64, x1 = 176, y0 = 106, sag = 12;
    const line = this.add.graphics();
    line.lineStyle(1, 0x2d1b12, 0.8);
    line.beginPath();
    for (let x = x0; x <= x1; x += 4) {
      const k = (x - x0) / (x1 - x0);
      const y = y0 + Math.sin(k * Math.PI) * sag;
      if (x === x0) line.moveTo(x, y);
      else line.lineTo(x, y);
    }
    line.strokePath();
    this.nightLayer.add(line);
    let n = 0;
    for (let x = x0 + 6; x < x1 - 2; x += 9, n++) {
      const k = (x - x0) / (x1 - x0);
      const y = y0 + Math.sin(k * Math.PI) * sag + 2;
      const col = BULB_COLORS[n % BULB_COLORS.length];
      const g = this.add.circle(x, y, 4, col, 0.35).setBlendMode(Phaser.BlendModes.ADD);
      const bulb = this.add.rectangle(x, y, 2, 3, col);
      this.nightLayer.add([g, bulb]);
      this.tweens.add({ targets: g, alpha: 0.12, duration: 500 + (n % 3) * 220, yoyo: true, repeat: -1, delay: n * 90 });
    }
  }

  private applyDaytime(t: number) {
    const c = dayColor(t);
    this.dayOverlay.setFillStyle(c.color, 1);
    // Sonne sinkt von oben (Mittag) Richtung Horizont und wird rot; nachts weg
    const sunUp = t < 0.35 ? 0.6 + t : 1 - (t - 0.35) * 1.4;
    this.sun.setPosition(438, 30 - sunUp * 20);
    this.sun.setAlpha(Phaser.Math.Clamp((0.92 - t) / 0.08, 0, 1));
    const disc = this.sun.getData('disc') as Phaser.GameObjects.Arc;
    const sc = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0xffd25e), Phaser.Display.Color.ValueToColor(0xff6a3a), 100, Phaser.Math.Clamp((t - 0.4) / 0.4, 0, 1) * 100,
    );
    disc.setFillStyle(Phaser.Display.Color.GetColor(sc.r, sc.g, sc.b));
    const night = Phaser.Math.Clamp((t - 0.82) / 0.15, 0, 1);
    this.moon.setAlpha(night);
    // Lichterkette ab Sonnenuntergang
    this.nightLayer.setAlpha(Phaser.Math.Clamp((t - 0.7) / 0.25, 0, 1));
  }

  private renderDaytime(b: BoardState) {
    const t = Phaser.Math.Clamp(b.timeOfDay ?? 0, 0, 1);
    if (t === this.dayT) return;
    const from = this.dayT < 0 ? t : this.dayT;
    this.dayT = t;
    this.dayTween?.stop();
    const o = { v: from };
    this.applyDaytime(from);
    this.dayTween = this.tweens.add({ targets: o, v: t, duration: from === t ? 1 : 2500, ease: 'Sine.inOut', onUpdate: () => this.applyDaytime(o.v) });
  }

  // ---------------------------------------------------------------- Figuren & Zustand

  private tokenOffset(id: string, order: string[]): Point {
    const k = Math.max(0, order.indexOf(id));
    return { x: ((k % 4) - 1.5) * 5, y: -Math.floor(k / 4) * 4 };
  }

  private posFor(field: number, id: string, order: string[]): Point {
    const p = FIELD_POS[field];
    const o = this.tokenOffset(id, order);
    return { x: p.x + o.x, y: p.y + 4 + o.y };
  }

  private render(s: GameState) {
    const b = s.board;
    if (!b) return;

    for (const id of b.order) {
      const p = playerById(id);
      if (!p) continue;
      let t = this.tokens.get(id);
      if (!t) {
        const start = this.posFor(b.pos[id], id, b.order);
        t = figure(this, p.look, start.x, start.y);
        this.tokens.set(id, t);
      }
      t.setAlpha(p.connected ? 1 : 0.45);
      if (!this.animating.has(id)) {
        const target = this.posFor(b.pos[id], id, b.order);
        t.setPosition(target.x, target.y);
      }
      t.setDepth(t.y);
    }

    if (b.lastRoll && b.lastRoll.seq !== this.lastRollSeq) {
      this.lastRollSeq = b.lastRoll.seq;
      this.animateRoll(b);
    }

    const bp = FIELD_POS[b.barField];
    this.bar.setPosition(bp.x, bp.y - 4).setDepth(bp.y + 30);

    this.roundText.setText(`Runde ${Math.min(b.round, b.maxRounds)}/${b.maxRounds}${b.double && b.sub !== 'bonus' ? '  x2' : ''}`);
    if (b.sub === 'roll') {
      if (b.rollMs !== this.rollMs) {
        this.rollMs = b.rollMs;
        this.rollAt = this.time.now;
      }
    } else {
      this.timerText.setText('');
    }
    this.msgText.setText(b.message);

    const curId = b.order[b.turnIdx];
    const tok = curId ? this.tokens.get(curId) : undefined;
    this.arrow.setVisible(b.sub === 'moving' && !!tok && b.lastRoll?.playerId === curId);
    if (tok) this.arrow.setPosition(tok.x, tok.y - 40);

    this.roundFx(b);
    this.rollFx(b);
    this.renderDaytime(b);
    this.renderScores(b);
    this.renderItems(b);
    this.renderAsk(b);
    this.renderDuel(b);
    this.renderIntro(b);
    this.renderBonus(b);
    this.changeFx(b);
  }

  // ---------------------------------------------------------------- Items, Entscheidungen, Duell

  /** Item-Symbol neben der Figur; neues Item / Einsatz / Verbrauch mit Ton und schwebendem Text */
  private renderItems(b: BoardState) {
    const items = b.items ?? {};
    for (const id of b.order) {
      const item = items[id] ?? null;
      let icon = this.itemIcons.get(id);
      if (item && !icon) {
        icon = txt(this, 0, 0, ITEM_INFO[item].icon, { size: 8 }).setDepth(2000);
        this.itemIcons.set(id, icon);
      }
      if (icon) {
        if (!item) {
          icon.destroy();
          this.itemIcons.delete(id);
        } else if (icon.text !== ITEM_INFO[item].icon) icon.setText(ITEM_INFO[item].icon);
      }
      const t = this.tokens.get(id);
      const x = t?.x ?? 240, y = (t?.y ?? 140) - 40;
      const prev = this.prevItems?.[id] ?? null;
      if (this.prevItems && item && item !== prev) {
        sfx('powerup', { x, vol: 0.7 });
        this.juice.float(x, y, `${ITEM_INFO[item].icon} ${ITEM_INFO[item].title}`, 'gold');
      } else if (this.prevItems && !item && prev === 'schild' && !b.using?.[id]) {
        sfx('pop', { x });
        this.juice.float(x, y, '🧴 ABGEPRALLT!', 'heal');
      }
      const use = b.using?.[id];
      if (use && this.prevUsing[id] !== use) {
        sfx('select', { x, pitch: 1.2 });
        this.juice.float(x, y, use === 'dice2' ? '🎲🎲 DOPPELWÜRFEL' : use === 'taxi' ? '🚕 TAXI!' : '🦜 KLAU!', 'info');
      }
    }
    this.prevItems = { ...items };
    this.prevUsing = { ...(b.using ?? {}) };
  }

  /** Sprechblase über dem Spieler, der gerade am Handy entscheidet (Bar, Laden, Gabelung) */
  private renderAsk(b: BoardState) {
    const a = b.sub === 'moving' ? b.ask : null;
    const key = a ? `${a.seq}` : '';
    if (a && (a.ms !== this.askMs || key !== this.askKey)) {
      this.askMs = a.ms;
      this.askAt = this.time.now;
    }
    if (key === this.askKey) return;
    this.askKey = key;
    this.askLayer.removeAll(true);
    this.askText = null;
    if (!a) return;
    const t = this.tokens.get(a.playerId);
    const x = Phaser.Math.Clamp(t?.x ?? 240, 40, WORLD.W - 40);
    const y = Math.max(70, (t?.y ?? 140) - 46);
    const bubble = this.add.container(x, y);
    bubble.add(panel(this, -30, -11, 60, 22));
    this.askText = ink(this, 0, -4, `${ASK_ICON[a.kind]} ${Math.ceil(a.ms / 1000)}s`, { color: RED_INK });
    bubble.add(this.askText);
    bubble.setScale(0.2);
    this.tweens.add({ targets: bubble, scale: 1, duration: 260, ease: 'Back.out' });
    this.askLayer.add(bubble);
    sfx('tick', { x, vol: 0.6 });
    const name = spokenName(playerById(a.playerId)?.name);
    say(a.kind === 'bar' ? `${name}: Cocktail für ${a.price} Münzen?` : a.kind === 'shop' ? `${name} im Strandladen.` : `${name}: Abkürzung oder langer Weg?`);
  }

  /** Duell „Teilen oder Klauen“: Karte mit beiden Porträts; beim Aufdecken drehen sich die Karten nacheinander um */
  private renderDuel(b: BoardState) {
    const d = b.sub === 'moving' ? b.duel : null;
    const key = d ? `${d.seq}-${d.sub}` : '';
    if (key === this.duelKey) {
      // Wahl-Haken aktualisieren
      if (d?.sub === 'choose') for (const id of [d.a, d.b]) (this.duelLayer.getByName(`chk-${id}`) as Phaser.GameObjects.Text | null)?.setVisible(d.chosen.includes(id));
      return;
    }
    const prev = this.duelKey;
    this.duelKey = key;
    this.duelLayer.removeAll(true);
    if (!d) return;
    const na = playerById(d.a)?.name ?? '?', nb = playerById(d.b)?.name ?? '?';
    const card = this.duelCard(d);
    if (d.sub === 'choose') {
      card.setScale(0.2);
      this.tweens.add({ targets: card, scale: 1, duration: 420, ease: 'Back.out' });
      sfx('whistle', { vol: 0.7 });
      say(`Duell um ${d.pot} Münzen: ${spokenName(na)} gegen ${spokenName(nb)}. Teilen oder klauen?`);
      return;
    }
    if (d.sub === 'reveal') {
      sfx('drumroll');
      say('Die Karten werden aufgedeckt.');
      // Nacheinander umdrehen – der Server verteilt die Münzen nach DUEL_REVEAL_MS
      [d.a, d.b].forEach((id, i) => {
        this.time.delayedCall(DUEL_FLIP_MS * (i + 1), () => {
          if (this.duelKey !== key) return;
          const back = this.duelLayer.getByName(`back-${id}`) as Phaser.GameObjects.Container | null;
          const face = this.duelLayer.getByName(`face-${id}`) as Phaser.GameObjects.Container | null;
          if (!back || !face) return;
          this.tweens.add({ targets: back, scaleX: 0, duration: 160, onComplete: () => {
            back.setVisible(false);
            face.setVisible(true).setScale(0, 1);
            this.tweens.add({ targets: face, scaleX: 1, duration: 160 });
            const steal = d.picks?.[id] === 'steal';
            sfx(steal ? 'crack' : 'select', { x: 240 + (i ? 70 : -70), pitch: steal ? 0.8 : 1.1 });
            say(`${spokenName(playerById(id)?.name)}: ${steal ? 'klauen!' : 'teilen.'}`);
          } });
        });
      });
      return;
    }
    // done: Ergebnis
    const pa = d.picks?.[d.a], pb = d.picks?.[d.b];
    if (pa === 'share' && pb === 'share') {
      sfx('cheer', { vol: 0.7 });
      this.juice.burst(WORLD.W / 2, 120, 'confetti', 40);
    } else if (pa === 'steal' && pb === 'steal') {
      sfx('lose');
      this.juice.shake(2);
    } else {
      sfx('boom', { vol: 0.8 });
      this.juice.shake(2);
      this.juice.flash(0xffffff, 120);
    }
    if (prev) say(d.result ?? '');
  }

  private duelCard(d: BoardDuel) {
    const bg = this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x1a0818, 0.5).setOrigin(0);
    const card = this.add.container(WORLD.W / 2, WORLD.H / 2 + 4);
    card.add(panel(this, -160, -78, 320, 156));
    card.add(ink(this, 0, -66, `~ Duell um ${d.pot} Münzen ~`, { color: RED_INK }));
    card.add(ink(this, 0, -50, 'TEILEN oder KLAUEN?', { size: 16 }));
    [d.a, d.b].forEach((id, i) => {
      const p = playerById(id);
      const px = i ? 70 : -70;
      if (p) {
        card.add(this.add.image(px, 8, ensurePortrait(this, p.look)).setOrigin(0.5, 1).setScale(2));
        card.add(ink(this, px, 12, p.name.slice(0, 10)));
      }
      // Karte: Rückseite („?“) und Vorderseite (Wahl) – die Vorderseite erst beim Aufdecken
      const back = this.add.container(px, 44).setName(`back-${id}`);
      back.add(this.add.rectangle(0, 0, 52, 26, 0x3d2414).setStrokeStyle(2, 0x2d1b12));
      back.add(txt(this, 0, -5, '?', { size: 8, color: GOLD }));
      const chk = txt(this, 20, -14, '✓', { size: 8, color: '#7fd47f' }).setName(`chk-${id}`).setVisible(d.chosen.includes(id));
      back.add(chk);
      const steal = d.picks?.[id] === 'steal';
      const face = this.add.container(px, 44).setName(`face-${id}`).setVisible(d.sub === 'done');
      face.add(this.add.rectangle(0, 0, 52, 26, steal ? 0xc0392b : 0x46b04a).setStrokeStyle(2, 0x2d1b12));
      face.add(txt(this, 0, -5, steal ? 'KLAUEN' : 'TEILEN', { size: 8 }));
      if (d.sub === 'done') back.setVisible(false);
      card.add([back, face]);
    });
    card.add(ink(this, 0, 64, d.sub === 'done' ? d.result ?? '' : d.sub === 'reveal' ? 'Aufdecken …' : 'Beide wählen geheim am Handy', { color: d.sub === 'done' ? RED_INK : '#7a5a3a', wrap: 300 }));
    this.duelLayer.add([bg, card]);
    return card;
  }

  /** Neue Runde: Endspurt-Banner, Nachzügler begrüßen */
  private roundFx(b: BoardState) {
    if (b.sub !== 'roll') return;
    const key = `${b.round}/${b.maxRounds}`;
    if (key === this.roundSeen) return;
    const first = this.roundSeen === '';
    this.roundSeen = key;
    if (b.double) {
      const last = b.round === b.maxRounds;
      this.juice.banner(last ? 'LETZTE RUNDE!' : 'ENDSPURT!', 'Doppelte Münzen auf allen Feldern', 1800);
      sfx('drumroll', { vol: 0.7 });
      say(last ? 'Letzte Runde! Doppelte Münzen!' : 'Endspurt! Doppelte Münzen!');
    } else if (!first) {
      say(`Runde ${b.round}. Alle würfeln!`);
    }
    for (const id of b.joined ?? []) {
      const t = this.tokens.get(id);
      if (!t) continue;
      this.juice.burst(t.x, t.y - 10, 'confetti', 20);
      this.juice.float(t.x, t.y - 44, 'NEU!', '#7fd47f');
      say(`${spokenName(playerById(id)?.name)} steigt ein!`);
    }
  }

  /** Würfelfenster: wer würfelt, bekommt die Augenzahl kurz über der Figur */
  private rollFx(b: BoardState) {
    const rolls = b.sub === 'roll' ? b.rolls : {};
    for (const [id, v] of Object.entries(rolls)) {
      if (this.prevRolls[id] === v || !v) continue;
      const t = this.tokens.get(id);
      if (t) {
        this.juice.float(t.x, t.y - 40, String(v), 'gold');
        sfx('select', { x: t.x, pitch: 0.9 + v * 0.04, vol: 0.7 });
      }
    }
    this.prevRolls = { ...rolls };
  }

  /** Münzen +/−, Cocktails und Ereignistexte: Ton + schwebende Zahl über der Figur */
  private changeFx(b: BoardState) {
    if (this.msgSeq >= 0 && b.messageSeq !== this.msgSeq && b.sub !== 'intro' && b.sub !== 'bonus') sfx('pop', { vol: 0.6 });
    this.msgSeq = b.messageSeq;
    const coins = this.prevCoins;
    const cocktails = this.prevCocktails;
    this.prevCoins = { ...b.coins };
    this.prevCocktails = { ...b.cocktails };
    if (!coins || !cocktails) return;
    // Bonus-Karten haben eigene Effekte (renderBonus)
    const bonusCard = b.sub === 'bonus' && !!b.bonus?.shown;
    const champs: string[] = [];
    for (const id of b.order) {
      const tok = this.tokens.get(id);
      const x = tok?.x ?? 240;
      const y = (tok?.y ?? 140) - 34;
      const dc = (b.coins[id] ?? 0) - (coins[id] ?? 0);
      const dk = (b.cocktails[id] ?? 0) - (cocktails[id] ?? 0);
      if (dk > 0 && !bonusCard) {
        sfx('fanfare');
        this.juice.burst(x, y + 10, 'confetti', 40);
        this.juice.float(x, y - 10, `+${dk} COCKTAIL${dk > 1 ? 'S' : ''}`, '#f07aa8');
        if (b.sub === 'bonus') champs.push(spokenName(playerById(id)?.name));
        else say(`${spokenName(playerById(id)?.name)} holt einen Cocktail!`);
      } else if (dk < 0) {
        sfx('lose', { vol: 0.8 });
        this.juice.float(x, y - 10, `${dk} COCKTAIL`, 'dmg');
      }
      if (dc > 0 && id in coins) {
        for (let i = 0; i < Math.min(5, dc); i++) sfx('coin', { x, pitch: 1 + i * 0.04, delay: i * 0.08, vol: 0.8 });
        this.juice.float(x, y, `+${dc}`, 'gold');
        this.juice.burst(x, y + 14, 'spark', 6);
      } else if (dc < 0) {
        sfx('error', { x });
        this.juice.float(x, y, `${dc}`, 'dmg');
      }
    }
    if (champs.length) say(`${champs.join(' und ')} ${champs.length > 1 ? 'gewinnen' : 'gewinnt'} das Finale! Je ${FINALE_COCKTAILS} Cocktails.`);
  }

  private renderScores(b: BoardState) {
    const rolling = b.sub === 'roll';
    const key = JSON.stringify([b.order, b.coins, b.cocktails, b.sub, b.turnIdx, b.items, rolling ? b.rolls : null]);
    if (key === this.scoreKey) return;
    this.scoreKey = key;
    this.scoreLayer.removeAll(true);
    const sorted = [...b.order].sort((a, c) => b.cocktails[c] - b.cocktails[a] || b.coins[c] - b.coins[a]);
    // Ab 7 Spielern: zwei Spalten, sonst ragt die Tafel über die Abkürzung
    const cols = sorted.length > 6 ? 2 : 1;
    const perCol = Math.ceil(sorted.length / cols);
    const colW = cols === 2 ? 128 : 200;
    const x = cols === 2 ? 168 : 214, y = 92, w = cols === 2 ? colW * 2 + 4 : 200;
    const coinX = cols === 2 ? 98 : 136, cocktailX = cols === 2 ? 116 : 172;
    const h = 26 + perCol * 14;
    this.scoreLayer.add(panel(this, x, y, w, h));
    for (let c = 0; c < cols; c++) {
      this.scoreLayer.add(this.add.image(x + c * colW + coinX, y + 13, ensureTex(this, 'coin', O.coinIcon)));
      this.scoreLayer.add(this.add.image(x + c * colW + cocktailX, y + 16, ensureTex(this, 'cocktail', O.cocktail)).setScale(0.8));
    }
    const mover = b.sub === 'moving' ? b.order[b.turnIdx] : null;
    sorted.forEach((id, i) => {
      const p = playerById(id);
      if (!p) return;
      const cx = x + Math.floor(i / perCol) * colW;
      const ry = y + 22 + (i % perCol) * 14;
      this.scoreLayer.add(this.add.image(cx + 16, ry + 13, ensurePortrait(this, p.look)).setOrigin(0.5, 1));
      this.scoreLayer.add(ink(this, cx + 26, ry + 3, p.name.slice(0, cols === 2 ? 6 : 9), { origin: [0, 0], color: mover === id ? RED_INK : INK }));
      const item = b.items?.[id];
      if (item) this.scoreLayer.add(txt(this, cx + (cols === 2 ? 82 : 110), ry + 2, ITEM_INFO[item].icon, { size: 8, shadow: false }));
      this.scoreLayer.add(ink(this, cx + coinX, ry + 3, String(b.coins[id])));
      this.scoreLayer.add(ink(this, cx + cocktailX, ry + 3, String(b.cocktails[id]), { color: '#b0306a' }));
      // Würfelfenster: kleiner Würfel mit Augenzahl bzw. „?“ für alle, die noch nicht gewürfelt haben
      if (rolling && !p.removed) {
        const v = b.rolls[id];
        const dx = cx + (cols === 2 ? 76 : 112);
        const rolled = id in b.rolls;
        this.scoreLayer.add(this.add.rectangle(dx, ry + 6, 11, 11, rolled ? 0xfff4d6 : 0xd9c39a).setStrokeStyle(1, 0x3d2414));
        // 0 = Taxi statt Würfel
        this.scoreLayer.add(ink(this, dx, ry + 2, rolled ? (v ? String(v) : '🚕') : '?', { color: rolled ? RED_INK : '#7a5a3a' }));
      }
    });
  }

  private renderIntro(b: BoardState) {
    if (b.sub !== 'intro' || !b.nextMini) {
      this.introLayer.removeAll(true);
      this.introShown = false;
      return;
    }
    if (this.introShown) return;
    this.introShown = true;
    const info = MINI_INFO[b.nextMini];
    const isFinale = b.round === b.maxRounds && FINALE_KINDS.includes(b.nextMini);
    const bg = this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x1a1008, 0.6).setOrigin(0);
    const card = this.add.container(WORLD.W / 2, WORLD.H / 2);
    card.add(panel(this, -170, -70, 340, 140));
    card.add(ink(this, 0, -54, isFinale ? `~ FINALE · Sieger +${FINALE_COCKTAILS} Cocktails ~` : '~ Minispiel ~', { color: RED_INK }));
    const title = ink(this, 0, -36, `${info.icon} ${info.title}`, { size: 16, wrap: 310 });
    card.add(title);
    // Lange Titel brechen um → „à la …“ und Tagline darunter anordnen
    let y = title.y + title.height + 3;
    const insp = miniInspired(b.nextMini);
    if (insp) {
      card.add(ink(this, 0, y, insp, { color: '#7a5a3a' }));
      y += 13;
    }
    card.add(ink(this, 0, Math.max(y + 4, 10), info.tagline, { wrap: 290 }));
    card.add(ink(this, 0, 46, 'Schaut auf eure Handys!', { color: '#7a5a3a' }));
    this.introLayer.add([bg, card]);
    card.setScale(0.2);
    this.tweens.add({ targets: card, scale: 1, duration: 450, ease: 'Back.out' });
  }

  // ---------------------------------------------------------------- Bonus-Cocktails am Ende

  private renderBonus(b: BoardState) {
    const bonus = b.sub === 'bonus' ? b.bonus : null;
    if (!bonus) {
      if (this.bonusKey) this.bonusLayer.removeAll(true);
      this.bonusKey = '';
      return;
    }
    const key = `${bonus.shown}-${bonus.revealed}`;
    if (key === this.bonusKey) return;
    const prev = this.bonusKey;
    this.bonusKey = key;
    if (bonus.shown === 0) {
      if (!prev) {
        this.juice.banner('BONUS-COCKTAILS!', bonus.awards.length ? 'Wer bekommt die Extra-Cocktails?' : 'Heute ohne Bonus', 2000);
        sfx('cheer', { vol: 0.6 });
        say('Und jetzt: die Bonus-Cocktails!');
      }
      return;
    }
    const award = bonus.awards[bonus.shown - 1];
    if (!bonus.revealed) {
      this.bonusLayer.removeAll(true);
      this.bonusCard(award, bonus.shown, bonus.awards.length, false);
      sfx('drumroll');
      return;
    }
    this.bonusLayer.removeAll(true);
    this.bonusCard(award, bonus.shown, bonus.awards.length, true);
    sfx('fanfare');
    this.juice.burst(WORLD.W / 2, 110, 'confetti', 60);
    this.cameras.main.shake(180, 0.004);
    const names = award.winners.map((id) => spokenName(playerById(id)?.name));
    say(`${award.title}: ${names.join(' und ')}! Plus ein Cocktail.`);
    for (const id of award.winners) {
      const t = this.tokens.get(id);
      if (t) this.juice.float(t.x, t.y - 44, '+1 COCKTAIL', '#f07aa8');
    }
  }

  private bonusCard(a: BoardAward, idx: number, total: number, revealed: boolean) {
    const bg = this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x0a0818, 0.55).setOrigin(0);
    const card = this.add.container(WORLD.W / 2, WORLD.H / 2 + 6);
    card.add(panel(this, -160, -82, 320, 164));
    card.add(ink(this, 0, -70, `~ Bonus-Cocktail ${idx}/${total} ~`, { color: RED_INK }));
    card.add(ink(this, 0, -54, a.title, { size: 16 }));
    card.add(ink(this, 0, -32, a.desc, { color: '#7a5a3a' }));
    if (!revealed) {
      const q = ink(this, 0, 0, '? ? ?', { size: 24 });
      card.add(q);
      this.tweens.add({ targets: q, scale: 1.15, duration: 160, yoyo: true, repeat: -1 });
    } else {
      const n = a.winners.length;
      const shown = a.winners.slice(0, 6);
      const gap = Math.min(48, 280 / Math.max(1, shown.length));
      shown.forEach((id, i) => {
        const p = playerById(id);
        if (!p) return;
        const px = (i - (shown.length - 1) / 2) * gap;
        const img = this.add.image(px, 22, ensurePortrait(this, p.look)).setOrigin(0.5, 1).setScale(n > 3 ? 1.5 : 2);
        card.add(img);
        card.add(ink(this, px, 26, p.name.slice(0, n > 3 ? 6 : 10)));
        img.setScale(0.2);
        this.tweens.add({ targets: img, scale: n > 3 ? 1.5 : 2, duration: 380, ease: 'Back.out', delay: i * 80 });
      });
      if (n > shown.length) card.add(ink(this, 0, 38, `+${n - shown.length} weitere`, { color: '#7a5a3a' }));
      const tie = a.tied?.filter((id) => !a.winners.includes(id)) ?? [];
      card.add(ink(this, 0, 50, tie.length ? `${a.value} ${a.unit} – Gleichstand mit ${tie.map((id) => playerById(id)?.name.slice(0, 8) ?? '?').join(', ')}, der Rückstand bekommt ihn` : `${a.value} ${a.unit}`, { color: '#7a5a3a', wrap: 300 }));
      card.add(txt(this, 0, 64, `+1 COCKTAIL${n > 1 ? ' für jeden' : ''}`, { color: GOLD }));
    }
    this.bonusLayer.add([bg, card]);
    if (!revealed) {
      card.setScale(0.2);
      this.tweens.add({ targets: card, scale: 1, duration: 420, ease: 'Back.out' });
    }
  }

  private animateRoll(b: BoardState) {
    const roll = b.lastRoll!;
    const tok = this.tokens.get(roll.playerId);
    if (!tok || !roll.path.length) return;
    this.animating.add(roll.playerId);

    if (roll.kind === 'taxi') {
      // Ein großer Hüpfer direkt zur Bar
      const p = this.posFor(roll.path[roll.path.length - 1], roll.playerId, b.order);
      sfx('whoosh', { x: tok.x });
      this.juice.burst(tok.x, tok.y, 'puff', 8);
      this.tweens.add({ targets: tok, x: p.x, duration: TAXI_MS - 80, ease: 'Sine.inOut' });
      this.tweens.add({ targets: tok, y: p.y - 40, duration: (TAXI_MS - 80) / 2, ease: 'Quad.out', yoyo: true, onComplete: () => {
        tok.setPosition(p.x, p.y);
        this.juice.burst(p.x, p.y, 'sand', 8);
        sfx('bonk', { x: p.x, vol: 0.6 });
        this.animating.delete(roll.playerId);
      } });
      return;
    }

    const lead = roll.kind === 'cont' ? 0 : MOVE_LEAD_MS;
    if (roll.kind === 'roll') {
      // Würfel über der Figur – die Augenzahl steht schon fest (Würfelfenster), nur kurz aufpoppen
      const dice = this.add.container(Phaser.Math.Clamp(tok.x, 30, WORLD.W - 30), Math.max(78, tok.y - 52)).setDepth(2000);
      dice.add(panel(this, -13, -13, 26, 26));
      dice.add(ink(this, 0, -4, String(roll.value), { size: 8 }));
      dice.setScale(0.3);
      this.tweens.add({ targets: dice, scale: 1.2, duration: 160, ease: 'Back.Out', onComplete: () => this.tweens.add({ targets: dice, scale: 1, duration: 120 }) });
      sfx('select', { x: dice.x });
      const total = MOVE_LEAD_MS + roll.path.length * STEP_MS;
      this.tweens.add({ targets: dice, alpha: 0, delay: total, duration: 250, onComplete: () => dice.destroy() });
    }

    // Schritt für Schritt hüpfen (Schnelldurchlauf)
    const steps = roll.path.map((f) => this.posFor(f, roll.playerId, b.order));
    steps.forEach((p, i) => {
      this.time.delayedCall(lead + i * STEP_MS, () => {
        this.tweens.add({
          targets: tok,
          x: p.x,
          y: p.y - 6,
          duration: STEP_MS / 2,
          ease: 'Quad.out',
          onComplete: () => this.tweens.add({ targets: tok, y: p.y, duration: STEP_MS / 2 - 10 }),
        });
        sfx('jump', { x: p.x, pitch: 0.9 + (i % 2) * 0.1, vol: 0.5 });
        if (i === steps.length - 1) this.time.delayedCall(STEP_MS, () => this.animating.delete(roll.playerId));
      });
    });
  }
}
