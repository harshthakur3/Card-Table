import { config } from './config.js';
import { createApp } from './app.js';

const { server, games, store, close } = await createApp(config);

server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
  console.log(`[server] ${games.size} games loaded: ${[...games.keys()].join(', ')}`);
  console.log(`[server] room store: ${store.kind}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await close().catch(() => {});
    process.exit(0);
  });
}
