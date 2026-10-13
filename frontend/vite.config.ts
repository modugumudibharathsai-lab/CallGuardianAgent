import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const apiTarget = loadEnv(mode, '.', 'VITE_').VITE_API_URL?.trim()
    || 'http://127.0.0.1:8001';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 5500,
      strictPort: true,
      proxy: Object.fromEntries(
        ['/auth', '/captcha', '/chat', '/calls', '/appointments', '/analytics', '/export', '/health', '/config-status']
          .map((path) => [path, { target: apiTarget }]),
      ),
    },
    build: { sourcemap: false },
  };
});
