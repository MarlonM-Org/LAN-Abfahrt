import type { Socket } from 'socket.io-client';
import { BB, centerOfPressure, isBalanceKind } from '../../shared/balance';
import { getState } from './store';

/**
 * Wii Balance Board am Laptop – per WebHID direkt in der TV-Seite (Chrome/Edge, nur auf localhost bzw. HTTPS).
 *
 * Einrichten (einmalig, Windows): scripts/wii-pair.ps1 als Administrator starten und SYNC im Batteriefach drücken
 * (koppelt mit der Adapter-Adresse als PIN und schaltet den HID-Dienst ein – der Windows-Assistent kann das nicht,
 * dann fehlt das Board unter „Human Interface Devices“ und WebHID findet es nicht). Danach auf der TV-Seite B drücken (oder auf die Board-Anzeige klicken) und das
 * Board auswählen – ab dann verbindet sich die Seite beim Neuladen von selbst.
 *
 * Protokoll (siehe wiibrew.org „Wii Balance Board“): das Board meldet sich als Wiimote mit Erweiterung.
 *   0x11 LED an · 0x15 Status anfragen · 0x16 Register schreiben (Erweiterung freischalten) · 0x17 Kalibrierung lesen
 *   0x12 Berichtsmodus 0x32 (Knöpfe + 8 Bytes Erweiterung, fortlaufend)
 *   Eingang 0x20 Status (danach Modus neu setzen) · 0x21 gelesene Daten · 0x32 Messwerte: TR, BR, TL, BL (je 16 Bit)
 *
 * Ohne Board: Pfeiltasten lehnen (↑ vorn, ↓ hinten, ← →), J = Sprung (kurze Gewichtsspitze) – damit lässt sich
 * alles am Laptop testen. Die Werte gehen als `bb:sample` an den Server (der nimmt sie nur vom Laptop an).
 */

// Minimale WebHID-Typen (nicht in lib.dom)
interface HIDInputReportEvent extends Event {
  device: HIDDevice;
  reportId: number;
  data: DataView;
}
interface HIDDevice extends EventTarget {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
}
interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(opts: { filters: { vendorId?: number; productId?: number }[] }): Promise<HIDDevice[]>;
}

const NINTENDO = 0x057e;
const PIDS = [0x0306, 0x0330];
const FILTERS = PIDS.map((productId) => ({ vendorId: NINTENDO, productId }));
const LS_FLIP = 'lanabfahrt.bbFlip';

const hid = (): HID | null => (navigator as Navigator & { hid?: HID }).hid ?? null;

type Status = 'none' | 'connecting' | 'ok' | 'error';

class WiiBoard {
  /** Kalibrierung: [0 kg, 17 kg, 34 kg] × [TR, BR, TL, BL] */
  private cal: number[][] | null = null;
  private calBuf = new Uint8Array(24);
  private calGot = 0;
  private tare = [0, 0, 0, 0];
  private tareSamples: number[][] = [];
  private onReport = (e: Event) => this.report(e as HIDInputReportEvent);
  /** Letzter Messwert in kg pro Sensor (TR, BR, TL, BL) */
  kg: number[] | null = null;
  at = 0;
  battery = -1;
  button = false;

  constructor(readonly dev: HIDDevice) {}

  async open() {
    if (!this.dev.opened) await this.dev.open();
    this.dev.addEventListener('inputreport', this.onReport);
    await this.send(0x11, [0x10]); // Power-LED an
    await this.send(0x15, [0x00]); // Status → Antwort 0x20, danach Modus setzen
    await this.write(0xa400f0, [0x55]);
    await this.write(0xa400fb, [0x00]);
    await this.read(0xa40024, 24);
    await this.setMode();
  }

  close() {
    this.dev.removeEventListener('inputreport', this.onReport);
    void this.dev.close().catch(() => undefined);
  }

  /** Neu tarieren (Board muss leer sein) */
  retare() {
    this.tareSamples = [];
    this.tare = [0, 0, 0, 0];
  }

  private async send(id: number, bytes: number[]) {
    // Wiimote-Ausgabeberichte sind 21 Bytes lang (ohne Report-ID) – Windows will die volle Länge
    const buf = new Uint8Array(21);
    buf.set(bytes);
    try {
      await this.dev.sendReport(id, buf);
    } catch {
      // Manche Treiber wollen exakt die Nutzlast
      await this.dev.sendReport(id, new Uint8Array(bytes));
    }
  }

  private setMode() {
    return this.send(0x12, [0x04, 0x32]);
  }

  private write(addr: number, data: number[]) {
    const payload = [0x04, (addr >> 16) & 0xff, (addr >> 8) & 0xff, addr & 0xff, data.length, ...data];
    while (payload.length < 21) payload.push(0);
    return this.send(0x16, payload);
  }

