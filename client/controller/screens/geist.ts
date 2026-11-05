import type { GeistPrivate, GeistState } from '../../../shared/types';
import { GEIST, conePolygon, drawGeistMap } from '../../../shared/geist';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store, tapButton } from '../core';
import { stickZone } from '../stick';
import { haptic } from '../haptic';
import { ghostSprite } from '../../art/geist';

const geist = () => (store.state?.mini?.kind === 'geist' ? store.state.mini.state : null);
const priv = (): GeistPrivate | null => (store.priv?.kind === 'geist' ? store.priv.state : null);

const ghostIds = (g: GeistState) => (g.ghostIds?.length ? g.ghostIds : [g.ghostId]);
const mates = (g: GeistState) => ghostIds(g).filter((id) => id !== store.playerId);

/** Android: Vibration, iPhone: Klick + Rand-Blitz (haptic.ts) */
const vibrate = (pattern: number | number[]) => haptic(pattern);

export function pickGeist(g: GeistState): Screen {
  const p = priv();
  if (!p) return ['g-wait', message('Moment ...')];
  const ghost = p.role === 'ghost';
  switch (g.sub) {
    case 'intro':
      return [`g-intro-${g.round}-${p.role}`, () => buildIntro(g, ghost)];
    case 'play':
      return ghost ? [`g-ghost-${g.round}`, buildGhost] : [`g-hunter-${g.round}`, buildHunter];
    case 'roundEnd': {
      const won = (g.roundWinner === 'ghost') === ghost;
      return [`g-end-${g.round}`, message(won ? 'GEWONNEN!' : 'VERLOREN!', g.roundReason ?? '')];
    }
    case 'over':
      return ['g-over', message('Geisterjagd vorbei!', 'Schau auf den Fernseher!')];
  }
}

function buildIntro(g: GeistState, ghost: boolean) {
  const root = ghost
    ? el(`
      <h1>DU BIST DER GEIST!</h1>
      <div class="ghost-face"></div>
      <div class="panel">
        <p class="label-left">Auf dem Fernseher bist du unsichtbar – nur dein Handy zeigt dir, wo du bist.</p>
        <p class="label-left">Schleich dich an die Jäger an und berühre sie: BUH! Aber nicht im Lichtkegel – Licht tut weh.</p>
        <p class="label-left">Bei Blitzen sieht dich kurz jeder!</p>
        ${mates(g).length ? `<p class="label-left">Mitgeist: <b>${escapeHtml(mates(g).map(nameOf).join(', '))}</b> – ihr spukt zu zweit (grauer Kreis auf der Karte).</p>` : ''}
      </div>
      <p class="timer"></p>`)
    : el(`
      <h1>GEISTERJÄGER</h1>
      <h2>${escapeHtml(ghostIds(g).map(nameOf).join(' und '))} ${ghostIds(g).length > 1 ? 'sind die Geister!' : 'ist der Geist!'}</h2>
      <div class="panel">
        <p class="label-left">Joystick = laufen. Die Taschenlampe leuchtet in Laufrichtung.</p>
        <p class="label-left">Licht an leert den Akku. Leer? Dann kurz stehen bleiben und laden.</p>
        <p class="label-left">Brummt dein Handy / steigt die Gänsehaut, ist der Geist nah!</p>
        <p class="label-left">Erschreckte Freunde rettest du, indem du 2 s neben ihnen stehst.</p>
      </div>
      <p class="timer"></p>`);
  const face = root.querySelector('.ghost-face');
  if (face) {
    const c = ghostSprite('boo').canvas;
    c.className = 'ghost-img';
    face.append(c);
  }
  app.append(root);
  return () => {
    const st = geist();
    if (st) q(root, '.timer').textContent = `Los geht’s in ${Math.ceil(st.endsIn / 1000)}s`;
  };
}

// ------------------------------------------------------------------ Jäger

