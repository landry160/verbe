// npm run dev:bureau : lance Vite (la page se recharge à chaque modification) puis l'app bureau branchée dessus.
// Profil à part (--profil) : les vrais réglages de l'app installée ne sont jamais touchés.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('..', import.meta.url));
const serveur = await createServer({ configFile: path.join(racine, 'vite.config.mjs') });
await serveur.listen();
const url = serveur.resolvedUrls.local[0];
console.log(`Vite : ${url}verbe.html`);

const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env, VERBE_DEV_URL: url };
delete env.ELECTRON_RUN_AS_NODE; // sinon Electron démarre comme un simple Node
const profil = path.join(os.tmpdir(), 'verbe-profil-dev');
const app = spawn(electron, [racine, `--profil=${profil}`], { stdio: 'inherit', env });
app.on('exit', async code => { await serveur.close(); process.exit(code ?? 0); });
