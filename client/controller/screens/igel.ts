import type { IgelState, IgelWeapon } from '../../../shared/types';
import { GRENADE, IGEL, IGEL_TAUNTS, IGEL_THEMES, WEAPONS, WEAPON_ORDER, type Mask, applyOp, buildTerrain, isTool, squadOf, surfaceY, windArrows } from '../../../shared/igel';
import { type Screen, app, colorOfId, el, escapeHtml, message, nameOf, q, send, store, tapButton } from '../core';
import { haptic } from '../haptic';
import { onInputReset, localPoint } from '../stick';

const igel = () => (store.state?.mini?.kind === 'igel' ? store.state.mini.state : null);
/** Spielerfarbe des Abends – wie `colorOf` in der IgelScene */
const teamColor = (st: IgelState, id: string) => colorOfId(id, Math.max(0, st.teams.indexOf(id))).hex;
const squadColor = (st: IgelState, id: string) => {
  const i = squadOf(st, id);
  return i >= 0 ? st.squads![i].color : null;
};
const myHog = (st: IgelState, id: string) => st.hogs.find((h) => h.owner === id && h.state === 'ok') ?? null;
/** Themenkarte als kurze Zeile („🌙 Mondnacht“) */
const themeLine = (st: IgelState) => {
  const th = IGEL_THEMES[st.theme];
  return th ? `${th.icon} ${th.name}` : '';
};
/** Flut-/Themenzeile unter der Karte */
const sdText = (st: IgelState) => `${themeLine(st)} · ${st.suddenDeath ? 'SUDDEN DEATH – die Flut steigt!' : `Flut in ${Math.ceil(st.suddenIn / 1000)}s`}`;

/** Zuschauer-Sprüche: Abklingzeit lokal mitzählen (überlebt das Neubauen des Screens) */
let tauntUntil = 0;

export function pickIgel(s: IgelState): Screen {
  ensureStyle();
  const id = store.playerId!;
  if (!s.teams.includes(id)) return ['spectate', message('Du schaust zu', 'Nächstes Spiel bist du dabei!')];
  if (s.sub === 'countdown') {
    const n = s.hogs.filter((h) => h.owner === id).length;
    const sq = squadOf(s, id);
    const team = sq >= 0 ? ` Du spielst für Team ${s.squads![sq].name} – mit ${s.squads![sq].members.filter((m) => m !== id).map(nameOf).join(', ') || 'dir allein'}.` : '';
    const mode = s.simul
      ? 'ALLE GLEICHZEITIG: 15 s zielen, FEUER drücken – dann fliegt alles zugleich!'
      : 'Wenn du dran bist: laufen, Waffe wählen, im Zielfeld ziehen (Richtung = Winkel, Länge = Kraft), dann FEUER.';
    const th = IGEL_THEMES[s.theme];
    const card = th ? `Themenkarte ${th.icon} ${th.name}: ${th.text} ` : '';
    return ['ig-count', message('Igel-Krieg!', `${card}Du hast ${n === 1 ? 'einen Igel' : `${n} Igel`} auf der Insel.${team} ${mode} Neu: Liane, Sonnenschirm und Schaufel – Werkzeuge beenden den Zug nicht. Wasser = raus!`)];
  }
  if (s.sub === 'replay') return ['ig-over-replay', message('Schuss des Abends!', 'Die Wiederholung läuft am Fernseher.')];
  if (s.sub === 'over') {
    const alive = s.hogs.some((h) => h.owner === id && h.state === 'ok');
    return ['ig-over', message(alive ? 'Überlebt!' : 'Vorbei!', 'Schau auf den Fernseher!')];
  }
  if (s.simul) return myHog(s, id) ? [`ig-sim-${s.turn}`, () => buildActive(s.turn)] : ['ig-watch', buildWatch];
  if (s.active === id) return [`ig-me-${s.turn}`, () => buildActive(s.turn)];
  return ['ig-watch', buildWatch];
}

function windText(w: number) {
  return Math.abs(w) < 0.17 ? 'Wind: still' : `Wind ${windArrows(w)}`;
}

// ------------------------------------------------------------------ Aktiver Spieler

