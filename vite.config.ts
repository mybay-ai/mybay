import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'node:fs';
import express from 'express';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), {
      name: 'local-pdf-assets',
      configureServer(server) {
        for (const directory of ['cmaps', 'standard_fonts', 'wasm']) server.middlewares.use(`/pdfjs/${directory}`, express.static(path.resolve('node_modules/pdfjs-dist', directory)));
      },
      generateBundle() {
        for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
          const root = path.resolve('node_modules/pdfjs-dist', directory);
          for (const name of fs.readdirSync(root)) {
            if (fs.statSync(path.join(root, name)).isFile()) this.emitFile({ type: 'asset', fileName: `pdfjs/${directory}/${name}`, source: fs.readFileSync(path.join(root, name)) });
          }
        }
      },
    }],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    test: {
      fileParallelism: false,
      exclude: ['.codex-worktrees/**', 'tmp/**', 'backups/**', 'release/**', 'dist/**', 'data/**', 'node_modules/**'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('pdfjs-dist')) return 'vendor-pdf';
              if (id.includes('react-dom') || id.includes('react-router') || id.includes('react-router-dom')) {
                return 'vendor-react';
              }
              if (id.includes('motion') || id.includes('framer-motion')) {
                return 'vendor-motion';
              }
              if (id.includes('lucide-react') || id.includes('react-icons')) {
                return 'vendor-icons';
              }
              if (id.includes('react-markdown') || id.includes('remark') || id.includes('markdown-to-jsx')) {
                return 'vendor-markdown';
              }
              return 'vendor-others';
            }
          }
        }
      },
      chunkSizeWarningLimit: 1200,
      minify: 'esbuild',
      cssMinify: true
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
