/**
 * Testspieler (Bots), damit man allein testen kann.
 * Tipp: Bots lassen sich auch direkt in der Lobby am Handy hinzufügen (VIP-Menü).
 *
 *   npm run bots              → 3 Bots treten bei
 *   npm run bots -- 5         → 5 Bots
 *   npm run bots -- 3 --party → Bot wird VIP und startet direkt eine Party (3 Runden)
 *   npm run bots -- 4 --game=murder → Bot startet direkt ein Einzelspiel (z. B. flunky, sprint, descent, wrap, nhie, hilo, bomb, enten …)
 *   npm run bots -- 2 --date        → zwei Bots spielen die komplette Date Night
 *   npm run bots -- 4 --drink       → Bots spielen ein paar Runden Trinkspiel
 */
import { Bot } from '../server/botclient';

const args = process.argv.slice(2);
const COUNT = Number(args.find((a) => /^\d+$/.test(a)) ?? 3);
const GAME = args.find((a) => a.startsWith('--game='))?.slice(7);
const DATE = args.includes('--date');
const DRINK = args.includes('--drink');
const LEAD = args.includes('--party') || !!GAME || DATE || DRINK;
const URL = process.env.URL ?? 'http://localhost:3000';
const NAMES = ['Bot Lena', 'Bot Tobi', 'Bot Jule', 'Bot Ben', 'Bot Mia', 'Bot Finn', 'Bot Ida', 'Bot Max'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < COUNT; i++) {
    new Bot(NAMES[i % NAMES.length], {
      url: URL,
      leader: LEAD && i === 0,
      game: DRINK ? 'drink' : GAME,
      date: DATE,
      count: COUNT,
      log: (m) => console.log(m),
      onDone: () => process.exit(0),
    });
    await sleep(LEAD && i === 0 ? 400 : 150);
  }
  console.log(`${COUNT} Bots verbunden mit ${URL}${LEAD ? ' – Bot startet das Spiel' : ''}`);
})();
