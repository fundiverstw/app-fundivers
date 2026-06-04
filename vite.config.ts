import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ command, mode }) => {
  // Client env vars whose absence silently breaks a core flow at runtime
  // rather than at build. Each baked into the bundle at build time, so a
  // missing value ships a broken app that only fails in the browser. Fail
  // the production build loudly instead. Vars that degrade gracefully
  // (VITE_VAPID_PUBLIC_KEY / VITE_PUSH_WORKER_URL — push just stays off) are
  // intentionally not gated here.
  const REQUIRED_BUILD_ENV: Record<string, string> = {
    VITE_SUPABASE_URL:       'Supabase client cannot initialise — the whole app fails to boot.',
    VITE_SUPABASE_ANON_KEY:  'Supabase client cannot initialise — the whole app fails to boot.',
    VITE_TURNSTILE_SITE_KEY: 'Guest registration captcha cannot render, yet the edge function still requires a token — guest signup dead-ends.',
  }

  if (command === 'build') {
    // loadEnv merges matching process.env keys, so this also catches a
    // missing CI secret in the GitHub Actions build (no .env.local present).
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const missing = Object.keys(REQUIRED_BUILD_ENV)
      .filter(key => !env[key] && !process.env[key])
    if (missing.length > 0) {
      const lines = missing.map(key => `  - ${key}: ${REQUIRED_BUILD_ENV[key]}`)
      throw new Error(
        `Missing required build env var(s):\n${lines.join('\n')}\n` +
        'Set the GitHub Actions secret(s) (or .env value) before building.',
      )
    }
  }

  return {
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
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
    ],
  }
})
