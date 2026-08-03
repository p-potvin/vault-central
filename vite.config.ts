import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // crypto-vault now lives at src/lib/crypto-vault.ts (vendored out of the
    // vaultwares-themes submodule), so the single src glob covers everything.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/**', 'dist/**', 'node_modules/**'],
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'manifest.json',
          dest: '.',
        },
        {
          // Only the sized icons the manifest actually references. The masters
          // (vault-central-logo.{png,svg}, vault-central-nobg.{png,svg}) and the
          // unused nobg derivatives stay in the repo but must not ship — they add
          // ~3.4 MB of dead weight to every AMO upload.
          // dest '.' because the glob keeps its own `icons/` path segment.
          src: 'icons/vault-central-[0-9]*.png',
          dest: '.',
        },
        {
          src: 'src/offscreen/processor.html',
          dest: 'src/offscreen',
          rename: { stripBase: true },
        },
        {
          src: 'src/offscreen/sandbox.html',
          dest: 'src/offscreen',
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/@ffmpeg/core/dist/esm/*',
          dest: 'ffmpeg-core',
          rename: { stripBase: true },
        },
      ],
    }),
],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, 'dashboard-v2.html'),
        pin: resolve(__dirname, 'pin-entry.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.json', '.mjs'],
  },
});