function buildActive(turn: number) {
  // Quer wie bei Worms: links Waffenraster + laufen/springen, Mitte Minikarte, rechts Ziel-Pad + FEUER
  const me = store.playerId!;
  const root = el(`
    <div class="lx ig-lx ig-m">
      <div class="lx-head"><span class="timer"></span><b class="ig-head grow"></b><span class="ig-wind"></span><button class="ig-done hidden">Fertig ✓</button></div>
      <div class="lx-left ig-left-col">
        <div class="ig-weapons ig-grid"></div>
        <p class="ig-winfo"></p>
        <div class="ig-move">
          <button class="ig-left">◀</button>
          <button class="ig-jump">SPRUNG</button>
          <button class="ig-right">▶</button>
        </div>
      </div>
      <div class="lx-mid">
        <canvas class="ig-map" width="480" height="270"></canvas>
        <p class="ig-sd"></p>
      </div>
      <div class="lx-right ig-aim">
        <div class="ig-pad">
          <canvas></canvas>
          <div class="ig-fuse hidden"></div>
          <div class="ig-wait hidden"><b>Bereit ✓</b><div class="ig-taunts"></div><small class="ig-tcd"></small></div>
          <p class="pad-text"></p>
        </div>
        <button class="big-btn ig-fire" disabled>FEUER</button>
      </div>
    </div>
  `);
  app.append(root);
  const mapCanvas = q<HTMLCanvasElement>(root, '.ig-map');
  const drawMap = miniMap(mapCanvas);

  // Waffenraster 5 × 3 mit Symbol + Munition
  const wrap = q(root, '.ig-weapons');
  const wBtns = new Map<IgelWeapon, HTMLButtonElement>();
  for (const w of WEAPON_ORDER) {
    const b = el(`<button class="ig-weapon ig-w-${w}"><span class="ig-ico">${WEAPONS[w].icon}</span><small></small></button>`).firstElementChild as HTMLButtonElement;
    tapButton(b, () => {
      if (b.disabled) return;
      send('weapon', { weapon: w });
      haptic(8);
    });
    wrap.append(b);
    wBtns.set(w, b);
  }

  // Wasserbomben-Zünder 1–5 s
  const fuseBox = q(root, '.ig-fuse');
  const fuseBtns: HTMLButtonElement[] = [];
  for (let s = GRENADE.FUSE_MIN; s <= GRENADE.FUSE_MAX; s++) {
    const b = el(`<button>${s}s</button>`).firstElementChild as HTMLButtonElement;
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      send('fuse', { s });
      haptic(6);
    });
    fuseBox.append(b);
    fuseBtns.push(b);
  }
  const taunts = tauntRow(q(root, '.ig-taunts'), q(root, '.ig-tcd'));

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
    onInputReset(btn, up);
  };
  hold(q(root, '.ig-left'), -1);
  hold(q(root, '.ig-right'), 1);
  tapButton(q(root, '.ig-jump'), () => {
    send('jump');
    haptic(10);
  });
  tapButton(q(root, '.ig-done'), () => send('done'));

  // Zielfeld: ziehen = Richtung + Kraft (Vorschau am TV), loslassen = Vorschau bleibt stehen, FEUER = los
  const pad = q(root, '.ig-pad');
  const canvas = q<HTMLCanvasElement>(root, '.ig-pad canvas');
  const padText = q(root, '.pad-text');
  const fireBtn = q<HTMLButtonElement>(root, '.ig-fire');
  const g = canvas.getContext('2d')!;
  let drag: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  /** Losgelassener Zielvektor, wartet auf FEUER (Pfeil bleibt sichtbar) */
  let ready: { angle: number; power: number; x0: number; y0: number } | null = null;
  /** Luftschlag: angetipptes Ziel auf der Karte */
  let target: number | null = null;
  let lastSent = 0;
  let fired = false;
  let firedAt = 0;
  let lastShots = 0;
  let wind = 0;
  let weapon: IgelWeapon = 'bazooka';
  const maxLen = () => Math.min(pad.clientWidth, pad.clientHeight) * 0.48;
  const vec = () => {
    if (!drag) return null;
    const dx = drag.x - drag.x0;
    const dy = drag.y - drag.y0;
    const len = Math.hypot(dx, dy);
    return { angle: Math.atan2(dy, dx), power: Math.min(1, len / maxLen()), len };
  };
  const arrow = (x0: number, y0: number, angle: number, L: number, color: string, width: number) => {
    const ex = x0 + Math.cos(angle) * L;
    const ey = y0 + Math.sin(angle) * L;
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(ex, ey);
    g.stroke();
    const head = width + 6;
    g.beginPath();
    g.moveTo(ex + Math.cos(angle) * head, ey + Math.sin(angle) * head);
    g.lineTo(ex + Math.cos(angle + 2.3) * head, ey + Math.sin(angle + 2.3) * head);
    g.lineTo(ex + Math.cos(angle - 2.3) * head, ey + Math.sin(angle - 2.3) * head);
    g.closePath();
    g.fill();
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
    // Wind als Pfeil oben im Pad (Länge = Stärke)
    if (Math.abs(wind) >= 0.17) {
      const L = Math.min(1, Math.abs(wind)) * (w * 0.3);
      g.globalAlpha = 0.7;
      arrow(w / 2 - (Math.sign(wind) * L) / 2, 18, wind > 0 ? 0 : Math.PI, L, '#2d64a8', 4);
      g.globalAlpha = 1;
    }
    const v = vec();
    const shot = drag && v ? { x0: drag.x0, y0: drag.y0, angle: v.angle, power: v.power, L: Math.min(v.len, maxLen()) } : ready ? { ...ready, L: ready.power * maxLen() } : null;
    if (!shot) return;
    const dirOnly = WEAPONS[weapon].aim === 'dir';
    // Reichweitenkreis
    if (!dirOnly) {
      g.strokeStyle = 'rgba(94,53,24,0.35)';
      g.setLineDash([4, 6]);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(shot.x0, shot.y0, maxLen(), 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    // Pfeil (Farbe nach Kraft: grün → rot; reine Richtungswaffen blau)
    arrow(shot.x0, shot.y0, shot.angle, dirOnly ? Math.max(30, shot.L) : shot.L, dirOnly ? '#2d64a8' : `hsl(${120 - shot.power * 120}, 70%, 40%)`, 8);
    g.fillStyle = '#3d2414';
    g.beginPath();
    g.arc(shot.x0, shot.y0, 7, 0, Math.PI * 2);
    g.fill();
  };
  const canAim = () => {
    const st = igel();
    if (!st || fired) return false;
    return st.simul ? st.sub === 'aimAll' && !st.locked.includes(me) && !!myHog(st, me) : st.sub === 'aim' && st.active === me;
  };
  const aimKind = () => WEAPONS[weapon].aim;
  const sendAim = (angle: number, power: number) => send('aim', { angle: Math.round(angle * 100) / 100, power: Math.round(power * 100) / 100 });
  /** Am Seil: Pad oben = hochklettern, unten = runterlassen (gedrückt halten) */
  let climbing: number | null = null;
  const stopClimb = () => {
    if (climbing === null) return;
    climbing = null;
    send('climb', { dir: 0 });
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (roped()) {
      pad.setPointerCapture(e.pointerId);
      climbing = e.pointerId;
      const p = localPoint(pad, e);
      send('climb', { dir: p.y < pad.clientHeight / 2 ? 1 : -1 });
      haptic(6);
      return;
    }
    if (!canAim() || drag || aimKind() === 'map' || aimKind() === 'none') return;
    pad.setPointerCapture(e.pointerId);
    const p = localPoint(pad, e);
    drag = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y };
    ready = null;
    draw();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = localPoint(pad, e);
    drag.x = p.x;
    drag.y = p.y;
    draw();
    const v = vec()!;
    padText.textContent = aimKind() === 'dir' ? 'Richtung …' : `Kraft ${Math.round(v.power * 100)}%`;
    const now = performance.now();
    if (now - lastSent > 90 && v.len > 12) {
      lastSent = now;
      sendAim(v.angle, v.power);
    }
  });
  const release = (e: PointerEvent | null, cancel = false) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const v = vec()!;
    const d = drag;
    drag = null;
    if (cancel || v.len < 18 || !canAim()) {
      ready = null;
      draw();
      send('aim', { angle: null });
      return;
    }
    // Loslassen schießt nicht: die Vorschau bleibt (TV + Pad), erst FEUER löst aus –
    // so verreißt man den Schuss nicht beim Abheben des Daumens
    ready = { angle: v.angle, power: aimKind() === 'dir' ? 1 : v.power, x0: d.x0, y0: d.y0 };
    sendAim(ready.angle, ready.power);
    draw();
    haptic(8);
  };
  pad.addEventListener('pointerup', (e) => (e.pointerId === climbing ? stopClimb() : release(e)));
  pad.addEventListener('pointercancel', (e) => (e.pointerId === climbing ? stopClimb() : release(e, true)));
  onInputReset(pad, () => (stopClimb(), release(null, true)));

  // Möwen-Luftschlag: Ziel auf der Minikarte antippen (die Karte zeigt immer die ganze Insel, Canvas-Breite = Inselbreite)
  mapCanvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!canAim() || aimKind() !== 'map') return;
    // Karte ist per object-fit: contain eingepasst (clientWidth/Height: Layoutmaße, auch bei Pseudo-Quer)
    const w = mapCanvas.clientWidth;
    const h = mapCanvas.clientHeight;
    const cw = mapCanvas.width;
    const k = Math.min(w / cw, h / mapCanvas.height);
    const ox = (w - cw * k) / 2;
    const tx = Math.round(Math.max(6, Math.min(cw - 6, (localPoint(mapCanvas, e).x - ox) / k)));
    target = tx;
    send('aim', { tx });
    haptic(10);
  });

  tapButton(fireBtn, () => {
    // Am Seil wird FEUER zu LOSLASSEN
    if (roped()) {
      stopClimb();
      send('jump');
      haptic(20);
      return;
    }
    if (!canAim()) return;
    const kind = aimKind();
    if (kind === 'map') {
      if (target === null) return;
      send('fire', { tx: target });
    } else if (kind === 'none') {
      send('fire', {});
    } else {
      if (!ready) return;
      send('fire', { angle: ready.angle, power: ready.power });
    }
    haptic(isTool(weapon) ? 20 : 40);
    // Werkzeuge beenden den Zug nicht: gleich weiter zielen (Liane neu wischen)
    if (isTool(weapon)) {
      ready = null;
      draw();
      return;
    }
    fired = true;
    firedAt = performance.now();
    if (weapon !== 'shotgun') ready = null;
    draw();
  });

  /** Hängt der gesteuerte Igel gerade an der Liane? */
  const roped = () => {
    const st = igel();
    if (!st) return false;
    const h = st.simul ? myHog(st, me) : st.active === me && st.activeHog !== null ? st.hogs[st.activeHog] : null;
    return !!h?.rope;
  };

  let windKey = NaN;
  let weaponKey = '';
  return () => {
    const st = igel();
    if (!st || st.turn !== turn) return;
    drawMap(st, aimKind() === 'map' && canAim() ? target : null);
    const myW = st.weapons[me] ?? 'bazooka';
    if (myW !== weapon) {
      weapon = myW;
      target = null;
      if (aimKind() === 'map' || aimKind() === 'none') ready = null;
      draw();
    }
    const locked = st.simul && st.locked.includes(me);
    // Schuss wurde abgelehnt (z. B. Teleport-Ziel ungültig) → wieder zielen lassen
    const aimPhase = st.simul ? st.sub === 'aimAll' : st.sub === 'aim';
    if (fired && aimPhase && !locked && performance.now() - firedAt > 1200) fired = false;
    // Schrotflinte: nach dem ersten Schuss gleich nochmal
    if (fired && st.sub === 'aim' && st.shotsLeft > 0 && st.shotsLeft !== lastShots) fired = false;
    lastShots = st.shotsLeft;
    const timed = st.sub === 'aim' || st.sub === 'retreat' || st.sub === 'aimAll' || st.sub === 'retreatAll';
    q(root, '.timer').textContent = timed ? `${Math.ceil(st.endsIn / 1000)}s` : '';
    q(root, '.ig-wind').textContent = windText(st.wind);
    if (st.wind !== windKey) {
      windKey = st.wind;
      wind = st.wind;
      draw();
    }
    const hog = st.simul ? myHog(st, me) : st.activeHog !== null ? st.hogs[st.activeHog] : null;
    const ammo = st.ammo[me];
    const aiming = canAim();
    for (const [w, b] of wBtns) {
      const a = ammo?.[w] ?? 0;
      b.classList.toggle('sel', weapon === w);
      b.disabled = !aiming || a === 0 || (st.shotsLeft > 0 && w !== 'shotgun');
      q(b, 'small').textContent = a < 0 ? '∞' : `${a}`;
    }
    const wk = `${weapon}|${ammo?.[weapon]}`;
    if (wk !== weaponKey) {
      weaponKey = wk;
      q(root, '.ig-winfo').innerHTML = `<b>${escapeHtml(WEAPONS[weapon].name)}</b> · ${escapeHtml(WEAPONS[weapon].info)}`;
    }
    // Zünder nur bei der Wasserbombe
    fuseBox.classList.toggle('hidden', weapon !== 'grenade' || !aiming);
    const fz = st.fuse[me] ?? 3;
    fuseBtns.forEach((b, i) => b.classList.toggle('sel', i + GRENADE.FUSE_MIN === fz));
    if (!aiming && ready && !(fired && weapon === 'shotgun' && st.sub === 'aim')) {
      ready = null;
      draw();
    }
    const kind = aimKind();
    const onRope = !!hog?.rope && (hog.owner === me || !st.simul);
    if (!onRope) stopClimb();
    const armed = onRope || (aiming && (kind === 'none' || (kind === 'map' ? target !== null : !!ready)));
    pad.classList.toggle('off', !aiming && !locked && !onRope);
    pad.classList.toggle('ig-climb', onRope);
    fireBtn.disabled = !armed;
    fireBtn.classList.toggle('armed', armed);
    fireBtn.textContent = onRope ? 'LOSLASSEN' : weapon === 'rope' ? 'LIANE!' : weapon === 'parasol' ? 'SCHIRM AUF' : weapon === 'shovel' ? 'GRABEN' : kind === 'none' ? 'ABLEGEN' : kind === 'map' ? 'MÖWEN LOS' : 'FEUER';
    // Simultan: nach FEUER warten – mit Sprüchen für die Wartezeit
    const wait = q(root, '.ig-wait');
    wait.classList.toggle('hidden', !locked || st.sub !== 'aimAll');
    if (locked && st.sub === 'aimAll') taunts();
    const retreat = st.sub === 'retreat' || st.sub === 'retreatAll';
    q(root, '.ig-done').classList.toggle('hidden', !retreat);
    const head = q(root, '.ig-head');
    const hp = hog ? ` (${hog.hp} HP)` : '';
    const sq = squadOf(st, me);
    const teamTag = sq >= 0 ? `${st.squads![sq].name}: ` : '';
    if (st.sub === 'aim') head.textContent = hog && hog.owner !== me ? `${teamTag}Du steuerst ${nameOf(hog.owner)}${hp}` : `${teamTag}Du bist dran!${hp}`;
    else if (st.sub === 'aimAll') head.textContent = locked ? `${teamTag}Bereit ✓ ${st.locked.length}/${st.hogs.filter((h) => h.state === 'ok').length}` : `${teamTag}ALLE ZIELEN!${hp}`;
    else if (st.sub === 'flight' || st.sub === 'flightAll') head.textContent = 'Flieeeeg ...';
    else if (retreat) head.textContent = 'Schnell weg hier!';
    else head.textContent = 'Abwarten ...';
    q(root, '.ig-sd').textContent = sdText(st);
    if (!drag) {
      const shotgun2 = st.sub === 'aim' && st.shotsLeft > 0;
      padText.textContent = onRope
        ? '▲ oben halten = hochklettern\n▼ unten halten = runter\n◀ ▶ = schwingen · LOSLASSEN'
        : locked
        ? ''
        : aiming
          ? shotgun2
            ? 'Zweiter Schuss! Ziehen = zielen, FEUER'
            : kind === 'map'
              ? target === null
                ? 'Tippe auf der Karte das Ziel an!'
                : `Ziel gesetzt – MÖWEN LOS!\nKarte antippen = neues Ziel`
              : weapon === 'parasol'
                ? `${WEAPONS[weapon].hint}\nSCHIRM AUF – dann mit ◀ ▶ steuern`
              : kind === 'none'
                ? `${WEAPONS[weapon].hint}\nABLEGEN drücken, dann weglaufen`
                : ready
                  ? `${kind === 'dir' ? 'Richtung steht' : `Kraft ${Math.round(ready.power * 100)}%`} – FEUER drücken!\nNeu ziehen = neu zielen`
                  : `${WEAPONS[weapon].hint}\nZiehen = zielen, dann FEUER`
          : retreat
            ? 'Rückzug: lauf oder spring in Deckung!'
            : 'Schau auf den Fernseher!';
    }
    const moveOk = st.simul ? (st.sub === 'aimAll' && !locked) || st.sub === 'retreatAll' : st.sub === 'aim' || st.sub === 'retreat';
    for (const sel of ['.ig-left', '.ig-right', '.ig-jump']) q<HTMLButtonElement>(root, sel).disabled = !moveOk;
  };
}

