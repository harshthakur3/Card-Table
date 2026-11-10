import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { loadGames } from './registry.js';
import { createStore } from './store.js';
import { RoomManager } from './rooms/RoomManager.js';
import { setupSockets } from './sockets.js';

/** Builds the HTTP server, Socket.io and RoomManager. Used by index.js and the integration tests. */
export async function createApp(config) {
  const games = await loadGames(config.gamesDir);
  const store = await createStore(config.redisUrl);
  const rooms = new RoomManager({ games, store, config });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  // The website may live on another domain (see CORS_ORIGIN); let it read the public API.
  const origins = config.corsOrigin ?? '*';
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origins === '*') res.setHeader('Access-Control-Allow-Origin', '*');
    else if (origin && origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.sendStatus(204);
    }
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, store: store.kind, games: games.size }));
  app.get('/api/games', (_req, res) => res.json(rooms.listGames()));
  app.get('/api/games/:id', (req, res) => {
    const info = rooms.gameInfo(req.params.id);
    if (!info) return res.status(404).json({ error: 'Unknown game' });
    res.json(info);
  });
  app.get('/api/games/:id/rules', (req, res) => {
    const info = rooms.gameInfo(req.params.id);
    if (!info) return res.status(404).type('text').send('Unknown game');
    res.type('text/markdown').send(info.rules);
  });
  app.get('/api/rooms/:code', async (req, res) => {
    const summary = await rooms.roomSummary(req.params.code);
    if (!summary) return res.status(404).json({ exists: false, error: 'Room not found' });
    res.json({ exists: true, ...summary });
  });

  // Production: serve the built client and fall back to index.html for client routes.
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: origins }, maxHttpBufferSize: 64 * 1024 });
  setupSockets(io, rooms);

  const sweeper = setInterval(() => rooms.sweep(), 60_000);
  sweeper.unref();

  async function close() {
    clearInterval(sweeper);
    rooms.shutdown();
    io.close();
    await new Promise((r) => server.close(() => r()));
    await store.close();
  }

  return { app, server, io, rooms, store, games, close };
}
