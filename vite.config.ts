import { defineConfig } from 'vite';

export default defineConfig({
  // Project pages live at aryamans.me/prplease, so every emitted asset URL must
  // carry the subpath. Assets are referenced via import.meta.env.BASE_URL.
  base: '/prplease/',
  server: {
    // Vite has no built-in PORT support, so honour it explicitly — that is how the
    // harness hands this server its assigned port. Falls back to Vite's default.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
