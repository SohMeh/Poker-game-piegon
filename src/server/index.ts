// Production / dev entry point.
import { APP_NAME } from '../shared';
import { createAppServer } from './app';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST || undefined;

// Optional public origin for link previews, e.g. PUBLIC_URL=https://poker.example.com
const server = createAppServer({ publicUrl: process.env.PUBLIC_URL || null });

try {
  const actual = await server.listen(Number.isFinite(port) ? port : 3001, host);
  console.log(`${APP_NAME} server listening on http://${host ?? 'localhost'}:${actual}`);
} catch (err) {
  console.error('Failed to start the server', err);
  process.exit(1);
}

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(0), 5000);
  force.unref();
  server
    .close()
    .catch((err) => console.error('Error while closing', err))
    .finally(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => console.error('[server] uncaught exception', err));
process.on('unhandledRejection', (err) => console.error('[server] unhandled rejection', err));
