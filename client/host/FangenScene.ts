import Phaser from 'phaser';
import type { FangenState, GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { FANGEN, HEAT_LABELS } from '../../shared/fangen';
import { animateurHat, footprints, paintResort } from '../art/resort';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { GOLD, NameTags, ensureTex, panel, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';

const HEAT_COLORS = [0x5aa0e8, 0xf2e05a, 0xf0973a, 0xe0402f];
const HEAT_CSS = ['#8cc4ff', '#fff07a', '#ffb867', '#ff6a5a'];

interface HunterSprite {
  f: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Ellipse;
  name: string;
  sprinting: boolean;
  dust: number;
  x: number;
  y: number;
}

/**
 * TV-Ansicht von Urlaubs-Fangen: Die Fänger sind sichtbar, der Flüchtling NICHT.
 * Hinweise: kurz sichtbare Fußspuren und ein farbiger "warm/kalt"-Ring unter jedem Fänger.
 */
export class FangenScene extends Phaser.Scene {
  private hunters = new Map<string, HunterSprite>();
  private prints = new Map<number, Phaser.GameObjects.Container>();
  private hud!: Phaser.GameObjects.Container;
  private overlay!: Phaser.GameObjects.Container;
  private latest: GameState | null = null;
  private round = 0;
  private hudKey = '';
  private overlayKey = '';
  private reveals = new Map<string, Phaser.GameObjects.Container>();
  private juice!: Juice;
  private tags!: NameTags;
  private lastSub = '';

  constructor() {
    super('fangen');
  }

  create() {
    this.hunters.clear();
    this.prints.clear();
    this.round = 0;
    this.hudKey = '';
    this.overlayKey = '';
    this.reveals.clear();
    this.lastSub = '';
    this.juice = new Juice(this, { depth: 1400 });
    this.tags = new NameTags(this, 900);
    this.add.image(0, 0, ensureTex(this, 'bg_resort', () => paintResort(WORLD.W, WORLD.H))).setOrigin(0, 0).setDepth(-1000);
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.overlay = this.add.container(0, 0).setDepth(1500);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  update() {
    const s = this.latest;
    if (s?.mini?.kind !== 'fangen') return;
    const st = s.mini.state;
    const tagSpecs: { id: string; x: number; y: number; name: string; color: string }[] = [];
    for (const [id, h] of Object.entries(st.hunters)) {
      const a = this.hunters.get(id);
      if (!a) continue;
      a.x += (h.x - a.x) * 0.35;
      a.y += (h.y - a.y) * 0.35;
      const img = a.f.getData('img') as Phaser.GameObjects.Image;
      img.setFlipX(h.dir < 0);
      img.setY(h.moving ? -Math.abs(Math.sin(this.time.now / (h.sprinting ? 50 : 80))) * 2 : 0);
      a.f.setPosition(a.x, a.y + 6).setDepth(a.y + 6);
      a.ring.setPosition(a.x, a.y + 5).setDepth(a.y - 1);
      tagSpecs.push({ id, x: a.x, y: a.y - 29, name: a.name, color: '#fff4d6' });
      if (h.sprinting && !a.sprinting) sfx('whoosh', { x: a.x, vol: 0.5 });
      a.sprinting = h.sprinting;
      const heat = st.sub === 'chase' ? h.heat : -1;
      a.ring.setVisible(heat >= 0);
      if (heat >= 0) {
        a.ring.setStrokeStyle(2, HEAT_COLORS[heat], 1).setFillStyle(HEAT_COLORS[heat], heat === 3 ? 0.35 : 0.18);
        const pulse = heat === 3 ? 1 + Math.abs(Math.sin(this.time.now / 110)) * 0.5 : heat === 2 ? 1 + Math.abs(Math.sin(this.time.now / 220)) * 0.2 : 1;
        a.ring.setScale(pulse);
      }
      // Sprint-Staubwölkchen
      if (h.sprinting && this.time.now > a.dust) {
        a.dust = this.time.now + 90;
        const puff = this.add.circle(a.x - h.dir * 4, a.y + 5, 2, 0xf3e6c4, 0.8).setDepth(a.y - 2);
        this.tweens.add({ targets: puff, scale: 2, alpha: 0, duration: 350, onComplete: () => puff.destroy() });
      }
    }
    this.tags.update(tagSpecs);
  }

  private onState(s: GameState) {
    this.latest = s;
    if (s.mini?.kind !== 'fangen') return;
    const st = s.mini.state;
    if (st.round !== this.round) this.newRound(st);
    if (st.sub !== this.lastSub) {
      if (st.sub === 'chase') sfx('whistle');
      if (st.sub === 'roundEnd' && (st.outcomes ?? []).some((o) => !o.caught)) sfx('lose');
      if (st.sub === 'over') sfx('fanfare');
      this.lastSub = st.sub;
    }
    this.syncReveals(st);
    this.syncPrints(st);
    this.updateOverlay(st);
    this.updateHud(st);
  }

  private newRound(st: FangenState) {
    this.round = st.round;
    for (const a of this.hunters.values()) {
      a.f.destroy();
      a.ring.destroy();
    }
    this.hunters.clear();
    for (const c of this.reveals.values()) c.destroy();
    this.reveals.clear();
    for (const [id, h] of Object.entries(st.hunters)) {
      const pl = playerById(id);
      if (!pl) continue;
      const ring = this.add.ellipse(h.x, h.y + 5, 16, 7, HEAT_COLORS[0], 0.18).setVisible(false);
      const f = figure(this, pl.look, h.x, h.y + 6);
      this.hunters.set(id, { f, ring, name: pl.name, sprinting: false, dust: 0, x: h.x, y: h.y });
    }
  }

  /** Gefangene (schon während der Jagd) bzw. am Rundenende alle Animateure zeigen */
  private syncReveals(st: FangenState) {
    const list = st.outcomes ?? (st.outcome ? [st.outcome] : []);
    for (const o of list) {
      if (this.reveals.has(o.runner)) continue;
      const pl = playerById(o.runner);
      if (!pl) continue;
      const f = figure(this, pl.look, o.x, o.y + 6);
      f.add(this.add.image(0, -24, ensureTex(this, 'fg_hat', animateurHat)));
      f.setDepth(o.y + 7);
      const glow = this.add.circle(o.x, o.y, 14, o.caught ? 0xe0402f : 0xffd25e, 0.35).setDepth(o.y - 2);
      this.tweens.add({ targets: glow, scale: 1.6, alpha: 0.1, duration: 500, yoyo: true, repeat: -1 });
      this.reveals.set(o.runner, this.add.container(0, 0, [glow, f]));
      this.tweens.add({ targets: f, y: f.y - 6, duration: 220, yoyo: true, repeat: 2 });
      if (o.caught) {
        // Fang: Pfiff, Konfetti, kurzer Stopp
        sfx('catch', { x: o.x });
        sfx('whistle', { x: o.x, delay: 0.1 });
        sfx('cheer', { x: o.x, vol: 0.6, delay: 0.2 });
        this.juice.burst(o.x, o.y - 8, 'confetti', 30);
        this.juice.shake(2);
        this.juice.hitStop(80);
        this.juice.float(o.x, o.y - 40, 'GESCHNAPPT!', 'gold');
      } else {
        this.juice.burst(o.x, o.y - 8, 'puff', 10);
        sfx('pop', { x: o.x });
      }
    }
  }

  private syncPrints(st: FangenState) {
    const alive = new Set(st.prints.map((p) => p.id));
    for (const [id, c] of this.prints) {
      if (alive.has(id)) continue;
      this.tweens.add({ targets: c, alpha: 0, duration: 200, onComplete: () => c.destroy() });
      this.prints.delete(id);
    }
    for (const p of st.prints) {
      let c = this.prints.get(p.id);
      if (!c) {
        const img = this.add.image(0, 0, ensureTex(this, 'fg_prints', footprints)).setRotation(p.angle);
        const ring = this.add.circle(0, 0, 9, 0xfff4d6, 0.12).setStrokeStyle(1, 0xfff4d6, 0.8);
        this.tweens.add({ targets: ring, scale: 1.4, duration: 400, yoyo: true, repeat: -1 });
        c = this.add.container(p.x, p.y + 3, [ring, img]).setDepth(p.y - 3);
        // kurzer "Plopp", damit man neue Spuren bemerkt
        const ping = this.add.circle(p.x, p.y + 3, 5, 0xfff4d6, 0).setStrokeStyle(2, 0xffd25e, 1).setDepth(p.y - 3);
        this.tweens.add({ targets: ping, scale: 5, alpha: 0, duration: 700, onComplete: () => ping.destroy() });
        sfx('tick', { x: p.x, vol: 0.25, pitch: 0.8 });
        this.prints.set(p.id, c);
      }
      c.setAlpha(Math.max(0.2, Math.min(1, p.ttl / FANGEN.PRINT_TTL + 0.35)));
    }
  }

  private updateOverlay(st: FangenState) {
    const ids = st.runners?.length ? st.runners : [st.runner];
    const nm = (id: string | null) => tagName(playerById(id ?? '')?.name ?? '?');
    const runnerName = ids.map(nm).join(' + ');
    const key = `${st.sub}-${st.round}-${st.sub === 'intro' ? Math.ceil(st.endsIn / 1000) : ''}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.overlay.removeAll(true);
    if (st.sub === 'intro') {
      // Deckende dunkle Plakette (die Figuren schienen sonst durch den Text)
      this.overlay.add(panel(this, 56, 78, 368, 100, 'dark'));
      this.overlay.add(txt(this, WORLD.W / 2, 90, `Runde ${st.round}/${st.rounds}`, { color: '#fff4d6' }));
      const big = txt(this, WORLD.W / 2, 106, runnerName, { size: 16, color: GOLD });
      if (big.width > 340) big.setScale(340 / big.width);
      this.overlay.add(big);
      this.overlay.add(txt(this, WORLD.W / 2, 128, ids.length > 1 ? 'sind die Animateure und verstecken sich!' : 'ist der Animateur und versteckt sich!', { color: '#fff4d6' }));
      this.overlay.add(txt(this, WORLD.W / 2, 146, `Fänger: Augen zu ... ${Math.max(1, Math.ceil(st.endsIn / 1000))}`, { color: '#ffb867' }));
    } else if ((st.sub === 'roundEnd' || st.sub === 'over') && st.outcome) {
      const list = st.outcomes?.length ? st.outcomes : [st.outcome];
      const caught = list.filter((o) => o.caught).length;
      const title = list.length > 1 ? (caught === 2 ? 'BEIDE GESCHNAPPT!' : caught ? 'EINER GESCHNAPPT!' : 'BEIDE ENTKOMMEN!') : caught ? 'GESCHNAPPT!' : 'ENTKOMMEN!';
      const line = (o: (typeof list)[number]) =>
        o.caught ? `${nm(o.by)} fängt ${nm(o.runner)} nach ${Math.round(o.survivedMs / 1000)}s` : `${nm(o.runner)} war ${Math.round(o.survivedMs / 1000)}s unsichtbar`;
      const avgY = list.reduce((a, o) => a + o.y, 0) / list.length;
      const h = 40 + list.length * 12;
      const y = avgY > 140 ? 40 : 172;
      this.overlay.add(panel(this, 46, y - 8, 388, h, 'dark'));
      this.overlay.add(txt(this, WORLD.W / 2, y, title, { size: 16, color: caught ? '#ff6a5a' : GOLD }));
      list.forEach((o, i) => this.overlay.add(txt(this, WORLD.W / 2, y + 22 + i * 12, line(o), { color: '#fff4d6' })));
    }
  }

  private updateHud(st: FangenState) {
    const heat = Math.max(0, ...Object.values(st.hunters).map((h) => h.heat));
    const secs = Math.ceil(st.endsIn / 1000);
    const key = `${st.round}-${st.sub}-${secs}-${heat}-${(st.runners ?? []).join()}`;

    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    const ids = st.runners?.length ? st.runners : [st.runner];
    const runnerName = ids.map((id) => tagName(playerById(id)?.name ?? '?')).join(' + ');
    this.hud.add(txt(this, 4, 3, `Runde ${st.round}/${st.rounds}`, { origin: [0, 0], color: '#fff4d6' }));
    const head = txt(this, WORLD.W / 2, 3, `${ids.length > 1 ? 'Animateure' : 'Animateur'}: ${runnerName}`, { color: GOLD });
    if (head.width > 240) head.setScale(240 / head.width);
    this.hud.add(head);
    if (st.sub === 'chase') {
      this.hud.add(txt(this, WORLD.W - 4, 3, `${secs}s`, { origin: [1, 0], color: secs <= 10 ? '#ff6a5a' : '#fff4d6' }));
      // Fährte: heißester Fänger
      this.hud.add(txt(this, WORLD.W - 52, 3, HEAT_LABELS[heat].toUpperCase(), { origin: [1, 0], color: HEAT_CSS[heat] }));
    }
  }
}
