import type { IgelState, IgelWeapon } from '../../../shared/types';
import { IGEL, IGEL_COLORS, WEAPONS, WEAPON_ORDER, type Mask, buildTerrain, carve, windArrows } from '../../../shared/igel';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store, tapButton } from '../core';

const igel = () => (store.state?.mini?.kind === 'igel' ? store.state.mini.state : null);
const teamColor = (st: IgelState, id: string) => IGEL_COLORS[Math.max(0, st.teams.indexOf(id)) % IGEL_COLORS.length];

export function pickIgel(s: IgelState): Screen {
  const id = store.playerId!;
  if (!s.teams.includes(id)) return ['spectate', message('Du schaust zu', 'Nächstes Spiel bist du dabei!')];
  if (s.sub === 'countdown') {
    const n = s.hogs.filter((h) => h.owner === id).length;
    return [
      'ig-count',
      message(
        'Igel-Krieg!',
        `Du hast ${n === 1 ? 'einen Igel' : `${n} Igel`} auf der Insel. Wenn du dran bist: laufen, Waffe wählen, im Zielfeld ziehen (Richtung = Winkel, Länge = Kraft) und loslassen. Wasser = raus!`,
      ),
    ];
  }
  if (s.sub === 'over') {
    const alive = s.hogs.some((h) => h.owner === id && h.state === 'ok');
    return ['ig-over', message(alive ? 'Überlebt!' : 'Vorbei!', 'Schau auf den Fernseher!')];
  }
  if (s.active === id) return [`ig-me-${s.turn}`, () => buildActive(s.turn)];
  return ['ig-watch', buildWatch];
}

function windText(w: number) {
  return Math.abs(w) < 0.17 ? 'Wind: still' : `Wind ${windArrows(w)}`;
}

// ------------------------------------------------------------------ Aktiver Spieler

