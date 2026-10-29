import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import {defineConfig, type Plugin} from 'vite';

function pdfCMaps(): Plugin {
  const directory = path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'cmaps');
  const files = readdirSync(directory).filter(name => name.endsWith('.bcmap') || name === 'LICENSE');
  return {
    name: 'same-origin-pdf-cmaps',
    configureServer(server) {
      server.middlewares.use(`${server.config.base}pdf-cmaps/`, (request, response, next) => {
        const name = (request.url || '').slice(1).split('?')[0];
        if (!files.includes(name)) return next();
        response.setHeader('Content-Type', 'application/octet-stream');
        response.end(readFileSync(path.join(directory, name)));
      });
    },
    generateBundle() {
      for (const name of files) this.emitFile({ type: 'asset', fileName: `pdf-cmaps/${name}`, source: readFileSync(path.join(directory, name)) });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(), 
      tailwindcss(),
      pdfCMaps()
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
