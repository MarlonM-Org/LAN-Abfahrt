import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { STASHES, type SuessState } from '../../shared/suess';
import { candySprite, dizzyStar, guardCap, lootSack, paintSuessHouse } from '../art/suess';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { GOLD, ensureTex, txt } from './ui';

interface Actor {
  f: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  extra: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  x: number;
  y: number;
  guard: boolean;
  dust: number;
}

const candyTex = (scene: Phaser.Scene, t: number, v: number) => ensureTex(scene, `su_candy_${t}_${v}`, () => candySprite(t, v));

/**
 * TV-Ansicht von Süßigkeiten-Klau: das ganze Ferienhaus bei Nacht von oben.
 * Naschkatzen tragen einen Beutesack, der mit der Beute wächst; Wächter haben Mütze + Taschenlampe.
 */
export class SuessScene extends Phaser.Scene {
  private actors = new Map<string, Actor>();
  private candies = new Map<number, Phaser.GameObjects.Image>();
  private cones!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private overlay!: Phaser.GameObjects.Container;
  private latest: SuessState | null = null;
  private round = 0;
  private hudKey = '';
  private overlayKey = '';
  private lastEvent = 0;

  constructor() {
    super('suess');
  }

  create() {
    this.actors.clear();
    this.candies.clear();
    this.latest = null;
    this.round = 0;
    this.hudKey = '';
    this.overlayKey = '';
    this.lastEvent = 0;
    this.add.image(0, 0, ensureTex(this, 'bg_suess', () => paintSuessHouse(WORLD.W, WORLD.H))).setOrigin(0, 0).setDepth(-1000);
    this.cones = this.add.graphics().setDepth(-500).setBlendMode(Phaser.BlendModes.ADD);
    for (const s of STASHES) {
      const t = txt(this, Math.max(36, Math.min(WORLD.W - 36, s.x)), s.y + 17, 'VERSTECK', { color: '#ffe9a0' }).setDepth(-400).setAlpha(0.9);
      this.tweens.add({ targets: t, alpha: 0.45, duration: 900, yoyo: true, repeat: -1 });
    }
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.overlay = this.add.container(0, 0).setDepth(1500);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  update() {
    const st = this.latest;
    if (!st) return;
    const now = this.time.now;
    this.cones.clear();
    for (const [id, a] of this.actors) {
      const th = st.thieves[id];
      const gd = st.guards[id];
      const pos = th ?? gd;
      if (!pos) continue;
      a.x += (pos.x - a.x) * 0.35;
      a.y += (pos.y - a.y) * 0.35;
      a.img.setFlipX(pos.dir < 0);
      const fast = gd?.sprinting;
      a.img.setY(pos.moving ? -Math.abs(Math.sin(now / (fast ? 50 : th ? 80 + th.carry * 8 : 80))) * 2 : 0);
      a.f.setPosition(a.x, a.y + 6).setDepth(a.y + 6);
      if (th) {
        const out = th.state === 'out';
        a.f.setVisible(!out);
        // Beutesack wächst mit, die Figur wird ein bisschen dicker
        const s = th.carry > 0 ? 0.55 + Math.min(1.3, th.carry * 0.09) : 0;
        a.extra.setVisible(th.carry > 0).setScale(s).setPosition(-pos.dir * 6, -10 - s * 4);
        a.img.setScale(1 + Math.min(0.35, th.carry * 0.03), 1 + Math.min(0.12, th.carry * 0.01));
        a.f.setAlpha(th.shield ? (Math.floor(now / 90) % 2 ? 0.4 : 1) : 1);
        a.label.setText(th.carry > 0 ? `${th.carry}` : '').setColor(th.carry >= 8 ? '#ff8a6a' : GOLD);
      } else if (gd) {
        // Taschenlampe in Blickrichtung
        const len = 46;
        const half = 0.42;
        const ox = a.x;
        const oy = a.y - 4;
        this.cones.fillStyle(0xfff2b0, gd.sprinting ? 0.22 : 0.16);
        this.cones.fillTriangle(ox, oy, ox + Math.cos(gd.a - half) * len, oy + Math.sin(gd.a - half) * len, ox + Math.cos(gd.a + half) * len, oy + Math.sin(gd.a + half) * len);
        this.cones.fillStyle(0xfff2b0, 0.1);
        this.cones.fillCircle(ox, oy + 6, 14);
        if (gd.sprinting && now > a.dust) {
          a.dust = now + 90;
          const puff = this.add.circle(a.x - gd.dir * 4, a.y + 5, 2, 0xd8d0f0, 0.7).setDepth(a.y - 2);
          this.tweens.add({ targets: puff, scale: 2, alpha: 0, duration: 350, onComplete: () => puff.destroy() });
        }
      }
    }
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'suess') return;
    const st = s.mini.state;
    this.latest = st;
    if (st.round !== this.round) this.newRound(st);
    this.syncCandy(st);
    this.playEvents(st);
    this.updateOverlay(st);
    this.updateHud(st);
  }