function buildActive(turn: number) {
  const root = el(`
    <div class="top-row"><span class="timer"></span><span class="ig-wind"></span></div>
    <h2 class="ig-head">Du bist dran!</h2>
    <div class="ig-weapons"></div>
    <div class="ig-pad">
      <canvas></canvas>
      <p class="pad-text"></p>
    </div>
    <div class="ig-move">
      <button class="ig-left">◀</button>
      <button class="ig-jump">SPRUNG</button>
      <button class="ig-right">▶</button>
    </div>
    <button class="ig-done hidden">Fertig – Zug beenden</button>
  `);
  app.append(root);

  // Waffenmenü
  const wrap = q(root, '.ig-weapons');
  const wBtns = new Map<IgelWeapon, HTMLButtonElement>();
  for (const w of WEAPON_ORDER) {
    const b = el(`<button class="ig-weapon ig-w-${w}"><span>${WEAPONS[w].short}</span><small></small></button>`).firstElementChild as HTMLButtonElement;
    tapButton(b, () => {
      if (b.disabled) return;
      send('weapon', { weapon: w });
      navigator.vibrate?.(8);
    });
    wrap.append(b);
    wBtns.set(w, b);
  }

  // Laufen + Springen (gedrückt halten)
  const hold = (btn: HTMLElement, dir: -1 | 1) => {
    let down = false;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      down = true;
      send('move', { dir });
    });
    const up = () => {
      if (!down) return;
      down = false;
      send('move', { dir: 0 });
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  hold(q(root, '.ig-left'), -1);
  hold(q(root, '.ig-right'), 1);
  tapButton(q(root, '.ig-jump'), () => {
    send('jump');
    navigator.vibrate?.(10);
  });
  tapButton(q(root, '.ig-done'), () => send('done'));

  // Zielfeld: ziehen = Richtung + Kraft, loslassen = Feuer
  const pad = q(root, '.ig-pad');
  const canvas = q<HTMLCanvasElement>(root, '.ig-pad canvas');
  const padText = q(root, '.pad-text');
  const g = canvas.getContext('2d')!;
  let drag: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  let lastSent = 0;
  let fired = false;
  let firedAt = 0;
  const maxLen = () => Math.min(pad.clientWidth, pad.clientHeight) * 0.48;
  const vec = () => {
    if (!drag) return null;
    const dx = drag.x - drag.x0;
    const dy = drag.y - drag.y0;
    const len = Math.hypot(dx, dy);
    return { angle: Math.atan2(dy, dx), power: Math.min(1, len / maxLen()), len };
  };
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = pad.clientWidth;
    const h = pad.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const v = vec();
    if (!drag || !v) return;
    const L = Math.min(v.len, maxLen());
    const ex = drag.x0 + Math.cos(v.angle) * L;
    const ey = drag.y0 + Math.sin(v.angle) * L;
    // Reichweitenkreis
    g.strokeStyle = 'rgba(94,53,24,0.35)';
    g.setLineDash([4, 6]);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(drag.x0, drag.y0, maxLen(), 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    // Pfeil (Farbe nach Kraft: grün → rot)
    const hue = 120 - v.power * 120;
    g.strokeStyle = `hsl(${hue}, 70%, 40%)`;
    g.fillStyle = g.strokeStyle;
    g.lineWidth = 8;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(drag.x0, drag.y0);
    g.lineTo(ex, ey);
    g.stroke();
    g.beginPath();
    g.moveTo(ex + Math.cos(v.angle) * 14, ey + Math.sin(v.angle) * 14);
    g.lineTo(ex + Math.cos(v.angle + 2.3) * 14, ey + Math.sin(v.angle + 2.3) * 14);
    g.lineTo(ex + Math.cos(v.angle - 2.3) * 14, ey + Math.sin(v.angle - 2.3) * 14);
    g.closePath();
    g.fill();
    g.fillStyle = '#3d2414';
    g.beginPath();
    g.arc(drag.x0, drag.y0, 7, 0, Math.PI * 2);
    g.fill();
  };
  const canAim = () => igel()?.sub === 'aim' && igel()?.active === store.playerId && !fired;
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!canAim() || drag) return;
    pad.setPointerCapture(e.pointerId);
    const r = pad.getBoundingClientRect();
    drag = { id: e.pointerId, x0: e.clientX - r.left, y0: e.clientY - r.top, x: e.clientX - r.left, y: e.clientY - r.top };
    draw();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = pad.getBoundingClientRect();
    drag.x = e.clientX - r.left;
    drag.y = e.clientY - r.top;
    draw();
    const v = vec()!;
    padText.textContent = `Kraft ${Math.round(v.power * 100)}%`;
    const now = performance.now();
    if (now - lastSent > 90 && v.len > 12) {
      lastSent = now;
      send('aim', { angle: Math.round(v.angle * 100) / 100, power: Math.round(v.power * 100) / 100 });
    }
  });
  const release = (e: PointerEvent, cancel = false) => {
    if (!drag || e.pointerId !== drag.id) return;
    const v = vec()!;
    drag = null;
    draw();
    if (cancel || v.len < 18 || !canAim()) {
      send('aim', { angle: null });
      return;
    }
    fired = true;
    firedAt = performance.now();
    navigator.vibrate?.(40);
    send('fire', { angle: v.angle, power: v.power });
  };
  pad.addEventListener('pointerup', (e) => release(e));
  pad.addEventListener('pointercancel', (e) => release(e, true));

  return () => {
    const st = igel();
    if (!st || st.turn !== turn) return;
    // Schuss wurde abgelehnt (z. B. Teleport-Ziel ungültig) → wieder zielen lassen
    if (fired && st.sub === 'aim' && performance.now() - firedAt > 1200) fired = false;
    q(root, '.timer').textContent = st.sub === 'aim' || st.sub === 'retreat' ? `${Math.ceil(st.endsIn / 1000)}s` : '';
    q(root, '.ig-wind').textContent = windText(st.wind);
    const hog = st.activeHog !== null ? st.hogs[st.activeHog] : null;
    const ammo = st.ammo[store.playerId!];
    for (const [w, b] of wBtns) {
      const a = ammo?.[w] ?? 0;
      b.classList.toggle('sel', st.weapon === w);
      b.disabled = st.sub !== 'aim' || a === 0;
      q(b, 'small').textContent = a < 0 ? '∞' : `${a}x`;
    }
    const aiming = st.sub === 'aim' && !fired;
    pad.classList.toggle('off', !aiming);
    q(root, '.ig-done').classList.toggle('hidden', st.sub !== 'retreat');
    const head = q(root, '.ig-head');
    if (st.sub === 'aim') head.textContent = `Du bist dran! ${hog ? `(${hog.hp} HP)` : ''}`;
    else if (st.sub === 'flight') head.textContent = 'Flieeeeg ...';
    else if (st.sub === 'retreat') head.textContent = 'Schnell weg hier!';
    else head.textContent = 'Zug vorbei';
    if (!drag) {
      padText.textContent =
        st.sub === 'aim' ? `${WEAPONS[st.weapon].hint}\nZiehen = zielen, loslassen = los!` : st.sub === 'retreat' ? 'Rückzug: lauf oder spring in Deckung!' : 'Schau auf den Fernseher!';
    }
    const moveOk = st.sub === 'aim' || st.sub === 'retreat';
    for (const sel of ['.ig-left', '.ig-right', '.ig-jump']) q<HTMLButtonElement>(root, sel).disabled = !moveOk;
  };
}

// ------------------------------------------------------------------ Zuschauer