function buildHunter() {
  // Quer: links Stick, Mitte Gänsehaut-Meter, rechts LICHT (mit Akku)
  const root = el(`
    <div class="lx gs-lx gs-hunt">
      <div class="lx-head"><span class="lx-tag gs-tag">JÄGER</span><span class="timer"></span><span class="ghost-hp grow"></span></div>
      <div class="lx-left gs-stick"><span class="st-label">LAUFEN · Lampe leuchtet in Laufrichtung</span></div>
      <div class="lx-mid">
        <div class="fear-box">
          <div class="fear-head"><span>GÄNSEHAUT</span><span class="fear-word"></span></div>
          <div class="meter fear"><div></div></div>
        </div>
        <div class="dead-banner hidden down-banner">BUH! Du liegst vor Schreck am Boden. Ein Mitspieler muss 2 s neben dir stehen!</div>
      </div>
      <div class="lx-right"><button class="big-btn light-btn"><span class="light-label">LICHT AN</span><div class="meter battery"><div></div></div></button></div>
    </div>
  `);
  stickZone(q(root, '.gs-stick'), (x, y) => send('stick', { x, y }));
  const lightBtn = q<HTMLButtonElement>(root, '.light-btn');
  tapButton(lightBtn, () => {
    send('light');
    vibrate(15);
  });
  app.append(root);
  const fearBox = q(root, '.fear-box');
  let nextVib = 0;

  return () => {
    const st = geist();
    const p = priv();
    if (!st || !p || p.role !== 'hunter') return;
    const me = st.hunters[store.playerId!];
    q(root, '.timer').textContent = `${Math.ceil(st.endsIn / 1000)}s`;
    q(root, '.ghost-hp').textContent = `${ghostIds(st).length > 1 ? 'Geister' : 'Geist'} ${Math.round((st.health / st.maxHealth) * 100)}%`;
    const fear = me?.down ? 0 : p.fear;
    (q(root, '.fear > div') as HTMLElement).style.width = `${Math.round(fear * 100)}%`;
    q(root, '.fear-word').textContent = fear > 0.7 ? 'GANZ NAH!' : fear > 0.4 ? 'kalt ...' : fear > 0.1 ? 'hm?' : 'ruhig';
    fearBox.classList.toggle('shiver', fear > 0.4);
    fearBox.style.setProperty('--shiver', `${Math.max(0.08, 0.5 - fear * 0.4)}s`);
    // Brummen: je näher, desto öfter und länger
    const now = performance.now();
    if (fear > 0.1 && now >= nextVib) {
      vibrate(Math.round(30 + fear * 90));
      nextVib = now + 1000 - fear * 750;
    }
    if (!me) return;
    q(root, '.down-banner').classList.toggle('hidden', !me.down);
    (q(root, '.battery > div') as HTMLElement).style.width = `${Math.round(me.battery * 100)}%`;
    q(root, '.battery').classList.toggle('low', me.battery < 0.3);
    lightBtn.classList.toggle('on', me.light);
    lightBtn.disabled = me.down || me.empty;
    q(root, '.light-label').textContent = me.down ? 'ERSCHRECKT' : me.empty ? 'AKKU LÄDT ...' : me.light ? 'LICHT AUS' : 'LICHT AN';
  };
}

// ------------------------------------------------------------------ Geist

