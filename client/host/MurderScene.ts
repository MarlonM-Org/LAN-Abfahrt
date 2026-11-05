import Phaser from 'phaser';
import type { GameState, MurderState } from '../../shared/types';
import { ROOMS } from '../../shared/games';
import { WORLD } from '../../shared/flunky';
import { roomRect } from '../../shared/house';
import * as O from '../art/objects';
import { addHouse } from './house';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { Countdown, GREEN_INK, RED_INK, ensureTex, ink, nameTag, panel, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';

export class MurderScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Container;
  private night!: Phaser.GameObjects.Rectangle;
  private timerText!: Phaser.GameObjects.Text;
  private countdown = new Countdown();
  private renderedKey = '';
  private stateKey = '';
  private lastScream = 0;
  private juice!: Juice;
  private votedN = 0;

  constructor() {
    super('murder');
  }

  create() {
    this.renderedKey = '';
    this.stateKey = '';
    this.votedN = 0;
    this.juice = new Juice(this, { depth: 4000 });
    const st = getState();
    this.lastScream = st?.mini?.kind === 'murder' ? st.mini.state.screamSeq : 0;

    addHouse(this);
    // Nacht-Stimmung
    this.night = this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x0b1030, 0.45).setOrigin(0).setDepth(30);

    panel(this, 0, 0, WORLD.W, 34).setDepth(1000);
    this.timerText = ink(this, WORLD.W - 12, 13, '', { origin: [1, 0] }).setDepth(1001);
    this.layer = this.add.container(0, 0).setDepth(200);
    this.hud = this.add.container(0, 0).setDepth(1001);

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
      // Phasen-Jingles: Besprechung, Abstimmung, Rauswurf, Ende
      if (m.sub === 'meeting') (sfx('whistle'), sfx(m.deaths.length ? 'ko' : 'drumroll', { delay: 0.3, vol: 0.6 }));
      if (m.sub === 'vote') sfx('select');
      if (m.sub === 'ejected') (sfx('whoosh', { delay: 0.9 }), sfx(m.ejected ? (m.ejectedWasMurderer ? 'win' : 'lose') : 'tick', { delay: 1.2 }));
      if (m.sub === 'over') sfx('fanfare');
      this.votedN = 0;
    }
    // Abstimmung: Tick pro neuer Stimme
    if (m.sub === 'vote' && m.voted.length > this.votedN) sfx('tick', { pitch: 1 + m.voted.length * 0.05 });
    this.votedN = m.sub === 'vote' ? m.voted.length : 0;
    if (m.screamSeq !== this.lastScream) {
      this.lastScream = m.screamSeq;
      this.scream();
    }
    const sKey = JSON.stringify([m.sub, m.phaseNo, m.roomCounts, m.taskProgress, m.voted, m.alive, m.deaths]);
    if (sKey === this.stateKey) return;
    this.stateKey = sKey;

    this.layer.removeAll(true);
    this.night.setAlpha(m.sub === 'tasks' ? 0.45 : 0.75);
    this.renderHud(m);
    switch (m.sub) {
      case 'roles':
        this.card('Mord im Ferienhaus', 'Schaut heimlich auf eure Handys –\ndort steht eure Rolle!\n\nTote reden nicht. Mörder lügen.');
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
    this.hud.removeAll(true);
    this.hud.add(ink(this, 12, 13, 'Aufgaben', { origin: [0, 0], color: GREEN_INK }));
    const g = this.add.graphics();
    g.fillStyle(0x2d1b12).fillRect(91, 12, 202, 10);
    g.fillStyle(0xe6c88a).fillRect(92, 13, 200, 8);
    g.fillStyle(0x46b04a).fillRect(92, 13, 200 * Math.min(1, m.taskProgress / Math.max(1, m.taskTarget)), 8);
    this.hud.add(g);
    if (m.phaseNo > 0) this.hud.add(ink(this, 330, 13, `Tag ${m.phaseNo}`, { origin: [0, 0] }));
  }

  private renderMap(m: MurderState) {
    ROOMS.forEach((_, i) => {
      const r = roomRect(i);
      const n = m.roomCounts[i] ?? 0;
      for (let k = 0; k < n; k++) {
        const sx = r.x + r.w / 2 + (k - (n - 1) / 2) * Math.min(16, (r.w - 20) / n);
        this.layer.add(this.add.image(sx, r.y + r.h - 22, ensureTex(this, 'silhouette', O.silhouette)).setOrigin(0.5, 1));
      }
      if (n > 0) this.layer.add(txt(this, r.x + r.w / 2, r.y + r.h - 18, n === 1 ? '1 Person' : `${n} Personen`));
    });
  }

  private card(title: string, sub: string, h = 120) {
    const y = 140 - h / 2;
    this.layer.add(panel(this, 70, y, 340, h));
    this.layer.add(ink(this, WORLD.W / 2, y + 16, title, { size: 16, color: RED_INK, wrap: 310 }));
    if (sub) this.layer.add(ink(this, WORLD.W / 2, y + 44, sub, { wrap: 310 }));
  }

  private renderMeeting(m: MurderState) {
    const reporter = playerById(m.reporter)?.name;
    this.card('Besprechung!', reporter ? `${reporter} hat eine Leiche gefunden!` : 'Die Zeit ist um – alle ins Wohnzimmer!', 190);
    if (m.deaths.length) {
      this.layer.add(ink(this, WORLD.W / 2, 112, 'Gefunden:', { color: RED_INK }));
      m.deaths.forEach((id, i) => {
        const p = playerById(id);
        if (!p) return;
        const x = WORLD.W / 2 + (i - (m.deaths.length - 1) / 2) * 70;
        const f = figure(this, p.look, x, 168, 2);
        const img = f.getData('img') as Phaser.GameObjects.Image;
        img.setAngle(90).setTint(0x9a9a9a).setY(-14);
        this.layer.add(f);
        this.layer.add(nameTag(this, x, 176, p.name));
      });
    } else {
      this.layer.add(ink(this, WORLD.W / 2, 140, 'Niemand ist gestorben ... noch.'));
    }
    this.layer.add(ink(this, WORLD.W / 2, 204, 'Diskutiert! Wer war wo?\n(VIP kann zur Abstimmung springen)', { color: '#7a5a3a', wrap: 310 }));
  }

  private renderVote(s: GameState, m: MurderState) {
    this.card('Abstimmung', 'Stimmt am Handy ab, wen ihr rauswerft.', 200);
    const alive = s.players.filter((p) => m.alive[p.id]);
    // Ab 9 Spielern zwei Reihen (versetzt), sonst überlappen Figuren und Namensschilder
    const rows = alive.length > 8 ? 2 : 1;
    const perRow = Math.ceil(alive.length / rows);
    const spacing = Math.min(48, 300 / Math.max(1, perRow));
    alive.forEach((p, i) => {
      const row = Math.floor(i / perRow);
      const n = row === rows - 1 ? alive.length - row * perRow : perRow;
      const shift = row === 1 && n === perRow ? spacing / 2 : 0;
      const x = WORLD.W / 2 + (i - row * perRow - (n - 1) / 2) * spacing + shift;
      const y = rows === 2 ? 146 + row * 64 : 190;
      const voted = m.voted.includes(p.id);
      this.layer.add(figure(this, p.look, x, y, 2));
      this.layer.add(nameTag(this, x, y + 4, p.name, voted ? GREEN_INK : undefined, spacing - 2));
    });
  }

  private renderEjected(m: MurderState) {
    const p = playerById(m.ejected);
    if (!p) {
      this.card('Niemand fliegt raus.', 'Gleichstand oder übersprungen ...');
      return;
    }
    this.card(`${tagName(p.name)} fliegt raus!`, '', 190);
    const f = figure(this, p.look, WORLD.W / 2, 170, 3);
    this.layer.add(f);
    this.tweens.add({ targets: f, x: WORLD.W + 60, angle: 360, duration: 2400, delay: 900, ease: 'Quad.in' });
    this.layer.add(
      ink(this, WORLD.W / 2, 196, m.ejectedWasMurderer ? `${tagName(p.name)} WAR der Mörder!` : `${tagName(p.name)} war unschuldig ...`, {
        size: 8,
        color: m.ejectedWasMurderer ? GREEN_INK : RED_INK,
      }),
    );
  }

  private renderOver(m: MurderState) {
    const murderWin = m.winner === 'murderer';
    this.card(murderWin ? 'Der Mörder gewinnt!' : 'Die Urlauber gewinnen!', m.winReason ?? '', 200);
    const ms = m.murderers ?? [];
    this.layer.add(ink(this, WORLD.W / 2, 124, ms.length > 1 ? 'Die Mörder waren:' : 'Der Mörder war:', { color: RED_INK }));
    ms.forEach((id, i) => {
      const p = playerById(id);
      if (!p) return;
      const x = WORLD.W / 2 + (i - (ms.length - 1) / 2) * 80;
      this.layer.add(figure(this, p.look, x, 196, 2));
      this.layer.add(nameTag(this, x, 200, p.name, RED_INK));
    });
  }

  private scream() {
    // Angriff: roter Blitz, Schrei, kurzer Stopp
    this.juice.flash(0xc81e28, 250);
    this.juice.shake(3);
    this.juice.hitStop(120);
    sfx('ko');
    sfx('crack', { pitch: 0.6, delay: 0.05 });

    const t = txt(this, WORLD.W / 2, 120, 'Ein Schrei!', { size: 24, color: '#ff6b5e' }).setDepth(5000);
    this.tweens.add({ targets: t, alpha: 0, scale: 1.4, duration: 1600, onComplete: () => t.destroy() });
  }
}