  private newRound(st: SuessState) {
    this.round = st.round;
    for (const a of this.actors.values()) a.f.destroy();
    this.actors.clear();
    for (const c of this.candies.values()) c.destroy();
    this.candies.clear();
    const add = (id: string, x: number, y: number, guard: boolean) => {
      const pl = playerById(id);
      if (!pl) return;
      const f = figure(this, pl.look, x, y + 6);
      const img = f.getData('img') as Phaser.GameObjects.Image;
      const extra = guard ? this.add.image(0, -25, ensureTex(this, 'su_cap', guardCap)) : this.add.image(0, -12, ensureTex(this, 'su_sack', lootSack)).setVisible(false);
      // Sack hinter der Figur, Mütze darüber
      if (guard) f.add(extra);
      else f.addAt(extra, 1);
      const name = txt(this, 0, -38, pl.name.slice(0, 8), { color: guard ? '#9ec3ff' : '#fff4d6' }).setScale(0.7);
      const label = txt(this, 0, 2, '', { color: GOLD }).setScale(0.75);
      f.add([name, label]);
      this.actors.set(id, { f, img, extra, label, x, y, guard, dust: 0 });
    };
    for (const [id, g] of Object.entries(st.guards)) add(id, g.x, g.y, true);
    for (const [id, t] of Object.entries(st.thieves)) add(id, t.x, t.y, false);
  }

  private syncCandy(st: SuessState) {
    const alive = new Set(st.candy.map((c) => c.id));
    for (const [id, img] of this.candies) {
      if (alive.has(id)) continue;
      this.candies.delete(id);
      this.tweens.add({ targets: img, y: img.y - 8, alpha: 0, duration: 180, onComplete: () => img.destroy() });
    }
    for (const c of st.candy) {
      if (this.candies.has(c.id)) continue;
      const img = this.add.image(c.x, c.y, candyTex(this, c.t, c.id % 6)).setDepth(c.y - 2);
      img.setScale(0.2);
      this.tweens.add({ targets: img, scale: 1, duration: 220, ease: 'Back.Out' });
      if (c.t >= 2) this.tweens.add({ targets: img, y: c.y - 1.5, duration: 600 + (c.id % 5) * 60, yoyo: true, repeat: -1 });
      this.candies.set(c.id, img);
    }
  }

  private playEvents(st: SuessState) {
    for (const e of st.events) {
      if (e.seq <= this.lastEvent) continue;
      this.lastEvent = e.seq;
      if (e.kind === 'deposit') {
        const t = txt(this, e.x, e.y - 30, `+${e.n}`, { size: 16, color: GOLD }).setDepth(1200);
        this.tweens.add({ targets: t, y: t.y - 18, alpha: 0, duration: 1200, onComplete: () => t.destroy() });
        const ring = this.add.circle(e.x, e.y, 6, 0xffd25e, 0).setStrokeStyle(2, 0xffd25e).setDepth(1100);
        this.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
      } else if (e.kind === 'catch') {
        const name = playerById(e.id)?.name ?? '?';
        const t = txt(this, e.x, e.y - 34, e.n > 0 ? `GESCHNAPPT! −${e.n}` : 'GESCHNAPPT!', { color: '#ff6a5a' }).setDepth(1200);
        const n = txt(this, e.x, e.y - 24, name.slice(0, 10), { color: '#fff4d6' }).setScale(0.7).setDepth(1200);
        this.tweens.add({ targets: [t, n], y: '-=14', alpha: 0, delay: 500, duration: 1100, onComplete: () => (t.destroy(), n.destroy()) });
        this.cameras.main.shake(140, 0.004);
        for (let i = 0; i < 4; i++) {
          const s = this.add.image(e.x, e.y - 8, ensureTex(this, 'su_star', dizzyStar)).setDepth(1150);
          const ang = (i / 4) * Math.PI * 2;
          this.tweens.add({ targets: s, x: e.x + Math.cos(ang) * 16, y: e.y - 8 + Math.sin(ang) * 10, alpha: 0, angle: 180, duration: 800, onComplete: () => s.destroy() });
        }
      } else if (e.kind === 'drop') {
        const t = txt(this, e.x, e.y - 30, 'Abgelegt!', { color: '#c8e6ff' }).setScale(0.75).setDepth(1200);
        this.tweens.add({ targets: t, y: t.y - 10, alpha: 0, duration: 900, onComplete: () => t.destroy() });
      }
    }
  }

