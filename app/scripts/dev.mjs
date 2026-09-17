/** Dev launcher: tsx watch for the API server + vite dev server. */
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const procs = [
  spawn('npx', ['tsx', 'watch', 'server/index.ts'], {cwd: root, stdio: 'inherit', env: {...process.env, DEV: '1'}}),
  spawn('npx', ['vite'], {cwd: root, stdio: 'inherit'})
];
const shutdown = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