  private read(addr: number, size: number) {
    return this.send(0x17, [0x04, (addr >> 16) & 0xff, (addr >> 8) & 0xff, addr & 0xff, (size >> 8) & 0xff, size & 0xff]);
  }

  private report(e: HIDInputReportEvent) {
    const d = e.data;
    if (d.byteLength >= 2) this.button = (d.getUint8(1) & 0x08) !== 0;
    switch (e.reportId) {
      case 0x20: {
        // Status: Erweiterung (ein)gesteckt → Berichtsmodus ist zurückgesetzt
        if (d.byteLength >= 6) this.battery = d.getUint8(5);
        void this.setMode();
        break;
      }
      case 0x21: {
        if (d.byteLength < 21) break;
        const se = d.getUint8(2);
        if (se & 0x0f) break; // Lesefehler
        const size = (se >> 4) + 1;
        const off = d.getUint16(3) - 0x0024;
        for (let i = 0; i < size && off + i < 24; i++) if (off + i >= 0) this.calBuf[off + i] = d.getUint8(5 + i);
        this.calGot += size;
        if (this.calGot >= 24) {
          const v = (i: number) => (this.calBuf[i * 2] << 8) | this.calBuf[i * 2 + 1];
          this.cal = [0, 1, 2].map((k) => [0, 1, 2, 3].map((s) => v(k * 4 + s)));
        }
        break;
      }
      case 0x32:
      case 0x34: {
        if (!this.cal || d.byteLength < 10) break;
        const raw = [0, 1, 2, 3].map((s) => d.getUint16(2 + s * 2));
        const kg = raw.map((r, s) => {
          const [c0, c17, c34] = [this.cal![0][s], this.cal![1][s], this.cal![2][s]];
          if (r < c17) return (17 * (r - c0)) / Math.max(1, c17 - c0);
          return 17 + (17 * (r - c17)) / Math.max(1, c34 - c17);
        });
        // Nullpunkt: die ersten Werte mit leerem Board – danach driftet er bei leerem Board langsam nach
        const total = kg.reduce((a, b) => a + b, 0) - this.tare.reduce((a, b) => a + b, 0);
        if (this.tareSamples.length < 30) {
          if (total < 8) this.tareSamples.push(kg);
          if (this.tareSamples.length === 30) this.tare = [0, 1, 2, 3].map((s) => this.tareSamples.reduce((a, k) => a + k[s], 0) / 30);
        } else if (total < 3) {
          this.tare = this.tare.map((t, s) => t + (kg[s] - t) * 0.01);
        }
        this.kg = kg.map((k, s) => k - this.tare[s]);
        this.at = performance.now();
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- Verbindung + Senden

let board: WiiBoard | null = null;
let status: Status = 'none';
let statusMsg = '';
let flipY = (() => {
  try {
    return localStorage.getItem(LS_FLIP) === '1';
  } catch {
    return false;
  }
})();

async function attach(dev: HIDDevice) {
  if (board?.dev === dev) return;
  board?.close();
  status = 'connecting';
  statusMsg = '';
  render();
  const b = new WiiBoard(dev);
  try {
    await b.open();
    board = b;
    status = 'ok';
  } catch (err) {
    status = 'error';
    statusMsg = String((err as Error)?.message ?? err).slice(0, 80);
  }
  render();
}

async function requestBoard() {
  const h = hid();
  if (!h) {
    status = 'error';
    statusMsg = 'Dieser Browser kann kein WebHID – bitte Chrome oder Edge am Laptop nehmen.';
    return render();
  }
  try {
    const [dev] = await h.requestDevice({ filters: FILTERS });
    if (dev) await attach(dev);
  } catch (err) {
    status = 'error';
    statusMsg = String((err as Error)?.message ?? err).slice(0, 80);
    render();
  }
}

/** Live-Wert des Boards (oder null) – für die TV-Anzeige */
function boardSample() {
  if (!board?.kg || performance.now() - board.at > 400) return null;
  const [tr, br, tl, bl] = board.kg;
  return centerOfPressure(tl, tr, bl, br, flipY);
}

// Tastatur-Ersatz
const keys = new Set<string>();
const sim = { x: 0, y: 0, jumpAt: -1e9 };
const SIM_KG = 72;

function simSample() {
  const tx = (keys.has('ArrowRight') ? 0.8 : 0) - (keys.has('ArrowLeft') ? 0.8 : 0);
  const ty = (keys.has('ArrowUp') ? 0.8 : 0) - (keys.has('ArrowDown') ? 0.8 : 0);
  sim.x += (tx - sim.x) * 0.25;
  sim.y += (ty - sim.y) * 0.25;
  const since = performance.now() - sim.jumpAt;
  const w = since < 180 ? SIM_KG * 1.35 : since < 300 ? SIM_KG * 0.75 : SIM_KG + (Math.random() - 0.5) * 0.6;
  return { w, x: sim.x, y: sim.y };
}

const balanceActive = () => {
  const s = getState();
  return !!s && ((s.phase === 'mini' && isBalanceKind(s.mini?.kind)) || (s.phase === 'intro' && isBalanceKind(s.intro?.kind)));
};

// ---------------------------------------------------------------- Anzeige (oben links, nur bei Board-Spielen)

const CSS = `
#bb-pill { position: fixed; left: 1.5vh; top: 11vh; z-index: 11; max-width: 60vh; padding: 1vh 1.3vh; font: 1.2vh/1.6 'Press Start 2P', monospace; color: #fff4d6; background: rgba(20, 28, 48, 0.82); border: 0.3vh solid rgba(160, 200, 255, 0.55); cursor: pointer; display: none; }
#bb-pill.show { display: block; }
#bb-pill.ok { border-color: rgba(120, 220, 140, 0.8); }
#bb-pill .bb-sub { opacity: 0.75; font-size: 1vh; }
#bb-pill button { font: inherit; font-size: 1vh; margin-top: 0.6vh; margin-right: 0.6vh; color: #3d2414; background: #f7e4b5; border: 0.25vh solid #8d5629; padding: 0.4vh 0.7vh; cursor: pointer; }
`;
let pill: HTMLDivElement | null = null;

function render() {
  if (!pill) return;
  const show = balanceActive() || status === 'connecting' || pillForced > performance.now();
  pill.classList.toggle('show', show);
  pill.classList.toggle('ok', status === 'ok' && !!boardSample());
  if (!show) return;
  const s = boardSample();
  let html: string;
  if (status === 'ok' && board) {
    const bat = board.battery >= 0 ? ` · 🔋 ${Math.round((board.battery / 0xc8) * 100)} %` : '';
    html = s ? `⚖️ Balance Board: ${Math.round(s.w)} kg${bat}` : `⚖️ Balance Board verbunden – warte auf Messwerte …${bat}`;
    html += `<div class="bb-sub">Leer lassen zum Tarieren · vorn/hinten vertauscht? → umdrehen</div><button data-a="tare">Tarieren</button><button data-a="flip">Vorn ↔ hinten${flipY ? ' (getauscht)' : ''}</button>`;
  } else if (status === 'connecting') {
    html = '⚖️ Verbinde Balance Board …';
  } else {
    html = `⚖️ Kein Balance Board – <b>B</b> drücken oder hier klicken`;
    html += `<div class="bb-sub">${statusMsg ? `${statusMsg}<br>` : ''}Ersatz: Pfeiltasten lehnen · J = Sprung</div>`;
  }
  if (pill.dataset.html !== html) {
    pill.dataset.html = html;
    pill.innerHTML = html;
  }
}
let pillForced = 0;

export function installBalanceBoard(socket: Socket) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  pill = document.createElement('div');
  pill.id = 'bb-pill';
  document.body.append(pill);
  pill.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'tare') return board?.retare();
    if (a === 'flip') {
      flipY = !flipY;
      try {
        localStorage.setItem(LS_FLIP, flipY ? '1' : '0');
      } catch {
        /* egal */
      }
      return render();
    }
    if (status !== 'ok') void requestBoard();
  });