  private names(ids: string[]) {
    return ids.map((id) => playerById(id)?.name ?? '?').join(' & ');
  }

  private updateOverlay(st: SuessState) {
    const key = `${st.sub}-${st.round}-${st.sub === 'intro' ? Math.ceil(st.endsIn / 1000) : ''}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.overlay.removeAll(true);
    const W = WORLD.W;
    if (st.sub === 'intro') {
      const guards = Object.keys(st.guards);
      this.overlay.add(this.add.rectangle(W / 2, 138, 360, 132, 0x1d1838, 0.9).setStrokeStyle(2, 0xffd25e));
      this.overlay.add(txt(this, W / 2, 80, `Runde ${st.round}/${st.rounds}`, { color: '#fff4d6' }));
      this.overlay.add(txt(this, W / 2, 96, guards.length > 1 ? 'Die Wächter:' : 'Der Wächter:', { color: '#9ec3ff' }));
      this.overlay.add(txt(this, W / 2, 110, this.names(guards).slice(0, 26), { size: 16, color: '#9ec3ff' }));
      this.overlay.add(txt(this, W / 2, 136, 'Alle anderen sind Naschkatzen!', { color: GOLD }));
      this.overlay.add(txt(this, W / 2, 150, `Bringt ${st.target} Süßes ins Versteck.`, { color: GOLD }));
      this.overlay.add(txt(this, W / 2, 166, 'Volle Taschen machen langsam!', { color: '#fff4d6' }));
      this.overlay.add(txt(this, W / 2, 184, `Los in ${Math.max(1, Math.ceil(st.endsIn / 1000))} ...`, { color: '#ffb867' }));
    } else if ((st.sub === 'roundEnd' || st.sub === 'over') && st.outcome) {
      const o = st.outcome;
      const thieves = o.winner === 'thieves';
      this.overlay.add(this.add.rectangle(W / 2, 126, 400, 72, 0x1d1838, 0.88).setStrokeStyle(2, thieves ? 0xffd25e : 0x6f9be8));
      this.overlay.add(txt(this, W / 2, 100, thieves ? 'NASCHKATZEN GEWINNEN!' : 'WÄCHTER GEWINNEN!', { size: 16, color: thieves ? GOLD : '#9ec3ff' }));
      const sub = thieves
        ? `${o.total} Süßigkeiten im Versteck – ${Math.ceil(o.leftMs / 1000)}s vor Schluss!`
        : `Nur ${o.total}/${o.target} geschafft · ${o.catches}x geschnappt`;
      this.overlay.add(txt(this, W / 2, 124, sub, { color: '#fff4d6' }));
      if (st.round < st.rounds) this.overlay.add(txt(this, W / 2, 142, 'Gleich: neue Wächter!', { color: '#ffb867' }).setScale(0.8));
    }
  }

  private updateHud(st: SuessState) {
    const secs = Math.ceil(st.endsIn / 1000);
    const key = `${st.round}-${st.sub}-${secs}-${st.total}-${st.target}`;
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    const W = WORLD.W;
    this.hud.add(this.add.rectangle(0, 0, W, 13, 0x1d1838).setOrigin(0, 0));
    this.hud.add(txt(this, 4, 3, `Runde ${st.round}/${st.rounds}`, { origin: [0, 0], color: '#fff4d6' }));
    // Fortschrittsbalken = Bonbonglas
    const bw = 170;
    const bx = W / 2 - bw / 2 + 10;
    const frac = Math.min(1, st.total / Math.max(1, st.target));
    this.hud.add(this.add.image(bx - 10, 7, candyTex(this, 0, 0)));
    this.hud.add(this.add.rectangle(bx, 2, bw, 10, 0x0e0b20).setOrigin(0, 0).setStrokeStyle(1, 0xffd25e));
    if (frac > 0) this.hud.add(this.add.rectangle(bx + 1, 3, (bw - 2) * frac, 8, frac >= 1 ? 0x7ad66a : 0xf07aa8).setOrigin(0, 0));
    this.hud.add(txt(this, bx + bw / 2, 3, `${st.total} / ${st.target}`, { color: '#fff4d6' }));
    if (st.sub === 'play') {
      const m = Math.floor(secs / 60);
      const s = `${m}:${String(secs % 60).padStart(2, '0')}`;
      this.hud.add(txt(this, W - 4, 3, s, { origin: [1, 0], color: secs <= 15 ? '#ff6a5a' : '#fff4d6' }));
    }
  }
}
