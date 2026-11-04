import type { FliegerControl, FliegerPrivate, FliegerState } from '../../../shared/types';
import { type Screen, app, el, escapeHtml, message, q, send, store, tapButton } from '../core';

const flieger = () => (store.state?.mini?.kind === 'flieger' ? store.state.mini.state : null);
const priv = (): FliegerPrivate | null => (store.priv?.kind === 'flieger' ? store.priv.state : null);

export function pickFlieger(s: FliegerState): Screen {
  const p = priv();
  const next = s.route[s.stage + 1] ?? '';
  switch (s.sub) {
    case 'cleared':
      return [`fl-cleared-${s.stage}`, message('ETAPPE GESCHAFFT!', `Zwischenlandung: ${next}. Gleich gibt’s ein neues Cockpit!`)];
    case 'crash':
      return ['fl-crash', message('ABSTURZ!', 'Der Treibstoff ist alle ... Schau auf den Fernseher!')];
    case 'arrived':
      return ['fl-arrived', message('GELANDET!', `Willkommen auf ${s.route[s.route.length - 1]}! Schau auf den Fernseher!`)];
    default:
      if (!p || !p.panel.length) return ['fl-wait', message('Einsteigen ...')];
      // Panel-ID im Key: neues Cockpit → neu bauen (auch wenn "private" nach "state" ankommt)
      return [`fl-panel-${p.panel[0].id}`, () => buildCockpit(p.panel)];
  }
}

function buildCockpit(panel: FliegerControl[]) {
  const root = el(`
    <div class="fl-order">
      <p class="fl-order-text"></p>
      <div class="fl-bar"><div class="fl-fill"></div></div>
    </div>
    <div class="fl-flash hidden"></div>
    <div class="fl-panel"></div>
    <div class="top-row fl-status"><span class="fl-stage"></span><span class="fl-fuel"></span></div>
  `);
  const grid = q(root, '.fl-panel');
  const updaters: (() => void)[] = [];

  for (const c of panel) {
    const card = el(`<div class="fl-ctl fl-t-${c.type}"><div class="fl-name">${escapeHtml(c.name)}</div></div>`).firstElementChild as HTMLElement;
    const current = () => priv()?.panel.find((x) => x.id === c.id) ?? c;
    if (c.type === 'button' || c.type === 'tap') {
      const b = el(`<button class="fl-push ${c.type}">${c.type === 'tap' ? 'TIPP!' : ''}</button>`).firstElementChild as HTMLButtonElement;
      tapButton(b, () => {
        send('act', { c: c.id });
        navigator.vibrate?.(c.type === 'tap' ? 8 : 15);
        b.classList.remove('pulse');
        void b.offsetWidth;
        b.classList.add('pulse');
      });
      card.append(b);
    } else if (c.type === 'toggle') {
      const b = el(`<button class="fl-toggle"><span class="fl-knob"></span><span class="fl-tlabel"></span></button>`).firstElementChild as HTMLButtonElement;
      tapButton(b, () => {
        send('act', { c: c.id });
        navigator.vibrate?.(12);
      });
      card.append(b);
      updaters.push(() => {
        const on = current().value === 1;
        b.classList.toggle('on', on);
        q(b, '.fl-tlabel').textContent = on ? 'AN' : 'AUS';
      });
    } else {
      const row = el(`<div class="fl-seg"></div>`).firstElementChild as HTMLElement;
      const btns = c.labels.map((label, i) => {
        const b = document.createElement('button');
        b.textContent = label;
        tapButton(b, () => {
          send('act', { c: c.id, v: i });
          navigator.vibrate?.(10);
        });
        row.append(b);
        return b;
      });
      card.append(row);
      updaters.push(() => btns.forEach((b, i) => b.classList.toggle('active', current().value === i)));
    }
    grid.append(card);
  }
  // Ungerade Zahl halber Karten → letzte über die volle Breite, damit kein Loch bleibt
  const halves = [...grid.children].filter((c) => !c.classList.contains('fl-t-switch'));
  if (halves.length % 2) halves[halves.length - 1].classList.add('wide');
  app.append(root);

  const orderText = q(root, '.fl-order-text');
  const fill = q(root, '.fl-fill');
  const flash = q(root, '.fl-flash');
  let lastPriv: unknown = null;
  let endsAt = 0;
  let total = 1;
  let orderSeq = -1;
  let feedbackSeq = priv()?.feedback?.seq ?? -1;
  let flashTimer: number | undefined;

  return () => {
    const s = flieger();
    const p = priv();
    if (!s || !p) return;
    if (store.priv !== lastPriv) {
      lastPriv = store.priv;
      for (const u of updaters) u();
      if (p.order) {
        endsAt = performance.now() + p.order.endsIn;
        total = p.order.totalMs;
      }
      if (p.feedback && p.feedback.seq !== feedbackSeq) {
        feedbackSeq = p.feedback.seq;
        flash.textContent = p.feedback.text;
        flash.className = `fl-flash ${p.feedback.ok ? 'ok' : 'bad'}`;
        navigator.vibrate?.(p.feedback.ok ? 30 : [80, 40, 80]);
        clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => flash.classList.add('hidden'), 1400);
      }
    }
    const box = q(root, '.fl-order');
    if (s.sub === 'intro') {
      orderText.textContent = s.stage === 0 ? 'Anschnallen! Lies dir dein Cockpit durch – gleich kommen die Anweisungen.' : 'Neues Cockpit! Schnell alles durchlesen ...';
      fill.style.width = '100%';
      box.classList.remove('urgent');
      box.classList.add('idle');
    } else if (p.order) {
      if (p.order.seq !== orderSeq) {
        orderSeq = p.order.seq;
        box.classList.remove('fresh');
        void box.offsetWidth;
        box.classList.add('fresh');
      }
      orderText.textContent = p.order.text + (p.order.taps ? ` (${p.order.taps})` : '');
      const frac = Math.max(0, Math.min(1, (endsAt - performance.now()) / total));
      fill.style.width = `${frac * 100}%`;
      box.classList.toggle('urgent', frac < 0.3);
      box.classList.remove('idle');
    } else {
      orderText.textContent = 'Warte auf die nächste Anweisung ...';
      fill.style.width = '0%';
      box.classList.remove('urgent');
      box.classList.add('idle');
    }
    q(root, '.fl-stage').textContent = `Etappe ${s.stage + 1}/${s.route.length - 1} · ${s.progress}/${s.target}`;
    const fuel = q(root, '.fl-fuel');
    fuel.textContent = `Sprit ${Math.round(s.fuel)}%`;
    fuel.classList.toggle('low', s.fuel <= 30);
  };
}
