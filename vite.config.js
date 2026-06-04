import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
export default defineConfig({
    test: {
        environment: 'jsdom',
        setupFiles: ['./vitest.setup.ts'],
        globals: true,
        include: [
            'src/**/*.{test,spec}.{ts,tsx}',
            // Crypto module lives in the vaultwares-themes submodule but its unit
            // tests must still run as part of vault-central's vitest suite,
            // since vaultwares-themes ships source-only (no own test runner).
            'vaultwares-themes/security/**/*.{test,spec}.{ts,tsx}',
        ],
        exclude: ['tests/**', 'dist/**', 'node_modules/**'],
    },
    plugins: [
        react(),
        viteStaticCopy({
            targets: [
                {
                    src: 'scraper-player.html',
                    dest: '.',
                },
                {
                    src: 'manifest.json',
                    dest: '.',
                },
                {
                    src: 'icons',
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
                {
                    src: 'node_modules/@ffmpeg/ffmpeg/dist/umd/814.ffmpeg.js',
                    dest: 'ffmpeg-core',
                    rename: () => '../../../../../ffmpeg-worker.js',
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
    },
});
