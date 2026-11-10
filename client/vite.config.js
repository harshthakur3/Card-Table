import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev only: where the Vite dev server forwards /api and /socket.io (the local game server).
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: {
      '/api': apiTarget,
      '/socket.io': { target: apiTarget, ws: true },
    },
  },
});