// ------------------------------------------------------------------ Zuschauer / Warten

/** Spruch-Knöpfe mit lokal angezeigter Abklingzeit; liefert eine Update-Funktion */
function tauntRow(box: HTMLElement, cd: HTMLElement) {
  const btns: HTMLButtonElement[] = [];
  IGEL_TAUNTS.forEach((t, i) => {
    const b = el(`<button class="ig-taunt">${escapeHtml(t)}</button>`).firstElementChild as HTMLButtonElement;
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (performance.now() < tauntUntil) return;
      send('taunt', { i });
      tauntUntil = performance.now() + IGEL.TAUNT_COOLDOWN_MS;
      haptic(12);
    });
    box.append(b);
    btns.push(b);
  });
  return () => {
    const left = Math.max(0, tauntUntil - performance.now());
    for (const b of btns) b.disabled = left > 0;
    cd.textContent = left > 0 ? `Nächster Spruch in ${Math.ceil(left / 1000)} s` : 'Ruf was rüber!';
  };
}

function buildWatch() {
  const root = el(`
    <div class="ig-watchw">
      <canvas class="ig-map" width="480" height="270"></canvas>
      <div class="ig-side">
        <div class="top-row"><span class="timer"></span><span class="ig-wind"></span></div>
        <div class="ig-turn">
          <h2 class="ig-who"></h2>
          <p class="ig-what"></p>
        </div>
        <p class="ig-next"></p>
        <div class="ig-tbox"><div class="ig-taunts"></div><small class="ig-tcd"></small></div>
        <div class="ig-teams"></div>
        <p class="ig-sd"></p>
      </div>
    </div>
  `);
  app.append(root);
  let teamsKey = '';
  const drawMap = miniMap(q<HTMLCanvasElement>(root, '.ig-map'));
  const taunts = tauntRow(q(root, '.ig-taunts'), q(root, '.ig-tcd'));
  return () => {
    const st = igel();
    if (!st) return;
    drawMap(st, null);
    taunts();
    const me = store.playerId!;
    const timed = st.sub === 'aim' || st.sub === 'retreat' || st.sub === 'aimAll' || st.sub === 'retreatAll';
    q(root, '.timer').textContent = timed ? `${Math.ceil(st.endsIn / 1000)}s` : '';
    q(root, '.ig-wind').textContent = windText(st.wind);
    const who = q(root, '.ig-who');
    const what = q(root, '.ig-what');
    if (st.simul) {
      const alive = st.hogs.filter((h) => h.state === 'ok').length;
      who.textContent = st.sub === 'aimAll' ? 'Alle zielen!' : st.sub === 'flightAll' ? 'Achtung, Einschläge!' : st.sub === 'retreatAll' ? 'Rückzug ...' : 'Gleich geht’s weiter ...';
      who.style.color = '';
      what.textContent = st.sub === 'aimAll' ? `Bereit: ${st.locked.length}/${alive}` : '';
    } else {
      const ctrlHog = st.activeHog !== null ? st.hogs[st.activeHog] : null;
      who.textContent = st.active ? `${nameOf(st.active)} ist dran` : 'Gleich geht’s weiter ...';
      who.style.color = st.active ? teamColor(st, st.active) : '';
      what.textContent =
        st.sub === 'aim'
          ? `${ctrlHog && st.active && ctrlHog.owner !== st.active ? `mit ${nameOf(ctrlHog.owner)}s Igel · ` : ''}zielt mit: ${WEAPONS[st.weapon].name}`
          : st.sub === 'flight'
            ? 'Achtung, Einschlag!'
            : st.sub === 'retreat'
              ? 'Rückzug ...'
              : '';
    }
    const mineAlive = st.hogs.some((h) => h.owner === me && h.state === 'ok');
    const sq = squadOf(st, me);
    const teamAlive = sq >= 0 && st.hogs.some((h) => h.state === 'ok' && st.squads![sq].members.includes(h.owner));
    const next = q(root, '.ig-next');
    next.textContent = !mineAlive
      ? teamAlive
        ? `Dein Igel ist raus – Team ${st.squads![sq].name} kämpft weiter${st.simul ? '' : ', du steuerst bald einen Mitspieler'}!`
        : 'Deine Igel sind raus – feuer die anderen an!'
      : st.next === me
        ? 'Gleich bist du dran!'
        : '';
    next.classList.toggle('ig-soon', st.next === me && (mineAlive || teamAlive));
    q(root, '.ig-sd').textContent = sdText(st);
    const key = JSON.stringify(st.hogs.map((h) => [h.hp, h.state]));
    if (key === teamsKey) return;
    teamsKey = key;
    const row = (id: string) => {
      const hogs = st.hogs.filter((h) => h.owner === id);
      const bars = hogs
        .map((h) => `<span class="ig-bar ${h.state !== 'ok' ? 'gone' : ''}"><i style="width:${h.state === 'ok' ? Math.max(0, (h.hp / st.maxHp) * 100) : 0}%"></i></span>`)
        .join('');
      const hp = hogs.reduce((s, h) => s + (h.state === 'ok' ? h.hp : 0), 0);
      return `<div class="ig-team ${id === me ? 'me' : ''} ${hp <= 0 ? 'out' : ''}"><b style="background:${teamColor(st, id)}"></b><span class="ig-name">${escapeHtml(nameOf(id))}</span>${bars}<span class="ig-hp">${hp}</span></div>`;
    };
    q(root, '.ig-teams').innerHTML = st.squads
      ? st.squads
          .map((s) => {
            const hp = st.hogs.filter((h) => h.state === 'ok' && s.members.includes(h.owner)).reduce((a, h) => a + h.hp, 0);
            const max = s.members.length * st.maxHp;
            return `<div class="ig-squad ${hp <= 0 ? 'out' : ''}" style="border-color:${s.color}"><div class="ig-sqhead"><b style="background:${s.color}"></b><span class="ig-name">Team ${escapeHtml(s.name)}</span><span class="ig-bar ig-sqbar"><i style="width:${(hp / max) * 100}%;background:${s.color}"></i></span><span class="ig-hp">${hp}</span></div>${s.members.map(row).join('')}</div>`;
          })
          .join('')
      : st.teams.map(row).join('');
  };
}

