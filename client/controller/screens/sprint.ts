import type { SprintState } from '../../../shared/types';
import { type Screen, app, el, q, send, store, tapButton } from '../core';

export function pickSprint(s: SprintState): Screen {
  const id = store.playerId!;
  if (!(id in s.points)) return ['spectate', () => (app.append(el(`<div class="center"><h2>Du schaust zu</h2></div>`)), null)];
  if (s.sub === 'wait') return [`sp-wait-${s.round}`, () => buildWait(s)];
  if (s.sub === 'go') return [`sp-go-${s.goSeq}`, () => buildGo(s)];
  return [`sp-reveal-${s.round}-${s.sub}`, () => buildReveal(s)];
}

const sprint = () => (store.state?.mini?.kind === 'sprint' ? store.state.mini.state : null);

function buildWait(s: SprintState) {
  const root = el(`
    <p>Runde ${s.round}/${s.rounds}</p>
    <h2>Psst ... es ist 6 Uhr morgens.</h2>
    <p>Tippe erst, wenn die Sonne aufgeht!</p>
    <button class="big-btn night">... warten ...</button>
  `);
  const btn = q<HTMLButtonElement>(root, '.big-btn');
  tapButton(btn, () => {
    send('tap', { seq: -1, ms: 0 });
    navigator.vibrate?.(200);
  });
  app.append(root);
  return () => {
    const t = sprint()?.times[store.playerId!];
    if (t === 'early') {
      btn.textContent = 'FEHLSTART!';
      btn.classList.add('fail');
    }
  };
}

function buildGo(s: SprintState) {
  const t0 = performance.now();
  const root = el(`
    <p>Runde ${s.round}/${s.rounds}</p>
    <button class="big-btn sun">JETZT! TIPPEN!</button>
  `);
  const btn = q<HTMLButtonElement>(root, '.big-btn');
  let done = false;
  tapButton(btn, () => {
    if (done) return;
    done = true;
    const ms = Math.round(performance.now() - t0);
    send('tap', { seq: s.goSeq, ms });
    btn.textContent = `${ms} ms`;
    navigator.vibrate?.(30);
  });
  app.append(root);
  navigator.vibrate?.(60);
  return () => {
    const t = sprint()?.times[store.playerId!];
    if (t === 'early') {
      btn.textContent = 'FEHLSTART!';
      btn.classList.add('fail');
    }
  };
}

function buildReveal(s: SprintState) {
  const id = store.playerId!;
  const t = s.times[id];
  const ranked = Object.keys(s.times)
    .filter((k) => typeof s.times[k] === 'number')
    .sort((a, b) => (s.times[a] as number) - (s.times[b] as number));
  const rank = ranked.indexOf(id);
  app.append(
    el(`
      <div class="center">
        <h1>${t === 'early' ? 'FEHLSTART!' : t === null ? 'Verschlafen!' : `${t} ms`}</h1>
        <h2>${rank >= 0 ? `Platz ${rank + 1} von ${ranked.length}` : 'Keine Liege für dich ...'}</h2>
        <p>Deine Punkte: ${s.points[id] ?? 0}</p>
      </div>
    `),
  );
  return null;
}
