// Flat config. Deliberately minimal: M4 STEP 0b adds exactly one enforced
// rule — banning deep '@tensor-editor/engine/src/*' imports. The engine's
// package root is the only public contract; deep source imports bypass its
// exports map and break the moment the engine ships compiled artifacts.
// (No lint-style rules are enforced here yet beyond the hooks hygiene the
// codebase already documents itself against; this file is the seam for
// future rules. The TS parser is wired so TS syntax parses.)
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['dist/', 'src-tauri/', 'src/generated/'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // Warn-level: the repo's existing `eslint-disable
      // react-hooks/exhaustive-deps` comments predate this config and
      // must keep meaning something; violations surface without gating
      // M4 on legacy-hook audits.
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tensor-editor/engine/src/*', '@tensor-editor/engine/src/**', '**/tensor/engine/src/**'],
              message:
                "Import from '@tensor-editor/engine' (package root) only — deep src imports bypass the package contract (M4 STEP 0b).",
            },
          ],
        },
      ],
    },
  },
];