function buildWatch() {
  const root = el(`
    <div class="top-row"><span class="timer"></span><span class="ig-wind"></span></div>
    <div class="ig-turn">
      <h2 class="ig-who"></h2>
      <p class="ig-what"></p>
    </div>
    <p class="ig-next"></p>
    <canvas class="ig-map" width="480" height="270"></canvas>
    <div class="ig-teams"></div>
    <p class="ig-sd"></p>
  `);
  app.append(root);
  let teamsKey = '';
  const drawMap = miniMap(q<HTMLCanvasElement>(root, '.ig-map'));
  return () => {
    const st = igel();
    if (!st) return;
    drawMap(st);
    const me = store.playerId!;
    q(root, '.timer').textContent = st.sub === 'aim' || st.sub === 'retreat' ? `${Math.ceil(st.endsIn / 1000)}s` : '';
    q(root, '.ig-wind').textContent = windText(st.wind);
    const who = q(root, '.ig-who');
    who.textContent = st.active ? `${nameOf(st.active)} ist dran` : 'Gleich geht’s weiter ...';
    who.style.color = st.active ? teamColor(st, st.active) : '';
    q(root, '.ig-what').textContent =
      st.sub === 'aim' ? `zielt mit: ${WEAPONS[st.weapon].name}` : st.sub === 'flight' ? 'Achtung, Einschlag!' : st.sub === 'retreat' ? 'Rückzug ...' : '';
    const mineAlive = st.hogs.some((h) => h.owner === me && h.state === 'ok');
    const next = q(root, '.ig-next');
    next.textContent = !mineAlive ? 'Deine Igel sind raus – feuer die anderen an!' : st.next === me ? 'Gleich bist du dran!' : '';
    next.classList.toggle('ig-soon', st.next === me && mineAlive);
    q(root, '.ig-sd').textContent = st.suddenDeath ? 'SUDDEN DEATH – die Flut steigt!' : `Flut in ${Math.ceil(st.suddenIn / 1000)}s`;
    const key = JSON.stringify(st.hogs.map((h) => [h.hp, h.state]));
    if (key === teamsKey) return;
    teamsKey = key;
    q(root, '.ig-teams').innerHTML = st.teams
      .map((id) => {
        const hogs = st.hogs.filter((h) => h.owner === id);
        const bars = hogs
          .map((h) => `<span class="ig-bar ${h.state !== 'ok' ? 'gone' : ''}"><i style="width:${h.state === 'ok' ? Math.max(0, h.hp) : 0}%"></i></span>`)
          .join('');
        const hp = hogs.reduce((s, h) => s + (h.state === 'ok' ? h.hp : 0), 0);
        return `<div class="ig-team ${id === me ? 'me' : ''} ${hp <= 0 ? 'out' : ''}"><b style="background:${teamColor(st, id)}"></b><span class="ig-name">${escapeHtml(nameOf(id))}</span>${bars}<span class="ig-hp">${hp}</span></div>`;
      })
      .join('');
  };
}

// ------------------------------------------------------------------ Mini-Karte

/** Kleine Inselkarte fürs Handy: Terrain aus Seed + Kratern, Igel als farbige Punkte */
function miniMap(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d')!;
  let seed = -1;
  let n = 0;
  let mask: Mask | null = null;
  let img: ImageData | null = null;
  const paint = () => {
    img = g.createImageData(IGEL.W, IGEL.H);
    for (let i = 0; i < IGEL.W * IGEL.H; i++) {
      const solid = mask![i] === 1;
      const top = solid && (i < IGEL.W || mask![i - IGEL.W] === 0);
      const [r, gg, b] = top ? [95, 164, 55] : solid ? [201, 154, 94] : [169, 220, 246];
      img.data.set([r, gg, b, 255], i * 4);
    }
  };
  return (st: IgelState) => {
    if (st.seed !== seed || st.craters.length < n) {
      seed = st.seed;
      mask = buildTerrain(st.seed, st.craters);
      n = st.craters.length;
      paint();
    } else if (st.craters.length > n) {
      for (; n < st.craters.length; n++) carve(mask!, ...st.craters[n]);
      paint();
    }
    g.putImageData(img!, 0, 0);
    g.fillStyle = 'rgba(55,132,194,0.9)';
    g.fillRect(0, st.water, IGEL.W, IGEL.H - st.water);
    for (const h of st.hogs) {
      if (h.state === 'drowned') continue;
      g.fillStyle = h.state === 'dead' ? '#f1d49a' : teamColor(st, h.owner);
      g.strokeStyle = '#2d1b12';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(h.x, h.y - 5, h.owner === store.playerId ? 9 : 7, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (h.id === st.activeHog && h.state === 'ok') {
        g.strokeStyle = '#fdf7ea';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(h.x, h.y - 5, 15, 0, Math.PI * 2);
        g.stroke();
      }
    }
    for (const p of st.projs) {
      g.fillStyle = '#3d2414';
      g.fillRect(p.x - 4, p.y - 4, 8, 8);
    }
  };
}
