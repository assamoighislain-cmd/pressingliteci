import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  `build-${Date.now()}`;

function buildVersionPlugin(buildId: string): Plugin {
  const payload = JSON.stringify({
    buildId,
    builtAt: new Date().toISOString(),
  });
  return {
    name: 'pressinglite-build-version',
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.end(payload);
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: payload,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const googleMapsApiKey =
    env.VITE_GOOGLE_MAPS_API_KEY ||
    env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';

  return {
    define: {
      __APP_BUILD_ID__: JSON.stringify(BUILD_ID),
      __GOOGLE_MAPS_API_KEY__: JSON.stringify(googleMapsApiKey),
    },
    plugins: [
      react(),
      tailwindcss(),
      buildVersionPlugin(BUILD_ID),
      VitePWA({
        registerType: 'prompt',
        includeAssets: [
          'favicon.ico',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: 'PressingLite — Gestion de Pressing',
          short_name: 'Pressing',
          description:
            'Application complète de gestion de pressing et blanchisserie utilisable hors-ligne avec synchronisation automatique en arrière-plan.',
          theme_color: '#0ea5e9',
          background_color: '#f8fafc',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          lang: 'fr',
          categories: ['business', 'productivity', 'finance'],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          shortcuts: [
            {
              name: 'Nouveau dépôt',
              short_name: 'Dépôt',
              description: 'Enregistrer un nouveau dépôt client',
              url: '/?action=new-depot',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Clients',
              short_name: 'Clients',
              description: 'Consulter la liste des clients',
              url: '/?action=clients',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Tableau de bord',
              short_name: 'Accueil',
              description: 'Ouvrir le tableau de bord',
              url: '/?action=dashboard',
              icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
          globIgnores: ['**/version.json'],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          clientsClaim: false,
          skipWaiting: false,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/version\.json$/, /^\/api\//],
          importScripts: ['/bg-sync-sw.js'],
          runtimeCaching: [
            {
              urlPattern: ({ sameOrigin, url }) =>
                sameOrigin && url.pathname === '/version.json',
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'supabase-public-media-cache',
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: ({ sameOrigin, request, url }) =>
                sameOrigin &&
                url.pathname !== '/version.json' &&
                !url.pathname.endsWith('/sw.js') &&
                !url.pathname.endsWith('/bg-sync-sw.js') &&
                ['script', 'style', 'worker', 'font', 'image'].includes(request.destination),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'app-same-origin-runtime-cache',
                networkTimeoutSeconds: 3,
                expiration: {
                  maxEntries: 250,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
          navigateFallback: 'index.html',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
