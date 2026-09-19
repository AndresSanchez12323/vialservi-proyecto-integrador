import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = { '/api': 'http://localhost:4000' };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: api },
  // El modo previa sirve la compilacion de produccion: necesita el mismo
  // puente hacia el API, porque server.proxy solo aplica en desarrollo.
  preview: { port: 4173, proxy: api },
  build: { target: 'es2020' },
});
