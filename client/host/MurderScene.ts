import Phaser from 'phaser';
import type { GameState, MurderState } from '../../shared/types';
import { ROOMS } from '../../shared/games';
import { WORLD } from '../../shared/flunky';
import { bus, getState, playerById } from './store';
import { ensureAvatar } from './textures';
import { Countdown, panel, txt } from './ui';

const ROOM_COLORS = [0xab5236, 0x7e2553, 0x29adff, 0x83769c, 0x73eff7, 0x00e436];

export class MurderScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Graphics;
  private timerText!: Phaser.GameObjects.Text;
  private countdown = new Countdown();
  private renderedKey = '';
  private lastScream = 0;

  constructor() {
    super('murder');
  }

  create() {
    this.renderedKey = '';
    const st = getState();
    this.lastScream = st?.mini?.kind === 'murder' ? st.mini.state.screamSeq : 0;
    this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x0b0f1e).setOrigin(0);
    this.layer = this.add.container(0, 0).setDepth(200);
    this.hud = this.add.graphics().setDepth(100);
    this.timerText = txt(this, WORLD.W - 8, 6, '', { origin: [1, 0], color: '#c2c3c7' }).setDepth(101);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    if (st) this.render(st);
  }

  update() {
    const sec = this.countdown.seconds;
    this.timerText.setText(sec > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '');
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'murder') return;
    const m = s.mini.state;
    const key = `${m.sub}-${m.phaseNo}`;
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      this.countdown.set(m.endsIn);
    }
    if (m.screamSeq !== this.lastScream) {
      this.lastScream = m.screamSeq;
      this.scream();
    }

    this.layer.removeAll(true);
    this.renderHud(m);
    switch (m.sub) {
      case 'roles':
        this.headline('MORD IM FERIENHAUS', 'Schaut heimlich auf eure Handys –\ndort steht eure Rolle!');
        this.layer.add(txt(this, WORLD.W / 2, 170, 'Tote reden nicht. Mörder lügen.', { color: '#ff004d' }));
        break;
      case 'tasks':
        this.renderMap(m);
        break;
      case 'meeting':
        this.renderMeeting(m);
        break;
      case 'vote':
        this.renderVote(s, m);
        break;
      case 'ejected':
        this.renderEjected(m);
        break;
      case 'over':
        this.renderOver(m);
        break;
    }
  }

  private renderHud(m: MurderState) {
    this.hud.clear();
    this.hud.fillStyle(0x1a1c2c).fillRect(0, 0, WORLD.W, 22);
    const w = 200;
    const x = 110;
    this.hud.fillStyle(0x000000).fillRect(x, 7, w, 8);
    this.hud.fillStyle(0x00e436).fillRect(x + 1, 8, (w - 2) * Math.min(1, m.taskProgress / Math.max(1, m.taskTarget)), 6);
    this.layer.add(txt(this, 8, 6, 'AUFGABEN', { origin: [0, 0], color: '#00e436' }));
    if (m.phaseNo > 0) this.layer.add(txt(this, 330, 6, `Tag ${m.phaseNo}`, { origin: [0, 0], color: '#c2c3c7' }));
  }

  private renderMap(m: MurderState) {
    const cols = 3;
    const cw = 150, ch = 104, ox = 15, oy = 30;
    ROOMS.forEach((room, i) => {
      const x = ox + (i % cols) * (cw + 5);
      const y = oy + Math.floor(i / cols) * (ch + 6);
      const g = this.add.graphics();
      g.fillStyle(ROOM_COLORS[i], 0.25).fillRect(x, y, cw, ch);
      g.lineStyle(2, ROOM_COLORS[i]).strokeRect(x + 1, y + 1, cw - 2, ch - 2);
      this.layer.add(g);
      this.layer.add(txt(this, x + cw / 2, y + 6, room.name.toUpperCase(), { color: '#fff1e8' }));
      // Anonyme Silhouetten – nur die Anzahl ist sichtbar
      const n = m.roomCounts[i] ?? 0;
      for (let k = 0; k < n; k++) {
        const sx = x + cw / 2 + (k - (n - 1) / 2) * 16;
        const sg = this.add.graphics();
        sg.fillStyle(0xc2c3c7).fillCircle(sx, y + 52, 4).fillRect(sx - 5, y + 57, 10, 14);
        this.layer.add(sg);
      }
      this.layer.add(txt(this, x + cw / 2, y + ch - 16, n === 1 ? '1 Person' : `${n} Personen`, { color: '#c2c3c7' }));
    });
  }

  private renderMeeting(m: MurderState) {
    const reporter = playerById(m.reporter)?.name;
    this.headline('BESPRECHUNG!', reporter ? `${reporter} hat eine Leiche gefunden!` : 'Die Zeit ist um – alle ins Wohnzimmer!');
    if (m.deaths.length) {
      this.layer.add(txt(this, WORLD.W / 2, 120, 'Gefunden:', { color: '#ff004d' }));
      m.deaths.forEach((id, i) => {
        const p = playerById(id);
        if (!p) return;
        const x = WORLD.W / 2 + (i - (m.deaths.length - 1) / 2) * 70;
        this.layer.add(this.add.image(x, 170, ensureAvatar(this, p.look)).setScale(3).setAngle(90).setTint(0x999999));
        this.layer.add(txt(this, x, 194, p.name));
      });
    } else {
      this.layer.add(txt(this, WORLD.W / 2, 140, 'Niemand ist gestorben ... noch.', { color: '#c2c3c7' }));
    }
    this.layer.add(txt(this, WORLD.W / 2, 228, 'Diskutiert! Wer war’s? (VIP kann zur Abstimmung springen)', { color: '#ffec27', wrap: 440 }));
  }

  private renderVote(s: GameState, m: MurderState) {
    this.headline('ABSTIMMUNG', 'Stimmt am Handy ab, wen ihr rauswerft.');
    const alive = s.players.filter((p) => m.alive[p.id]);
    const n = alive.length;
    const spacing = Math.min(56, 440 / Math.max(1, n));
    alive.forEach((p, i) => {
      const x = WORLD.W / 2 + (i - (n - 1) / 2) * spacing;
      const voted = m.voted.includes(p.id);
      this.layer.add(this.add.image(x, 190, ensureAvatar(this, p.look)).setOrigin(0.5, 1).setScale(3));
      this.layer.add(txt(this, x, 196, p.name.slice(0, 6)));
      this.layer.add(txt(this, x, 210, voted ? 'OK!' : '...', { color: voted ? '#00e436' : '#c2c3c7' }));
    });
  }

  private renderEjected(m: MurderState) {
    const p = playerById(m.ejected);
    if (!p) {
      this.headline('Niemand fliegt raus.', 'Gleichstand oder übersprungen ...');
      return;
    }
    this.headline(`${p.name} wird rausgeworfen!`, '');
    const img = this.add.image(WORLD.W / 2, 140, ensureAvatar(this, p.look)).setScale(4);
    this.layer.add(img);
    this.tweens.add({ targets: img, x: WORLD.W + 40, angle: 360, duration: 2500, delay: 800, ease: 'Quad.in' });
    this.layer.add(
      txt(this, WORLD.W / 2, 200, m.ejectedWasMurderer ? `${p.name} WAR der Mörder!` : `${p.name} war unschuldig ...`, {
        size: 16,
        color: m.ejectedWasMurderer ? '#00e436' : '#ff004d',
      }),
    );
  }

  private renderOver(m: MurderState) {
    const murderWin = m.winner === 'murderer';
    this.headline(murderWin ? 'DER MÖRDER GEWINNT!' : 'DIE URLAUBER GEWINNEN!', m.winReason ?? '');
    const ms = m.murderers ?? [];
    this.layer.add(txt(this, WORLD.W / 2, 130, ms.length > 1 ? 'Die Mörder waren:' : 'Der Mörder war:', { color: '#ff004d' }));
    ms.forEach((id, i) => {
      const p = playerById(id);
      if (!p) return;
      const x = WORLD.W / 2 + (i - (ms.length - 1) / 2) * 80;
      this.layer.add(this.add.image(x, 200, ensureAvatar(this, p.look)).setOrigin(0.5, 1).setScale(3));
      this.layer.add(txt(this, x, 206, p.name, { color: '#ff004d' }));
    });
  }

  private headline(title: string, sub: string) {
    this.layer.add(txt(this, WORLD.W / 2, 50, title, { size: 16, color: '#ff004d', wrap: 460 }));
    if (sub) this.layer.add(txt(this, WORLD.W / 2, 80, sub, { wrap: 440 }));
  }

  private scream() {
    this.cameras.main.flash(250, 255, 0, 77);
    this.cameras.main.shake(300, 0.01);
    const t = txt(this, WORLD.W / 2, 120, 'Ein Schrei!', { size: 24, color: '#ff004d' }).setDepth(500);
    this.tweens.add({ targets: t, alpha: 0, scale: 1.5, duration: 1600, onComplete: () => t.destroy() });
  }
}
