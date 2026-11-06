/**
 * Rutsch-Knöpfe: eine Gruppe Knöpfe in einer Zone, in der jeder Finger den Knopf drückt, über dem er GERADE liegt.
 * Zieht man den Daumen von ◀ auf ▶, wechselt die Richtung sofort mit (und zurück) – der Finger hängt nicht an dem
 * Knopf, auf dem er aufgesetzt hat. Dafür fängt die Zone selbst die Pointer (Pointer-Capture) und prüft bei jedem
 * `pointermove`, welcher Knopf am nächsten ist (gleiches Prinzip wie GAS/BREMSE/DRIFT im Kart).
 *
 * - mehrere Finger: jeder zählt für sich; mit `exclusive` gewinnt der Finger, der zuletzt aufgesetzt hat oder auf
 *   einen anderen Knopf gerutscht ist (Steuerkreuz: links halten + rechts tippen = rechts, rechts loslassen = wieder links)
 * - `slack`: Lücken/Überstand bis so viele px zählen zum nächsten Knopf (`Infinity` = immer der nächste Knopf)
 * - losgelassen wird bei pointerup/-cancel, Verlust der Capture, `input-reset` (Handy gedreht, Overlay), Fenster-Blur
 *   und wenn die Seite in den Hintergrund geht
 * - Pseudo-Quer (orientation.ts) braucht nichts Extra: Knopf-Rechtecke und clientX/Y sind beide Bildschirm-Koordinaten
 */
export interface SlideOpts<K extends string> {
  /** Finger bis so viele px neben einem Knopf zählen noch zu ihm (Standard 18; Infinity = immer der nächste) */
  slack?: number;
  /** Nur der jüngste Finger zählt (Standard: alle Knöpfe unter Fingern sind gedrückt) */
  exclusive?: boolean;
  /** CSS-Klasse gedrückter Knöpfe (Standard 'held') */
  heldClass?: string;
  /** Ein Finger setzt auf `k` auf oder rutscht darauf (für Tipp-Knöpfe wie SPRUNG) */
  onEnter?: (k: K) => void;
}

export interface SlideButtons<K extends string> {
  /** Gedrückte Knöpfe, jüngster zuerst (mit `exclusive` höchstens einer) */
  held(): K[];
  /** Alle Finger loslassen */
  reset(): void;
}

export function slideButtons<K extends string>(
  zone: HTMLElement,
  btns: Record<K, HTMLElement>,
  onChange: (held: K[]) => void,
  opts: SlideOpts<K> = {},
): SlideButtons<K> {
  const slack = opts.slack ?? 18;
  const cls = opts.heldClass ?? 'held';
  const keys = Object.keys(btns) as K[];
  let rects: { k: K; r: DOMRect }[] = [];
  // Bei jedem Aufsetzen neu messen – das Layout kann sich seit dem letzten Mal geändert haben (Drehung, Overlay)
  const measure = () => (rects = keys.map((k) => ({ k, r: btns[k].getBoundingClientRect() })));
  const hit = (x: number, y: number): K | null => {
    let best: K | null = null;
    let bd = slack;
    for (const { k, r } of rects) {
      if (!r.width && !r.height) continue;
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d <= bd && (best === null || d < bd)) {
        bd = d;
        best = k;
      }
    }
    return best;
  };

  /** Finger → Knopf darunter und „Alter“ (steigt beim Aufsetzen und bei jedem Knopfwechsel) */
  const fingers = new Map<number, { k: K | null; at: number }>();
  let seq = 0;
  let shown = '';
  const held = (): K[] => {
    const order = [...fingers.values()].filter((f) => f.k !== null).sort((a, b) => b.at - a.at);
    const list: K[] = [];
    for (const f of order) if (!list.includes(f.k!)) list.push(f.k!);
    return opts.exclusive ? list.slice(0, 1) : list;
  };
  const apply = () => {
    const list = held();
    const key = list.join(',');
    if (key === shown) return;
    shown = key;
    for (const k of keys) btns[k].classList.toggle(cls, list.includes(k));
    onChange(list);
  };
  const enter = (id: number, k: K | null) => {
    const f = fingers.get(id);
    if (f && f.k === k) return;
    fingers.set(id, { k, at: ++seq });
    if (k !== null) opts.onEnter?.(k);
    apply();
  };

  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      /* egal – Ereignisse kommen dann über die Knöpfe hoch */
    }
    measure();
    fingers.delete(e.pointerId);
    enter(e.pointerId, hit(e.clientX, e.clientY));
  });
  zone.addEventListener('pointermove', (e) => {
    if (!fingers.has(e.pointerId)) return;
    enter(e.pointerId, hit(e.clientX, e.clientY));
  });
  const up = (e: PointerEvent) => {
    if (fingers.delete(e.pointerId)) apply();
  };
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  zone.addEventListener('lostpointercapture', up);
  zone.addEventListener('contextmenu', (e) => e.preventDefault());

  const reset = () => {
    fingers.clear();
    apply();
  };
  // Handy gedreht / Overlay / App gewechselt: nichts bleibt hängen (Listener räumen sich ab, wenn die Zone weg ist)
  const onReset = () => {
    if (!zone.isConnected) {
      window.removeEventListener('input-reset', onReset);
      window.removeEventListener('blur', onReset);
      document.removeEventListener('visibilitychange', onReset);
      return;
    }
    reset();
  };
  window.addEventListener('input-reset', onReset);
  window.addEventListener('blur', onReset);
  document.addEventListener('visibilitychange', onReset);
  return { held, reset };
}
