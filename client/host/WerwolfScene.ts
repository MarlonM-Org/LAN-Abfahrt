import Phaser from 'phaser';
import type { GameState, PlayerPublic } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { WOLF_CAUSE_TEXT, WOLF_ROLES, type WolfRole, type WolfState } from '../../shared/werwolf';
import { cottage, tree } from '../art/objects';
import { nightCottage, nightTree, paintWolfDay, paintWolfNight, wolfHead } from '../art/werwolf';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { BLUE_INK, Countdown, GOLD, GREEN_INK, RED_INK, ensureTex, ink, nameTag, panel, txt } from './ui';

const clock = (ms: number) => {
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

const NIGHT_SUBS = new Set<WolfState['sub']>(['roles', 'night', 'witch', 'dawn']);

/** „2 Werwölfe · Seherin · Hexe · 3 Urlauber“ */
export function roleSummary(counts: Partial<Record<WolfRole, number>>) {
  const order: WolfRole[] = ['wolf', 'seherin', 'hexe', 'jaeger', 'dorf'];
  return order
    .filter((r) => counts[r])
    .map((r) => (counts[r] === 1 ? (r === 'wolf' ? '1 Werwolf' : r === 'dorf' ? '1 Urlauber' : WOLF_ROLES[r].name) : `${counts[r]} ${WOLF_ROLES[r].plural}`))
    .join(' · ');
}

/**
 * Werwölfe im Ferienhaus – der TV ist der Erzähler: Nacht über dem Ferienhaus,
 * Morgen-Nachrichten (wer ist tot, welche Rolle), Diskussions-Uhr, Abstimmung und Auflösung.
 * Er zeigt nur Öffentliches – Rollen erst beim Tod.
 */
export class WerwolfScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private bgNight!: Phaser.GameObjects.Image;
  private bgDay!: Phaser.GameObjects.Image;
  private propsNight: Phaser.GameObjects.Image[] = [];
  private propsDay: Phaser.GameObjects.Image[] = [];
  private eyes!: Phaser.GameObjects.Container;
  private timerBar!: Phaser.GameObjects.Graphics;
  private clockText!: Phaser.GameObjects.Text;
  private countdown = new Countdown();
  private total = 1;
  private phaseKey = '';
  private stateKey = '';
  private clockShown = '';

  constructor() {
    super('werwolf');
  }

  create() {
    this.phaseKey = '';
    this.stateKey = '';
    this.clockShown = '';
    this.total = 1;
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
    // Ferienhaus links, Bäume rechts – bei Nacht abgedunkelt mit leuchtenden Fenstern
    const place = (key: string, make: () => Pix, x: number, y: number, list: Phaser.GameObjects.Image[]) =>
      list.push(this.add.image(x, y, ensureTex(this, key, make)).setOrigin(0.5, 1).setDepth(-900 + y / 10));
    place('wolf_cottage_n', nightCottage, 52, 200, this.propsNight);
    place('wolf_cottage_d', cottage, 52, 200, this.propsDay);
    for (const [i, x, y] of [[1, 432, 200], [2, 462, 206], [3, 412, 210]] as const) {
      place(`wolf_tree_n${i}`, () => nightTree(i), x, y, this.propsNight);
      place(`wolf_tree_d${i}`, () => tree(i), x, y, this.propsDay);
    }
    // Leuchtende Augen im Gebüsch (nur nachts)
    this.eyes = this.add.container(0, 0).setDepth(-800);
    for (const [x, y] of [[118, 190], [372, 194], [452, 176]]) {
      const pair = this.add.container(x, y);
      pair.add([this.add.rectangle(0, 0, 2, 2, 0xffd25e), this.add.rectangle(5, 0, 2, 2, 0xffd25e)]);
      this.eyes.add(pair);
      this.tweens.add({ targets: pair, alpha: { from: 1, to: 0 }, duration: 160, yoyo: true, repeat: -1, repeatDelay: 1800 + x * 7 });
    }

    this.layer = this.add.container(0, 0).setDepth(950);
    this.timerBar = this.add.graphics().setDepth(1000);
    panel(this, 6, 4, 468, 34).setDepth(900);
    ink(this, WORLD.W / 2, 11, 'WERWÖLFE IM FERIENHAUS', { color: RED_INK }).setDepth(901);
    this.clockText = ink(this, 462, 13, '', { size: 16, origin: [1, 0] }).setDepth(901);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  update() {
    const s = getState();
    const w = s?.mini?.kind === 'werwolf' ? s.mini.state : null;
    this.timerBar.clear();
    if (!w) return;
    const showClock = w.sub !== 'over' && w.sub !== 'roles' && !this.countdown.none;
    const label = showClock ? clock(this.countdown.remaining) : '';
    if (label !== this.clockShown) {
      this.clockShown = label;
      this.clockText.setText(label);
      this.clockText.setColor(this.countdown.remaining < 10000 ? RED_INK : '#3d2414');
    }
    const frac = this.countdown.remaining / this.total;
    if (frac <= 0 || w.sub === 'over') return;
    this.timerBar.fillStyle(0x2d1b12).fillRect(12, 40, 456, 5);
    this.timerBar.fillStyle(w.sub === 'vote' ? 0x3f8fe0 : NIGHT_SUBS.has(w.sub) ? 0x9b8fe0 : frac < 0.2 ? 0xe04a3f : 0xf0b13a).fillRect(13, 41, 454 * frac, 3);
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'werwolf') return;
    const w = s.mini.state;
    const pk = `${w.sub}-${w.phaseNo}-${w.shotDone}`;
    if (pk !== this.phaseKey) {
      this.phaseKey = pk;
      this.countdown.set(w.endsIn);
      this.total = Math.max(1, w.endsIn);
    }
    const players = s.players.filter((p) => p.id in w.alive);
    const key = JSON.stringify([w.sub, w.phaseNo, w.shotDone, w.alive, w.voted, w.nightDone, w.nightTotal, players.map((p) => [p.name, p.connected, p.removed])]);
    if (key === this.stateKey) return;
    this.stateKey = key;

    const night = NIGHT_SUBS.has(w.sub) || (w.sub === 'hunter' && w.hunterThenDay);
    this.bgNight.setVisible(night);
    this.bgDay.setVisible(!night);
    for (const p of this.propsNight) p.setVisible(night);
    for (const p of this.propsDay) p.setVisible(!night);
    this.eyes.setVisible(w.sub === 'night' || w.sub === 'witch');

    this.layer.removeAll(true);
    const phaseName = w.sub === 'roles' ? 'Rollen ansehen' : night ? `Nacht ${w.day}` : `Tag ${w.day}`;
    this.layer.add(ink(this, 14, 13, phaseName, { origin: [0, 0] }));
    const wolvesLeft = (w.roleCounts.wolf ?? 0) - Object.values(w.revealed).filter((r) => r === 'wolf').length;
    this.layer.add(ink(this, WORLD.W / 2, 23, `Werwölfe übrig: ${wolvesLeft}`, { color: RED_INK }));

    switch (w.sub) {
      case 'roles':
        this.renderRoles(w);
        break;
      case 'night':
      case 'witch':
        this.renderNight(w);
        break;
      case 'dawn':
        this.renderDeaths(w, 'Der Morgen graut ...', w.deaths.length ? '' : 'Niemand ist gestorben!');
        break;
      case 'day':
        this.renderDay(w);
        break;
      case 'vote':
        this.renderVote(w, players);
        break;
      case 'verdict':
        this.renderVerdict(w);
        break;
      case 'hunter':
        this.renderHunter(w);
        break;
      case 'over':
        this.renderOver(w);
        break;
    }
    this.renderRow(w, players);
  }

  private bigPanel(h = 120) {
    this.layer.add(panel(this, 60, 50, 360, h));
  }

  private renderRoles(w: WolfState) {
    this.bigPanel();
    const head = this.add.image(WORLD.W / 2, 70, ensureTex(this, 'wolf_head', wolfHead)).setScale(2);
    this.layer.add(head);
    this.tweens.add({ targets: head, angle: { from: -6, to: 6 }, duration: 600, yoyo: true, repeat: -1 });
    this.layer.add(ink(this, WORLD.W / 2, 96, 'Schaut heimlich auf eure Rolle!', { color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 112, 'Karte am Handy antippen –\nniemand darf mitlesen.', { color: '#7a5a3a' }));
    this.layer.add(ink(this, WORLD.W / 2, 140, `Im Haus: ${roleSummary(w.roleCounts)}`, { color: BLUE_INK, wrap: 340 }));
  }

  private renderNight(w: WolfState) {
    this.layer.add(panel(this, 60, 50, 360, 120, 'dark'));
    this.layer.add(txt(this, WORLD.W / 2, 58, `NACHT ${w.day}`, { size: 16, color: GOLD }));
    this.layer.add(txt(this, WORLD.W / 2, 82, 'Alle Augen zu – Handys umdrehen!', { color: '#fff4d6' }));
    this.layer.add(txt(this, WORLD.W / 2, 96, 'Jeder tippt heimlich am eigenen Handy.', { color: '#b9c3ff' }));
    const line = w.sub === 'witch' ? 'Die Hexe braut ihre Tränke ...' : 'Die Werwölfe schleichen ums Haus ...';
    const t = txt(this, WORLD.W / 2, 118, line, { color: w.sub === 'witch' ? '#7fd47f' : '#ff9a8a' });
    this.layer.add(t);
    this.tweens.add({ targets: t, alpha: { from: 1, to: 0.45 }, duration: 900, yoyo: true, repeat: -1 });
    if (w.sub === 'night') this.layer.add(txt(this, WORLD.W / 2, 144, `${w.nightDone}/${w.nightTotal} fertig`, { color: GOLD }));
    else this.layer.add(txt(this, WORLD.W / 2, 144, 'Alle anderen zählen Schäfchen.', { color: '#b9c3ff' }));
  }

  /** Tote mit aufgedeckter Rolle */
  private renderDeaths(w: WolfState, title: string, empty: string) {
    this.bigPanel();
    this.layer.add(ink(this, WORLD.W / 2, 58, title, { size: 16 }));
    if (!w.deaths.length) {
      this.layer.add(ink(this, WORLD.W / 2, 96, empty, { color: GREEN_INK }));
    } else {
      const n = w.deaths.length;
      w.deaths.forEach((d, i) => {
        const p = playerById(d.id);
        const x = WORLD.W / 2 + (i - (n - 1) / 2) * 130;
        const role = w.revealed[d.id] ?? 'dorf';
        this.layer.add(ink(this, x, 80, `${p?.name ?? '?'}`));
        this.layer.add(ink(this, x, 94, WOLF_ROLES[role].name.toUpperCase(), { color: WOLF_ROLES[role].color }));
        this.layer.add(ink(this, x, 108, WOLF_CAUSE_TEXT[d.cause], { color: '#7a5a3a', wrap: 124 }));
        if (p) {
          // liegt flach (Kopf nach links)
          const f = figure(this, p.look, x + 20, 142, 1.5);
          f.setAngle(-90);
          this.layer.add(f);
        }
      });
    }
    if (w.sub === 'dawn' && w.suspect) {
      this.layer.add(ink(this, WORLD.W / 2, 152, `Nachts am meisten verdächtigt: ${playerById(w.suspect)?.name ?? '?'}`, { color: BLUE_INK }));
    }
  }

  private renderDay(w: WolfState) {
    this.bigPanel();
    this.layer.add(ink(this, WORLD.W / 2, 58, `TAG ${w.day}: DISKUTIERT!`, { size: 16, color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 84, 'Wer von euch ist ein Werwolf?', {}));
    this.layer.add(ink(this, WORLD.W / 2, 100, 'Tote reden nicht mehr mit!', { color: '#7a5a3a' }));
    const head = this.add.image(WORLD.W / 2, 132, ensureTex(this, 'wolf_head', wolfHead)).setScale(1.5);
    this.layer.add(head);
    this.tweens.add({ targets: head, y: 128, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.layer.add(ink(this, WORLD.W / 2, 154, 'Danach wird am Handy abgestimmt.', { color: BLUE_INK }));
  }

  private renderVote(w: WolfState, players: PlayerPublic[]) {
    this.bigPanel();
    this.layer.add(ink(this, WORLD.W / 2, 58, 'ABSTIMMUNG', { size: 16, color: BLUE_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 84, 'Wer muss das Ferienhaus verlassen?', {}));
    this.layer.add(ink(this, WORLD.W / 2, 100, 'Am Handy wählen – Gleichstand: niemand.', { color: '#7a5a3a' }));
    const voters = players.filter((p) => w.alive[p.id] && p.connected).length;
    this.layer.add(ink(this, WORLD.W / 2, 130, `${w.voted.length}/${voters} Stimmen`, { size: 16 }));
  }

  private renderVerdict(w: WolfState) {
    this.bigPanel();
    const name = (id: string) => (id === 'none' ? 'Niemand' : (playerById(id)?.name ?? '?'));
    // Stimmen zählen (öffentlich – wie Handheben)
    const tally = new Map<string, string[]>();
    for (const [voter, t] of Object.entries(w.votes ?? {})) tally.set(t, [...(tally.get(t) ?? []), playerById(voter)?.name ?? '?']);
    const rows = [...tally.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 4);
    if (w.lynched) {
      const role = w.revealed[w.lynched] ?? 'dorf';
      this.layer.add(ink(this, WORLD.W / 2, 56, `${name(w.lynched)} muss raus!`, { size: 16, color: RED_INK }));
      const r = ink(this, WORLD.W / 2, 78, `... war ${role === 'wolf' ? 'ein WERWOLF!' : role === 'dorf' ? 'nur Urlauber.' : `die ${WOLF_ROLES[role].name.toUpperCase()}.`}`, { color: WOLF_ROLES[role].color });
      if (role === 'jaeger') r.setText('... war der JÄGER!');
      this.layer.add(r);
      this.tweens.add({ targets: r, scale: { from: 1.3, to: 1 }, duration: 500, ease: 'Back.Out' });
    } else {
      this.layer.add(ink(this, WORLD.W / 2, 56, w.tie ? 'Gleichstand!' : 'Niemand muss raus.', { size: 16, color: BLUE_INK }));
      this.layer.add(ink(this, WORLD.W / 2, 78, w.tie ? 'Bei Gleichstand fliegt niemand raus.' : 'Die Werwölfe reiben sich die Pfoten ...', { color: '#7a5a3a' }));
    }
    rows.forEach(([t, voters], i) => {
      this.layer.add(ink(this, 80, 100 + i * 16, `${name(t).slice(0, 10)}: ${voters.length}`, { origin: [0, 0], color: t === w.lynched ? RED_INK : '#3d2414' }));
      this.layer.add(ink(this, 208, 100 + i * 16, voters.join(', ').slice(0, 25), { origin: [0, 0], color: '#7a5a3a' }));
    });
    if (!rows.length) this.layer.add(ink(this, WORLD.W / 2, 110, 'Keine Stimmen abgegeben.', { color: '#7a5a3a' }));
  }

  private renderHunter(w: WolfState) {
    this.bigPanel();
    const hunter = playerById(w.hunter)?.name ?? '?';
    this.layer.add(ink(this, WORLD.W / 2, 58, 'DER JÄGER!', { size: 16, color: WOLF_ROLES.jaeger.color }));
    if (!w.shotDone) {
      this.layer.add(ink(this, WORLD.W / 2, 84, `${hunter} legt ein letztes Mal an ...`, {}));
      this.layer.add(ink(this, WORLD.W / 2, 100, 'Wen nimmt der Jäger mit?', { color: '#7a5a3a' }));
      const t = ink(this, WORLD.W / 2, 128, '+', { size: 24, color: RED_INK });
      this.layer.add(t);
      this.tweens.add({ targets: t, x: { from: WORLD.W / 2 - 40, to: WORLD.W / 2 + 40 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    } else if (w.shot) {
      const role = w.revealed[w.shot] ?? 'dorf';
      this.layer.add(ink(this, WORLD.W / 2, 84, `PENG! ${hunter} nimmt ${playerById(w.shot)?.name ?? '?'} mit.`, { wrap: 280 }));
      this.layer.add(ink(this, WORLD.W / 2, 112, `${playerById(w.shot)?.name ?? '?'} war: ${WOLF_ROLES[role].name.toUpperCase()}`, { color: WOLF_ROLES[role].color }));
    } else {
      this.layer.add(ink(this, WORLD.W / 2, 90, `${hunter} hat danebengeschossen!`, {}));
    }
  }

  private renderOver(w: WolfState) {
    this.bigPanel();
    const wolf = w.winner === 'wolf';
    const t = ink(this, WORLD.W / 2, 58, wolf ? 'WÖLFE GEWINNEN!' : 'URLAUBER GEWINNEN!', { size: 16, color: wolf ? RED_INK : GREEN_INK });
    this.layer.add(t);
    this.tweens.add({ targets: t, scale: { from: 1.25, to: 1 }, duration: 600, ease: 'Back.Out' });
    this.layer.add(ink(this, WORLD.W / 2, 80, w.winReason ?? '', { wrap: 330, color: '#7a5a3a' }));
    const wolves = Object.entries(w.roles ?? {}).filter(([, r]) => r === 'wolf').map(([id]) => playerById(id)?.name ?? '?');
    this.layer.add(ink(this, WORLD.W / 2, 108, `${wolves.length > 1 ? 'Die Werwölfe waren' : 'Der Werwolf war'}:`, {}));
    this.layer.add(ink(this, WORLD.W / 2, 122, wolves.join(' & '), { color: RED_INK, wrap: 330 }));
    const head = this.add.image(WORLD.W / 2, 152, ensureTex(this, 'wolf_head', wolfHead));
    this.layer.add(head);
    if (wolf) this.tweens.add({ targets: head, angle: { from: -8, to: 8 }, duration: 300, yoyo: true, repeat: -1 });
  }

  /** Alle Spieler unten: Tote liegen (mit Rolle), Abgestimmte bekommen ein OK */
  private renderRow(w: WolfState, players: PlayerPublic[]) {
    const n = players.length;
    const spacing = Math.min(38, 456 / Math.max(1, n));
    const maxChars = Math.max(3, Math.floor(spacing / 8) - 1);
    const night = NIGHT_SUBS.has(w.sub);
    players.forEach((p, i) => {
      const x = WORLD.W / 2 + (i - (n - 1) / 2) * spacing;
      const y = 236;
      const alive = w.alive[p.id];
      if (alive) {
        const f = figure(this, p.look, x, y, 2);
        if (!p.connected) f.setAlpha(0.4);
        this.layer.add(f);
      } else {
        // Grabstein statt Figur
        const g = this.add.graphics();
        g.fillStyle(0x000000, 0.22).fillEllipse(x, y - 1, 30, 6);
        g.fillStyle(0x2d1b12).fillRoundedRect(x - 12, y - 30, 24, 30, { tl: 10, tr: 10, bl: 0, br: 0 });
        g.fillStyle(0xa7a39a).fillRoundedRect(x - 10, y - 28, 20, 28, { tl: 9, tr: 9, bl: 0, br: 0 });
        g.fillStyle(0xcfcbc1).fillRect(x - 8, y - 22, 3, 18);
        g.fillStyle(0x7f7b73).fillRect(x - 1, y - 24, 2, 12).fillRect(x - 5, y - 20, 10, 2);
        this.layer.add(g);
      }
      // Nachts schlafen alle (Zzz) – damit am TV niemand „aktiver“ aussieht
      if (alive && night && w.sub !== 'roles' && w.sub !== 'dawn') {
        const z = txt(this, x + 8, y - 40, 'z', { color: '#b9c3ff' });
        this.layer.add(z);
        this.tweens.add({ targets: z, y: y - 50, alpha: { from: 1, to: 0 }, duration: 1600, repeat: -1, delay: i * 170 });
      }
      this.layer.add(nameTag(this, x, y + 2, p.name.slice(0, maxChars), alive ? undefined : '#7a5a3a'));
      const role = w.sub === 'over' ? w.roles?.[p.id] : w.revealed[p.id];
      if (role) this.layer.add(txt(this, x, y + 16, WOLF_ROLES[role].short.slice(0, maxChars), { color: role === 'wolf' ? '#ff9a8a' : '#fff4d6' }));
      if (w.sub === 'vote' && w.voted.includes(p.id)) {
        this.layer.add(ink(this, x, y - 52, 'OK', { color: GREEN_INK }).setBackgroundColor('#f7e4b5').setPadding(2, 1, 2, 1));
      }
      if (w.sub === 'hunter' && w.hunter === p.id) this.layer.add(txt(this, x, y - 52, 'PENG', { color: GOLD }));
    });
  }
}
