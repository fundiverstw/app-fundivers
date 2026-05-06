import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // injectManifest so src/sw.ts owns the service worker — we need the
      // `push` + `notificationclick` handlers on top of workbox precaching
      // and Supabase runtime caching.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 'prompt' (not 'autoUpdate') so a freshly-installed SW sits in the
      // `waiting` state until the user clicks the in-app update banner. With
      // autoUpdate the page would hard-reload itself the moment a deploy
      // landed; with prompt we surface needRefresh and let the user reload
      // when it's safe (form not half-filled, etc.).
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'FunDivers TW',
        short_name: 'FunDivers',
        description: 'Dive registration and logbook for FunDivers Taiwan',
        theme_color: '#0ea5e9',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
})
