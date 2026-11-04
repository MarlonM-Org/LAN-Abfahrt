/**
 * Domain-Werkzeug für HTTPS im Heimnetz (Einstellungen aus .env).
 *
 *   npm run domain            IP bei deSEC eintragen + Zertifikat holen, falls nötig
 *   npm run domain -- --force Zertifikat neu holen, auch wenn das alte noch gilt
 *   npm run domain -- --check nur anzeigen, wohin die Domain gerade zeigt
 */
import dns from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { domainConfigFromEnv, ensureCertificate, updateAddress } from '../server/domain';
import { getLanAddress } from '../server/net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  /* keine .env */
}

const cfg = domainConfigFromEnv(root);
if (!cfg) {
  console.error('DESEC_TOKEN und DESEC_ZONE fehlen in .env – siehe .env.example');
  process.exit(1);
}
const ip = process.env.PUBLIC_HOST ?? getLanAddress();
const args = process.argv.slice(2);

if (args.includes('--check')) {
  for (const name of [cfg.domain, cfg.zone]) {
    const a = await dns.resolve4(name).catch((e: Error) => [`– (${e.message})`]);
    console.log(`${name} → ${a.join(', ')}`);
  }
  console.log(`Laptop-IP: ${ip}`);
  process.exit(0);
}

await updateAddress(cfg, ip);
console.log(`🌐 ${cfg.zone} → ${ip}`);
const result = await ensureCertificate(cfg, args.includes('--force'));
if (result === 'ok') console.log('🔐 Zertifikat ist noch gültig.');
