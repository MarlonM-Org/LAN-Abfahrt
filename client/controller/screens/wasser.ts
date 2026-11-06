import { WASSER, WASSER_BASE, WASSER_COVER, WASSER_HOSE, type WasserPlayer, type WasserState, aimLanding, coverSaves } from '../../../shared/wasser';
import type { Point } from '../../../shared/types';
import { TEAM_INFO } from '../../../shared/flunky';
import { dropIcon, fastDropIcon, shieldIcon, sunIcon, towelIcon, waterBalloon, waterPistol } from '../../art/garden';
import type { Pix } from '../../art/pix';
import { type Screen, app, el, message, q, send, store } from '../core';
import { stickZone } from '../stick';
import { haptic } from '../haptic';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Dieselben Pixel-Symbole wie die Schilder auf dem TV (client/art/garden.ts), einmal als Bild-URL */
const ICONS = new Map<string, { url: string; w: number; h: number }>();
function icon(key: string, make: () => Pix) {
  let u = ICONS.get(key);
  if (!u) {
    const p = make();
    u = { url: p.canvas.toDataURL(), w: p.w, h: p.h };
    ICONS.set(key, u);
  }
  return u;
}
type Ico = 'drop' | 'fast' | 'towel' | 'shield' | 'sun' | 'pistol' | 'go';
const iconUrl = (k: Ico, me: WasserPlayer) => {
  switch (k) {
    case 'drop':
      return icon('drop', () => dropIcon());
    case 'fast':
      return icon('fast', fastDropIcon);
    case 'towel':
      return icon(`towel-${me.t ?? 'A'}`, () => towelIcon(TEAM_INFO[me.t ?? 'A'].color));
    case 'shield':
      return icon('shield', shieldIcon);
    case 'sun':
      return icon('sun', sunIcon);
    case 'pistol':
      return icon('pistol', waterPistol);
    default:
      return icon(`balloon-${me.c}`, () => waterBalloon(hex(me.c)));
  }
};

/** Richtung vom Spieler zu einem Ort – Bildschirm und TV liegen gleich herum (links = links) */
const ARROWS = ['➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️', '⬆️', '↗️'];
function dir(from: Point, to: Point) {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 16) return 'hier!';
  const i = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4));
  return `<b class="ws-arr">${ARROWS[((i % 8) + 8) % 8]}</b>`;
}
const nearest = (p: Point, pts: Point[]) => pts.reduce((a, b) => (Math.hypot(p.x - a.x, p.y - a.y) <= Math.hypot(p.x - b.x, p.y - b.y) ? a : b));
const nearCover = (p: Point) => WASSER_COVER.some((r) => Math.hypot(p.x - Math.max(r.x, Math.min(p.x, r.x + r.w)), p.y - Math.max(r.y, Math.min(p.y, r.y + r.h))) < 12);

/** Tipps, wenn gerade nichts Dringendes ansteht (reihum) */
const TIPS: { ico: Ico; hint: string; sub: string }[] = [
  { ico: 'shield', hint: 'Hecken + Liegen = Deckung', sub: 'Sie fangen Bomben ab' },
  { ico: 'sun', hint: 'Nicht getroffen?', sub: 'Die Sonne trocknet dich' },
  { ico: 'fast', hint: 'Schlauch in der Mitte', sub: 'füllt fast 3× schneller' },
  { ico: 'go', hint: 'Wenig ziehen = kurz', sub: 'voll ziehen = weit' },
];

