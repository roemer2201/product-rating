import { buildApp } from './app.js';

// Placeholder wiring until milestone M1 introduces the TOML configuration
// loader. Once it exists, host, port and log level come from the config object
// and nothing here reads process.env directly.
const host = process.env.PR_SERVER__HOST ?? '127.0.0.1';
const port = Number(process.env.PR_SERVER__PORT ?? 8080);

const app = buildApp({ logger: { level: process.env.PR_LOG__LEVEL ?? 'info' } });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error, 'failed to start server');
  process.exit(1);
}
