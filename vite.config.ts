import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { siteConfig } from './fundive.config'
import { assertValidSiteConfig } from './src/config/site.schema'

// Fail fast if the fork's fundive.config.ts is malformed or its configVersion is
// behind the core contract — same loud-at-build philosophy as the env check
// below. Runs at config load so `vite dev` catches it too.
assertValidSiteConfig(siteConfig)

// Replace static placeholders in index.html with values from fundive.config.ts,
// so the title / description / theme-color / favicon track the shop config
// rather than being hardcoded in the HTML.
function htmlConfigPlugin(): Plugin {
  const replacements: Record<string, string> = {
    '%APP_TITLE%': siteConfig.identity.shopName,
    '%APP_DESCRIPTION%': siteConfig.identity.description,
    '%THEME_COLOR%': siteConfig.theme.themeColor,
    '%FAVICON%': siteConfig.assets.favicon,
  }
  return {
    name: 'fundive-html-config',
    transformIndexHtml(html) {
      return Object.entries(replacements).reduce(
        (out, [token, value]) => out.replaceAll(token, value),
        html,
      )
    },
  }
}

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
    htmlConfigPlugin(),
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
        name: siteConfig.identity.shopName,
        short_name: siteConfig.identity.shortName,
        description: siteConfig.identity.description,
        theme_color: siteConfig.theme.themeColor,
        background_color: siteConfig.theme.backgroundColor,
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: siteConfig.assets.icon192, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: siteConfig.assets.icon512, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
    ],
  }
})