  const h = hid();
  if (h) {
    // Schon einmal erlaubt → ohne Nachfrage verbinden
    void h.getDevices().then((list) => {
      const dev = list.find((d) => d.vendorId === NINTENDO && PIDS.includes(d.productId));
      if (dev) void attach(dev);
    });
    h.addEventListener('connect', (e) => {
      const dev = (e as Event & { device: HIDDevice }).device;
      if (dev.vendorId === NINTENDO && PIDS.includes(dev.productId)) void attach(dev);
    });
    h.addEventListener('disconnect', (e) => {
      const dev = (e as Event & { device: HIDDevice }).device;
      if (board?.dev === dev) {
        board = null;
        status = 'none';
        statusMsg = 'Board getrennt (Akku? Knopf vorn drücken)';
        render();
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'b' || e.key === 'B') {
      pillForced = performance.now() + 8000;
      if (status !== 'ok') void requestBoard();
      return render();
    }
    if (!balanceActive()) return;
    if (e.key.startsWith('Arrow')) {
      keys.add(e.key);
      e.preventDefault();
    }
    if ((e.key === 'j' || e.key === 'J') && !e.repeat) sim.jumpAt = performance.now();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));
  window.addEventListener('blur', () => keys.clear());

  setInterval(() => {
    render();
    if (!balanceActive() || getState()?.phase !== 'mini') return;
    const real = boardSample();
    const s = real ?? (board && status === 'ok' ? null : simSample());
    if (s) socket.emit('bb:sample', { w: Math.round(s.w * 10) / 10, x: Math.round(s.x * 1000) / 1000, y: Math.round(s.y * 1000) / 1000 });
  }, BB.SEND_MS);
}
