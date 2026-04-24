import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // react-hooks v6 introduced two stricter rules that flag patterns
      // the React team considers anti-patterns but are common (and
      // arguably idiomatic) in app code:
      //   - set-state-in-effect: legitimate "sync local state from prop
      //     change / event subscription" trips this; the suggested fix
      //     (useMemo / useSyncExternalStore) is sometimes a bigger
      //     refactor than warranted.
      //   - immutability: forbids reading variables declared later in
      //     the same scope, which conflicts with the natural "useEffect
      //     at top, helpers below" layout.
      // Downgraded to warnings so lint still surfaces them for review
      // without blocking CI on patterns that work.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability':        'warn',
    },
  },
])
