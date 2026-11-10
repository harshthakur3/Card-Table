// Room persistence. Rooms always live in memory while active (timers need that);
// the store is a write-through copy so rooms survive a server restart when Redis is used.

const KEY = (code) => `cardgame:room:${code}`;
const TTL_SECONDS = 6 * 60 * 60;

export class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.map = new Map();
  }
  async get(code) {
    return this.map.get(code) ?? null;
  }
  async set(code, room) {
    this.map.set(code, room);
  }
  async delete(code) {
    this.map.delete(code);
  }
  async has(code) {
    return this.map.has(code);
  }
  async close() {}
}

export class RedisStore {
  constructor(client) {
    this.kind = 'redis';
    this.client = client;
  }
  async get(code) {
    const raw = await this.client.get(KEY(code));
    return raw ? JSON.parse(raw) : null;
  }
  async set(code, room) {
    await this.client.set(KEY(code), JSON.stringify(room), 'EX', TTL_SECONDS);
  }
  async delete(code) {
    await this.client.del(KEY(code));
  }
  async has(code) {
    return (await this.client.exists(KEY(code))) === 1;
  }
  async close() {
    await this.client.quit().catch(() => {});
  }
}

/** Use Redis when REDIS_URL is set and reachable; otherwise fall back to memory. */
export async function createStore(redisUrl) {
  if (!redisUrl) return new MemoryStore();
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
    });
    client.on('error', (e) => console.warn('[redis]', e.message));
    await client.connect();
    await client.ping();
    console.log(`[store] using Redis at ${redisUrl.replace(/\/\/.*@/, '//***@')}`);
    return new RedisStore(client);
  } catch (e) {
    console.warn(`[store] Redis unavailable (${e.message}); falling back to in-memory store`);
    return new MemoryStore();
  }
}
