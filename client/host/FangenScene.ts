import Phaser from 'phaser';
import type { FangenState, GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { FANGEN, HEAT_LABELS } from '../../shared/fangen';
import { animateurHat, footprints, paintResort } from '../art/resort';
import { bus, getState, playerById } from './store';
import { figure, playAvatar } from './textures';
import { GOLD, ensureTex, txt } from './ui';

const HEAT_COLORS = [0x5aa0e8, 0xf2e05a, 0xf0973a, 0xe0402f];
const HEAT_CSS = ['#8cc4ff', '#fff07a', '#ffb867', '#ff6a5a'];

interface HunterSprite {
  f: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Ellipse;
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
  private reveal: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('fangen');
  }

  create() {
    this.hunters.clear();
    this.prints.clear();
    this.round = 0;
    this.hudKey = '';
    this.overlayKey = '';
    this.reveal = null;
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
    for (const [id, h] of Object.entries(st.hunters)) {
      const a = this.hunters.get(id);
      if (!a) continue;
      a.x += (h.x - a.x) * 0.35;
      a.y += (h.y - a.y) * 0.35;
      const img = a.f.getData('img') as Phaser.GameObjects.Image;
      img.setFlipX(h.dir < 0);
      playAvatar(img, h.moving ? 'walk' : 'idle', h.sprinting ? 1.6 : 1);
      a.f.setPosition(a.x, a.y + 6).setDepth(a.y + 6);
      a.ring.setPosition(a.x, a.y + 5).setDepth(a.y - 1);
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
  }

  private onState(s: GameState) {
    this.latest = s;
    if (s.mini?.kind !== 'fangen') return;
    const st = s.mini.state;
    if (st.round !== this.round) this.newRound(st);
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
    this.reveal?.destroy();
    this.reveal = null;
    for (const [id, h] of Object.entries(st.hunters)) {
      const pl = playerById(id);
      if (!pl) continue;
      const ring = this.add.ellipse(h.x, h.y + 5, 16, 7, HEAT_COLORS[0], 0.18).setVisible(false);
      const f = figure(this, pl.look, h.x, h.y + 6);
      f.add(txt(this, 0, -35, pl.name.slice(0, 8), { color: '#fff4d6' }).setScale(0.75));
      this.hunters.set(id, { f, ring, dust: 0, x: h.x, y: h.y });
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
        this.prints.set(p.id, c);
      }
      c.setAlpha(Math.max(0.2, Math.min(1, p.ttl / FANGEN.PRINT_TTL + 0.35)));
    }
  }

  private updateOverlay(st: FangenState) {
    const runnerName = playerById(st.runner)?.name ?? '?';
    const key = `${st.sub}-${st.round}-${st.sub === 'intro' ? Math.ceil(st.endsIn / 1000) : ''}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.overlay.removeAll(true);
    if (st.sub === 'intro') {
      this.overlay.add(this.add.rectangle(WORLD.W / 2, 128, 360, 92, 0x2d1b12, 0.78).setStrokeStyle(2, 0xffd25e));
      this.overlay.add(txt(this, WORLD.W / 2, 90, `Runde ${st.round}/${st.rounds}`, { color: '#fff4d6' }));
      this.overlay.add(txt(this, WORLD.W / 2, 106, runnerName, { size: 16, color: GOLD }));
      this.overlay.add(txt(this, WORLD.W / 2, 128, 'ist der Animateur und versteckt sich!', { color: '#fff4d6' }));
      this.overlay.add(txt(this, WORLD.W / 2, 146, `Fänger: Augen zu ... ${Math.max(1, Math.ceil(st.endsIn / 1000))}`, { color: '#ffb867' }));
    } else if ((st.sub === 'roundEnd' || st.sub === 'over') && st.outcome) {
      const o = st.outcome;
      if (!this.reveal) {
        const pl = playerById(o.runner);
        if (pl) {
          const f = figure(this, pl.look, o.x, o.y + 6);
          f.add(this.add.image(0, -24, ensureTex(this, 'fg_hat', animateurHat)));
          f.setDepth(o.y + 7);
          const glow = this.add.circle(o.x, o.y, 14, 0xffd25e, 0.35).setDepth(o.y - 2);
          this.tweens.add({ targets: glow, scale: 1.6, alpha: 0.1, duration: 500, yoyo: true, repeat: -1 });
          this.reveal = this.add.container(0, 0, [glow, f]);
          this.tweens.add({ targets: f, y: f.y - 6, duration: 220, yoyo: true, repeat: 2 });
        }
      }
      const by = o.by ? playerById(o.by)?.name ?? '?' : null;
      const title = o.caught ? 'GESCHNAPPT!' : 'ENTKOMMEN!';
      const sub = o.caught ? `${by} fängt ${runnerName} nach ${Math.round(o.survivedMs / 1000)}s` : `${runnerName} war ${Math.round(o.survivedMs / 1000)}s unsichtbar`;
      const y = o.y > 140 ? 54 : 180;
      this.overlay.add(this.add.rectangle(WORLD.W / 2, y + 20, 380, 52, 0x2d1b12, 0.8).setStrokeStyle(2, o.caught ? 0xe0402f : 0xffd25e));
      this.overlay.add(txt(this, WORLD.W / 2, y, title, { size: 16, color: o.caught ? '#ff6a5a' : GOLD }));
      this.overlay.add(txt(this, WORLD.W / 2, y + 24, sub, { color: '#fff4d6' }));
    }
  }

  private updateHud(st: FangenState) {
    const heat = Math.max(0, ...Object.values(st.hunters).map((h) => h.heat));
    const secs = Math.ceil(st.endsIn / 1000);
    const key = `${st.round}-${st.sub}-${secs}-${heat}`;
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    const runnerName = playerById(st.runner)?.name ?? '?';
    this.hud.add(txt(this, 4, 3, `Runde ${st.round}/${st.rounds}`, { origin: [0, 0], color: '#fff4d6' }));
    this.hud.add(txt(this, WORLD.W / 2, 3, `Animateur: ${runnerName.slice(0, 10)}`, { color: GOLD }));
    if (st.sub === 'chase') {
      this.hud.add(txt(this, WORLD.W - 4, 3, `${secs}s`, { origin: [1, 0], color: secs <= 10 ? '#ff6a5a' : '#fff4d6' }));
      // Fährte: heißester Fänger
      this.hud.add(txt(this, WORLD.W - 52, 3, HEAT_LABELS[heat].toUpperCase(), { origin: [1, 0], color: HEAT_CSS[heat] }));
    }
  }
}