export function pickWasser(s: WasserState): Screen {
  const id = store.playerId!;
  const me = s.players[id];
  if (!me) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') return ['ws-over', message(s.endReason === 'away' ? 'Spielende!' : 'Zeit um!', `${me.h} Treffer · ${me.n}× nass – schau auf den Fernseher!`)];
  return [
    `ws-${s.sub}`,
    () => {
      const team = me.t ? TEAM_INFO[me.t] : null;
      const side = me.t === 'A' ? 'links' : 'rechts';
      const badge = team
        ? `<span class="lx-tag team-${me.t}">${team.name} · Lager ${side}</span>`
        : `<span class="lx-tag" style="background:${hex(me.c)};color:#fff4d6">Jeder gegen jeden</span>`;
      // Quer wie ein Twin-Stick-Gamepad: linke Hälfte laufen, rechte Hälfte zielen (Loslassen = Wurf).
      // Mitte: Munition + Nässe groß, darunter eine Hinweis-Karte mit Symbol und Richtung (gleiche Symbole wie am TV)
      const root = el(`
        <div class="lx ws ws-lx">
          <div class="lx-head">
            ${badge}<span class="timer"></span>
            <span class="score grow"></span>
          </div>
          <div class="lx-left ws-move"><span class="st-label">LAUFEN · Daumen irgendwo aufsetzen</span></div>
          <div class="lx-mid ws-mid">
            <div class="ws-ammo">${'<i><b></b></i>'.repeat(WASSER.MAX_AMMO)}</div>
            <small class="ws-cap ws-ammo-cap">BOMBEN</small>
            <div class="ws-meter"><div></div></div>
            <small class="ws-cap ws-wet-cap">NÄSSE</small>
            <div class="ws-card"><img class="ws-ico" alt=""><p class="ws-hint"></p><p class="ws-sub"></p></div>
          </div>
          <div class="lx-right ws-aim"><span class="st-label ws-aim-label">ZIELEN · LOSLASSEN = WURF</span></div>
        </div>
      `);
      stickZone(q(root, '.ws-move'), (x, y) => send('stick', { x, y }));
      // Ziel-Stick: Ziehen = Richtung + Weite (Vorschau auf dem TV), Loslassen = werfen, nur antippen bricht ab.
      // Weite wächst quadratisch (shared/wasser.ts throwDist): ein kleines Stück ziehen = Wurf direkt neben einen selbst.
      stickZone(q(root, '.ws-aim'), (x, y) => send('aim', { x, y }), {
        radius: 64,
        trailing: false,
        step: 0.03,
        onRelease: (x, y, ok) => {
          if (ok && Math.hypot(x, y) >= WASSER.AIM_MIN) {
            send('throw', { x, y });
            haptic(15);
          } else send('aim', { x: 0, y: 0 });
        },
      });
      app.append(root);
      const wrap = q(root, '.ws');
      const fill = q(root, '.ws-meter > div');
      const pips = [...root.querySelectorAll<HTMLElement>('.ws-ammo i')];
      const card = q(root, '.ws-card');
      const ico = q<HTMLImageElement>(root, '.ws-ico');
      const wetCapEl = q(root, '.ws-wet-cap');
      const balloon = iconUrl('go', me).url;
      for (const b of root.querySelectorAll<HTMLElement>('.ws-ammo b')) b.style.backgroundImage = `url(${balloon})`;
      let prevWet = me.w;
      let prevSoaked = me.n;
      let prevAmmo = me.a;
      let prevPistol = me.pi > 0;
      /** Kurze Hinweise, die eine Weile stehen bleiben (Deckung zum ersten Mal, Deckung rettet gerade) */
      let flash: { until: number; ico: Ico; hint: string; sub: string; cls: string } | null = null;
      let coverSeen = false;
      let lastKey = '';
      return () => {
        const st = store.state?.mini?.kind === 'wasser' ? store.state.mini.state : null;
        const p = st?.players[id];
        if (!st || !p) return;
        const now = Date.now();
        const practice = store.state?.phase === 'intro';
        q(root, '.timer').textContent = practice ? 'ÜBUNG' : `${Math.ceil(st.endsIn / 1000)}s`;
        q(root, '.score').textContent = practice ? 'nichts zählt' : st.ffa ? `${p.k}× nass gemacht` : `Sonne ${st.score.A} : ${st.score.B} Meer`;

        // Munition: volle Ballons, der nächste füllt sich beim Nachfüllen von unten
        pips.forEach((d, i) => {
          const f = p.s !== 'ok' ? 0 : i < p.a ? 1 : i === p.a && p.rf ? p.rf : 0;
          d.style.setProperty('--f', String(f));
          d.classList.toggle('full', f >= 1);
        });
        q(root, '.ws-ammo-cap').textContent = p.pi > 0 ? `PISTOLE ${Math.ceil(p.pi / 1000)} s` : p.rf ? `FÜLLT AUF ${p.a}/${WASSER.MAX_AMMO}` : `BOMBEN ${p.a}/${WASSER.MAX_AMMO}`;
        // Nässe (beim Abtrocknen läuft der Balken leer)
        const wet = p.s === 'drying' ? Math.round((1 - p.dp) * 100) : p.w;
        fill.style.width = `${wet}%`;
        fill.className = p.s !== 'ok' || p.w >= 70 ? 'danger' : '';
        const wetCap =
          p.s === 'soaked' ? (p.sk > 0 ? `sonst getragen in ${Math.ceil(p.sk / 1000)} s` : 'NÄSSE 100 %') : p.s === 'drying' ? 'ABTROCKNEN …' : p.dr ? `NÄSSE ${p.w} % · trocknet` : `NÄSSE ${p.w} %`;
        if (wetCap !== wetCapEl.dataset.t) {
          wetCapEl.dataset.t = wetCap;
          wetCapEl.innerHTML = `${wetCap}${p.dr && p.s === 'ok' ? ` <img class="ws-sunmini" src="${iconUrl('sun', p).url}" alt="">` : ''}`;
        }

        // Hinweis-Karte: das Dringendste zuerst, mit Richtung
        const bases = (p.t ? [WASSER_BASE[p.t]] : [WASSER_BASE.A, WASSER_BASE.B]);
        const bucket = nearest(p, bases.map((b) => b.bucket));
        const towel = nearest(p, bases.map((b) => b.towel));
        const enemyAim = Object.entries(st.players).find(
          ([oid, o]) => oid !== id && (st.ffa || o.t !== p.t) && o.s === 'ok' && o.pi === 0 && Math.hypot(o.ax, o.ay) >= WASSER.AIM_MIN && coverSaves(aimLanding(o), p),
        );
        if (p.s === 'ok' && enemyAim) flash = { until: now + 1200, ico: 'shield', hint: 'Deckung schützt dich!', sub: 'Bleib dahinter', cls: 'c-cover' };
        if (!coverSeen && p.s === 'ok' && st.sub === 'play' && nearCover(p)) {
          coverSeen = true;
          flash = { until: now + 4000, ico: 'shield', hint: 'Hinter Hecken bist du geschützt', sub: 'Liegen fangen auch Bomben ab', cls: 'c-cover' };
        }
        let c: { ico: Ico; hint: string; sub: string; cls: string };
        if (st.sub === 'countdown') c = { ico: 'go', hint: 'Gleich geht’s los!', sub: 'Links laufen · rechts zielen', cls: 'c-tip' };
        else if (p.s === 'soaked') c = { ico: 'towel', hint: 'KLATSCHNASS!', sub: `Ab zum Handtuch ${dir(p, towel)}`, cls: 'c-soak c-urgent' };
        else if (p.s === 'drying') c = { ico: 'towel', hint: 'Abtrocknen …', sub: 'gleich geht’s weiter', cls: 'c-soak' };
        else if (p.pi > 0) c = { ico: 'pistol', hint: 'WASSERPISTOLE!', sub: `Rechts zielen = spritzen · ${Math.ceil(p.pi / 1000)} s`, cls: 'c-pistol' };
        else if (p.rf) c = { ico: p.rh ? 'fast' : 'drop', hint: `Füllt auf … ${p.a}/${WASSER.MAX_AMMO}`, sub: p.rh ? 'Schlauch: schnell!' : 'stehen bleiben', cls: 'c-refill' };
        else if (p.a === 0) c = { ico: 'drop', hint: 'Keine Bomben!', sub: `Eimer ${dir(p, bucket)} · Schlauch ${dir(p, WASSER_HOSE)}`, cls: 'c-refill c-urgent' };
        else if (flash && now < flash.until) c = flash;
        else if (p.w >= 70) c = { ico: 'shield', hint: 'Fast klatschnass!', sub: 'Ab hinter Hecke oder Liege', cls: 'c-cover c-urgent' };
        else if (st.pistol) c = { ico: 'pistol', hint: 'Wasserpistole liegt aus!', sub: `Drüberlaufen ${dir(p, st.pistol)}`, cls: 'c-pistol' };
        else if (p.dr) c = { ico: 'sun', hint: 'Die Sonne trocknet dich', sub: 'nicht getroffen werden!', cls: 'c-sun' };
        else {
          const t = TIPS[Math.floor(now / 6000) % TIPS.length];
          c = { ...t, cls: 'c-tip' };
        }
        const key = `${c.ico}|${c.hint}|${c.sub}|${c.cls}`;
        if (key !== lastKey) {
          lastKey = key;
          // Ganzzahlig hochskaliert (Pixel-Look), etwa 30–36 px groß
          const im = iconUrl(c.ico, p);
          const k = Math.max(1, Math.floor(36 / Math.max(im.w, im.h)));
          ico.src = im.url;
          ico.style.width = `${im.w * k}px`;
          ico.style.height = `${im.h * k}px`;
          q(root, '.ws-hint').textContent = c.hint;
          // Nur feste Texte, Zahlen und Pfeile (dir) – kein Spielername
          q(root, '.ws-sub').innerHTML = c.sub;
          card.className = `ws-card ${c.cls}`;
        }

        const empty = p.s === 'ok' && p.a === 0 && p.pi === 0;
        q(root, '.ws-aim-label').textContent =
          p.s === 'soaked' ? 'KLATSCHNASS – ERST ZUM HANDTUCH' : p.s === 'drying' ? 'ABTROCKNEN …' : p.pi > 0 ? 'SPRITZEN! Ziehen = Richtung' : empty ? 'LEER – ERST AUFFÜLLEN' : 'ZIELEN · LOSLASSEN = WURF';
        wrap.classList.toggle('soaked', p.s !== 'ok');
        wrap.classList.toggle('empty', empty);
        wrap.classList.toggle('pistol', p.pi > 0);
        if (p.n > prevSoaked) haptic([80, 60, 160]);
        else if (p.w > prevWet + 5) haptic(40);
        else if (p.s === 'ok' && p.a > prevAmmo) haptic(10);
        if (!prevPistol && p.pi > 0) haptic([30, 40, 30]);
        prevWet = p.w;
        prevSoaked = p.n;
        prevAmmo = p.a;
        prevPistol = p.pi > 0;
      };
    },
  ];
}