// ------------------------------------------------------------------ Mini-Karte

/** Breite Inseln: Karte höchstens so breit (Seitenverhältnis) – dafür etwas überhöht, sonst wird sie am Handy ein dünner Strich */
const MAP_ASPECT = 2.4;

/**
 * Kleine Inselkarte fürs Handy: immer die ganze Insel (Canvas-Breite = Inselbreite), Terrain aus Seed + Operationen,
 * Igel als farbige Punkte (Teamfarbe als Ring). Breite Inseln werden höchstens 2,4 : 1 – senkrecht gestreckt um `sy`.
 */
function miniMap(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d')!;
  const off = document.createElement('canvas');
  const og = off.getContext('2d')!;
  let seed = -1;
  let n = 0;
  let w = 0;
  /** Überhöhung (1 = unverzerrt) und Strichstärken-Faktor (Punkte wirken auf jeder Breite gleich groß) */
  let sy = 1;
  let u = 1;
  let mask: Mask | null = null;
  const paint = () => {
    const img = og.createImageData(w, IGEL.H);
    for (let i = 0; i < w * IGEL.H; i++) {
      const solid = mask![i] === 1;
      const top = solid && (i < w || mask![i - w] === 0);
      const [r, gg, b] = top ? [95, 164, 55] : solid ? [201, 154, 94] : [169, 220, 246];
      img.data.set([r, gg, b, 255], i * 4);
    }
    og.putImageData(img, 0, 0);
  };
  return (st: IgelState, target: number | null) => {
    const sw = st.w ?? IGEL.W;
    if (st.seed !== seed || sw !== w || st.ops.length < n) {
      seed = st.seed;
      w = sw;
      mask = buildTerrain(st.seed, st.ops, w);
      n = st.ops.length;
      sy = Math.max(1, w / IGEL.H / MAP_ASPECT);
      u = (w / IGEL.W) ** 0.8;
      off.width = w;
      off.height = IGEL.H;
      canvas.width = w;
      canvas.height = Math.round(IGEL.H * sy);
      canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
      canvas.classList.toggle('ig-wide', w > IGEL.W);
      paint();
    } else if (st.ops.length > n) {
      for (; n < st.ops.length; n++) applyOp(mask!, st.ops[n]);
      paint();
    }
    const Y = (y: number) => y * sy;
    const H = canvas.height;
    g.imageSmoothingEnabled = false;
    g.drawImage(off, 0, 0, w, H);
    g.fillStyle = 'rgba(55,132,194,0.9)';
    g.fillRect(0, Y(st.water), w, H - Y(st.water));
    for (const o of st.objs) {
      g.fillStyle = o.type === 'mine' ? '#5b2a6e' : o.type === 'barrel' ? '#d8473c' : '#a5602a';
      g.strokeStyle = '#2d1b12';
      g.lineWidth = 2 * u;
      if (o.type === 'crate') {
        g.fillRect(o.x - 6 * u, Y(o.y) - 12 * u, 12 * u, 12 * u);
        g.strokeRect(o.x - 6 * u, Y(o.y) - 12 * u, 12 * u, 12 * u);
      } else {
        g.beginPath();
        g.arc(o.x, Y(o.y) - 4 * u, 5 * u, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    for (const h of st.hogs) {
      if (h.state === 'drowned') continue;
      const ring = squadColor(st, h.owner);
      const cy = Y(h.y) - 5 * u;
      g.fillStyle = h.state === 'dead' ? '#f1d49a' : teamColor(st, h.owner);
      g.strokeStyle = ring ?? '#2d1b12';
      g.lineWidth = (ring ? 4 : 3) * u;
      g.beginPath();
      g.arc(h.x, cy, (h.owner === store.playerId ? 9 : 7) * u, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      const mine = st.simul ? h.owner === store.playerId && h.state === 'ok' : h.id === st.activeHog && h.state === 'ok';
      if (mine) {
        g.strokeStyle = '#fdf7ea';
        g.lineWidth = 3 * u;
        g.beginPath();
        g.arc(h.x, cy, 15 * u, 0, Math.PI * 2);
        g.stroke();
      }
    }
    for (const p of st.projs) {
      g.fillStyle = '#3d2414';
      g.fillRect(p.x - 4 * u, Y(p.y) - 4 * u, 8 * u, 8 * u);
    }
    if (target !== null) {
      // Luftschlag-Ziel: Fadenkreuz über die ganze Höhe
      g.strokeStyle = '#e0503f';
      g.lineWidth = 4 * u;
      g.setLineDash([10 * u, 8 * u]);
      g.beginPath();
      g.moveTo(target, 0);
      g.lineTo(target, H);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(target, Y(surfaceY(mask!, target)) - 6 * u, 14 * u, 0, Math.PI * 2);
      g.stroke();
    }
  };
}

// ------------------------------------------------------------------ Styles (Waffenraster, Zünder, Sprüche, Teams)

function ensureStyle() {
  if (document.getElementById('ig-m-style')) return;
  const s = document.createElement('style');
  s.id = 'ig-m-style';
  s.textContent = `
.lx.ig-lx.ig-m { --lx-l: 34%; --lx-r: 38%; }
.ig-m .ig-left-col { grid-template-rows: minmax(0, 1fr) auto minmax(0, 0.55fr); gap: 4px; }
.ig-m .ig-weapons.ig-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 3px; }
.ig-pad.ig-climb { background: linear-gradient(#d8f0c0 0 50%, #f0dcb0 50% 100%); }
.ig-m .ig-weapon { position: relative; padding: 0; justify-content: center; flex-direction: column; gap: 0; }
.ig-m .ig-weapon .ig-ico { font-size: 16px; line-height: 1; filter: drop-shadow(1px 1px 0 rgba(45, 27, 18, 0.5)); }
.ig-m .ig-weapon small { position: absolute; right: 2px; bottom: 1px; font-size: 7px; }
.ig-m .ig-weapon:disabled { opacity: 0.4; }
.ig-m .ig-weapon.sel:disabled { opacity: 0.75; }
.ig-m .ig-winfo { margin: 0; min-height: 2.6em; font-size: 7px; line-height: 1.4; color: var(--ink-soft); overflow: hidden; }
.ig-m .ig-winfo b { color: var(--ink); font-weight: normal; }
.ig-fuse { position: absolute; left: 4px; right: 4px; top: 30px; display: flex; gap: 4px; justify-content: center; }
.ig-fuse button { padding: 4px 6px; font-size: 8px; min-height: 0; background: var(--paper-dark); color: var(--ink); text-shadow: none; }
.ig-fuse button.sel { background: var(--gold); border-color: var(--red); }
.ig-wait { position: absolute; inset: 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: rgba(255, 246, 220, 0.9); color: var(--green-dark, #2f7d32); font-size: 10px; }
.ig-taunts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; width: 100%; }
.ig-taunt { padding: 6px 4px; min-height: 0; font-size: 7px; line-height: 1.3; background: #f07aa8; box-shadow: inset 0 3px 0 #f6a3c3, inset 0 -3px 0 #b0306a, 0 2px 0 var(--outline); }
.ig-taunt:disabled { filter: grayscale(0.8); opacity: 0.6; }
.ig-tcd { font-size: 7px; color: var(--ink-soft); }
.ig-tbox { display: flex; flex-direction: column; gap: 4px; }
.ig-squad { display: flex; flex-direction: column; gap: 3px; padding: 3px; border: 3px solid; background: rgba(255, 255, 255, 0.25); }
.ig-squad.out { opacity: 0.5; }
.ig-sqhead { display: flex; align-items: center; gap: 6px; font-size: 9px; color: var(--ink); }
.ig-sqhead b { width: 12px; height: 12px; border: 2px solid var(--outline); flex: none; }
.ig-sqbar { width: 60px; }
.ig-squad .ig-team { font-size: 8px; padding: 1px 6px; }
/* Breite Insel (ab 6 Spielern): Karte zuschauen quer in voller Breite statt voller Höhe */
:where(html.land) .ig-watchw .ig-map.ig-wide { width: 62%; height: auto; max-width: 62%; }
`;
  document.head.append(s);
}
