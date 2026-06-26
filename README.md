# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Compared to competitors

**FunDive** is a free, open-source, self-hostable platform for running a dive
center — bookings, courses, payments, dive logs, fleet logistics, and staff
operations. (FunDivers TW is the shop it was built for and its first
deployment.) Every commercial alternative below is paid, closed-source SaaS;
each is scored against FunDive on the capabilities that most separate them.

Legend: ✓ yes · ~ partial/limited · ✗ no · ? not documented

| Platform | Open source | Online card pay | POS / rental inventory | E-sign waiver | Fleet ride logistics | Family lead-payer | Price / mo |
| --- | :--: | :--: | :--: | :--: | :--: | :--: | --- |
| **FunDive (this app)** | **✓** | ✗ (manual) | ✗ | ✓ | **✓** | **✓** | **free** (self-host) |
| DiveAdmin | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | $39–119 |
| DiveShop360 | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | $149+ (upper tiers gated) |
| Lueira | ✗ | ✓ | ✓ | ✓ (eIDAS) | ✗ | ~ (family links) | €80–212 |
| Bloowatch | ✗ | ✓ (0% comm.) | ✓ | ✓ | ✗ | ✗ | €49–119 |
| AquaDivePro | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | €25–55 |
| DivePrep | ✗ | ✓ | ~ (gear inv.) | ✓ | ✗ | ✗ | free (beta, hosted) |
| DiversDesk | ✗ | ✓ | ? | ✓ | ✗ | ✗ | $27–64 |
| DiveOps | ✗ | ✓ | ~ (equipment) | ✓ | ✗ | ✗ | not public |
| ScubaOcity | ✗ | ✓ | ✓ (POS sync) | ✓ | ✗ | ~ (group leader) | not public |
| DivingCenterSoftware | ✗ | ~ | ✓ (inventory) | ✗ | ✗ | ✗ | not public |
| GeekDivers | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | variable (≈2 fun dives) |
| DiveCrewPro | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | $49 flat (scheduling only) |

**Read:** FunDive is the only free, open-source, self-hostable option — you own
the code and the data, with no per-seat fee. It's also alone in offering
car-ride/seat logistics and family lead-payer billing. The paid field still
leads on online card payments and POS / rental inventory, where FunDive trails.
