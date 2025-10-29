# Frontend Build & TypeScript Config Audit

**Date:** ~2025-09 (estimated)
**Status:** ACTIONABLE - Still relevant technical debt

This report reviews the current Vite, TypeScript, Vitest, ESLint, and related build configurations and suggests safe, incremental improvements. No changes have been applied.

**Progress Check (2025-10-28):**
- ✅ `.eslintignore` - Removed
- ❌ `.eslintrc.cjs` - Still exists (should remove in favor of flat config)
- ❌ Root `index.html` - Still exists (should remove, it's stale)
- ❓ Vitest alias - Not checked
- ❓ TS config split - Not implemented

## Overview

- Stack: Electron (main/preload/workers via esbuild) + React renderer (Vite).
- Current outputs converge in `dist` for both esbuild (CJS) and Vite (renderer assets).
- TS config is shared across all targets (Node + DOM), which causes mixed assumptions.

## Vite

- Current
  - `vite.config.ts` uses `root: src/renderer`, `base: ./`, and builds into `dist` with `emptyOutDir: false`.
  - Alias `@` → `src/renderer` (not used anywhere in code).
- Notes
  - Single `dist` is workable since `emptyOutDir: false` avoids clobbering esbuild outputs and `main.ts` loads `dist/index.html` in production.
- Recommendations
  - Consider `build.outDir: 'dist/renderer'` for clearer separation of main vs renderer outputs. If adopted, update `main.ts` to `win.loadFile(path.join(__dirname, 'renderer/index.html'))`.
  - Either remove the `@` alias from Vite (if not using), or start using it and add a matching TS `paths` mapping to keep types in sync.
  - Minor: in ESM configs, prefer `fileURLToPath(new URL('.', import.meta.url))` over `__dirname` to avoid edge cases. Not critical if Node resolves it in your current setup.

## TypeScript

- Current
  - Single `tsconfig.json` for all code with `module: commonjs`, `lib: [ES2022, DOM]`, `jsx: react`, `outDir: dist`.
  - `tsconfig.strict.json` extends base and enables `noUnused*` with `noEmit`.
- Issues
  - A single config mixes Node (main/preload/worker) and DOM (renderer) types. This can hide errors and complicate tooling.
  - `module: commonjs` is suboptimal for the Vite renderer (ESM/bundler assumptions). Vite ignores TS emit, but the module target affects type resolution.
  - `jsx: "react"` is outdated for React 17+ (prefer automatic runtime).
  - `tsc -b` in `npm run build` will emit JS to `dist` before bundlers also write there, leading to redundant/confusing artifacts.
- Recommendations
  - Split configs:
    - `tsconfig.renderer.json` (for `src/renderer`):
      - `module: "ESNext"`, `moduleResolution: "bundler"`, `lib: ["ES2022", "DOM"]`, `jsx: "react-jsx"`, optionally `types: ["vite/client"]` if using `import.meta`.
    - `tsconfig.node.json` (for `src/main` and `src/shared`/workers):
      - `module: "ESNext"` (esbuild outputs CJS), `moduleResolution: "node16"` or `"node"`, `lib: ["ES2022"]`, `types: ["node"]`, no DOM libs.
  - Change build-time type checking to avoid TS emit:
    - In `package.json` build script, change `tsc -b` → `tsc -b --noEmit`, or use a dedicated `tsconfig.typecheck.json` with `noEmit: true`.
  - If you keep the `@` alias: add TS `paths` mapping to match Vite.

## Vitest

- Current
  - `vitest.config.ts` sets `globals: true`, `environment: 'node'`, `setupFiles: ['./tests/helpers/setup.ts']`.
  - Coverage thresholds and excludes look reasonable.
  - `resolve.alias['@'] = path.join(__dirname, 'app')`.
- Issues
  - Alias points to non-existent `app` directory. This will break any `@/` import used in tests.
- Recommendations
  - Change alias to match Vite or remove it if unused:
    - Example: `alias: { '@': path.join(__dirname, 'src/renderer') }` or simply remove.
  - If you plan to test React components in Vitest, consider using `environment: 'jsdom'` for those suites (can be file-local via `// @vitest-environment jsdom`).

## ESLint

- Current
  - Both flat config `eslint.config.js` (ESLint v9+) and legacy `.eslintrc.cjs` exist.
  - `.eslintignore` also exists; the flat config already defines `ignores`.
- Issues
  - Having both configs can cause confusion. ESLint v9 will use flat config and ignore `.eslintrc.*`, but the duplicate file suggests drift risk.
  - Redundant `.eslintignore` since `eslint.config.js` already lists ignores.
- Recommendations
  - Remove `.eslintrc.cjs` and `.eslintignore` to reduce confusion (unless other tools rely on them). Keep `eslint.config.js` as the single source of truth.

## Index HTML

- Current
  - Root `index.html` references `/app/renderer/main.tsx` which doesn’t exist; Vite uses `src/renderer/index.html`.
- Recommendation
  - Remove root `index.html` (stale/unused) to avoid confusion.

## Dev Script

- Current
  - `scripts/setup-dev.js` attempts to symlink `dist/node_modules` → `app/node_modules`.
- Issues
  - There is no `app` directory. This script likely predates the current structure.
- Recommendations
  - Either remove the script, or point the symlink to the project `node_modules` if still needed. For example, `sourcePath = <repo>/node_modules`.

## esbuild (Electron main/preload/worker)

- Current
  - Uses CJS output (`format: 'cjs'`) targeting Node 18; externals list is well-curated. Production build disables sourcemaps; watch enables them.
- Notes
  - Externals differ between `esbuild.build.mjs` and `esbuild.watch.mjs`; consider centralizing to prevent drift.
  - If adopting separate renderer outDir (`dist/renderer`), no esbuild change is required; only the Electron `loadFile` path changes.

## Suggested Next Actions (minimal-risk)

1. Fix Vitest alias to the correct folder (or remove if unused).
2. Remove stale root `index.html` to avoid confusion.
3. Remove legacy `.eslintrc.cjs` and `.eslintignore` to rely on the flat config only.
4. Decide on the `@` alias: remove it everywhere, or adopt it consistently and add TS `paths`.
5. Update build type-checking to `tsc -b --noEmit` (avoid duplicate JS in `dist`).
6. Optionally split TS configs into `tsconfig.node.json` and `tsconfig.renderer.json` for cleaner typing.
7. Optionally separate Vite outDir to `dist/renderer` and adjust `main.ts` accordingly.
8. Prune or fix `scripts/setup-dev.js` to reflect the current project topology.

## Impact Summary

- Changes 1–5 are low risk and reduce confusion/errors without altering runtime behavior.
- Splitting TS configs and outDir separation are moderate changes that improve correctness and maintainability; they require small path updates.
- Dev script removal is safe if not referenced by any workflow.

---

If you’d like, I can prepare precise patches for: (a) Vitest alias correction, (b) removing stale/duplicate configs, and (c) a two-config TS setup, all behind a PR-sized change set for review.