function buildGhost() {
  // Quer: die private Karte groß in der Mitte, Stick links, Leben/Status rechts
  const root = el(`
    <div class="lx gs-lx gs-ghost">
      <div class="lx-head"><span class="lx-tag gs-tag ghost">GEIST</span><span class="timer"></span><span class="hp"></span><span class="meter ghost-life grow"><div></div></span></div>
      <div class="lx-left gs-stick"><span class="st-label">SCHWEBEN</span></div>
      <div class="lx-mid"><canvas class="geist-map" width="464" height="242"></canvas></div>
      <div class="lx-right gs-side">
        <p class="ghost-status"></p>
        <p class="map-legend">Du = weißer Kreis<br/>Gelb = Jäger<br/>Kegel = Licht</p>
      </div>
    </div>
  `);
  stickZone(q(root, '.gs-stick'), (x, y) => send('stick', { x, y }));
  app.append(root);
  const canvas = q<HTMLCanvasElement>(root, '.geist-map');
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  // Grundriss einmal vorzeichnen
  const base = document.createElement('canvas');
  base.width = 480;
  base.height = 270;
  drawGeistMap(base.getContext('2d')!);
  let wasLit = false;

  return () => {
    const st = geist();
    const p = priv();
    if (!st || !p || p.role !== 'ghost') return;
    q(root, '.timer').textContent = `${Math.ceil(st.endsIn / 1000)}s`;
    const frac = p.hp ?? st.health / st.maxHealth;
    q(root, '.hp').textContent = `Leben ${Math.round(frac * 100)}%`;
    (q(root, '.ghost-life > div') as HTMLElement).style.width = `${Math.round(frac * 100)}%`;
    const status = q(root, '.ghost-status');
    status.textContent = p.out ? 'GEBANNT! Dein Mitgeist spukt weiter.' : p.lit ? 'IM LICHT! WEG HIER!' : st.ghost?.why === 'flash' ? 'Blitz! Alle sehen dich!' : p.cooldown > 0 ? 'Buh ... gleich wieder bereit' : 'Unsichtbar – schleich dich an!';
    status.classList.toggle('danger-text', p.lit);
    if (p.lit && !wasLit) vibrate([60, 40, 60]);
    wasLit = p.lit;

    // Karte
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(base, -8, -26);
    g.setTransform(1, 0, 0, 1, -8, -26);
    for (const h of Object.values(st.hunters)) {
      if (h.light && !h.down) {
        const poly = conePolygon(h.x, h.y, h.angle, 10);
        g.fillStyle = 'rgba(255,217,122,0.35)';
        g.beginPath();
        poly.forEach((pt, i) => (i ? g.lineTo(pt.x, pt.y) : g.moveTo(pt.x, pt.y)));
        g.closePath();
        g.fill();
      }
    }
    for (const [id, h] of Object.entries(st.hunters)) {
      g.fillStyle = h.down ? '#7d7896' : '#ffd25e';
      g.strokeStyle = '#1a1530';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(h.x, h.y, GEIST.R + 1, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (!h.down) {
        // Blickrichtung
        g.strokeStyle = '#ffd25e';
        g.beginPath();
        g.moveTo(h.x, h.y);
        g.lineTo(h.x + Math.cos(h.angle) * 13, h.y + Math.sin(h.angle) * 13);
        g.stroke();
      }
      g.fillStyle = '#e8e2ff';
      g.font = '12px "Press Start 2P", monospace';
      g.textAlign = 'center';
      g.strokeStyle = '#1a1530';
      g.lineWidth = 3;
      const label = nameOf(id).replace(/^Bot\s+/, '').slice(0, 4);
      g.strokeText(label, h.x, h.y - 11);
      g.fillText(label, h.x, h.y - 11);
    }
    // Mitgeist (ab 7 Spielern)
    for (const m of p.mates ?? []) {
      g.fillStyle = m.out ? 'rgba(125,120,150,0.5)' : 'rgba(244,241,255,0.55)';
      g.strokeStyle = '#6b4fa8';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(m.x, m.y, GEIST.R + 2, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // Ich
    const pulse = 2 + Math.sin(performance.now() / 150) * 1.5;
    g.fillStyle = p.lit ? '#ff6b5e' : '#f4f1ff';
    g.strokeStyle = '#9b5fc0';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(p.x, p.y, GEIST.R + 2 + pulse, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#2a2340';
    g.fillRect(p.x - 4, p.y - 3, 2, 3);
    g.fillRect(p.x + 2, p.y - 3, 2, 3);
    // Reichweite fürs Erschrecken
    g.strokeStyle = 'rgba(244,241,255,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(p.x, p.y, GEIST.SCARE_DIST + 4, 0, Math.PI * 2);
    g.stroke();
  };
}
