import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';

// Module boundaries (technical design v2, "Dependency rules"):
// ui → client → host → engine; ui, host and client may use storage; client uses transport;
// everything may use types; engine uses only engine and types, and touches no browser API.
const src = './src';
const zone = (target, from, message) => ({ target: `${src}/${target}`, from: from.map((f) => `${src}/${f}`), message });
const boundaries = [
  zone('types', ['engine', 'host', 'client', 'transport', 'storage', 'ui'], 'types/ imports nothing but types/.'),
  zone('engine', ['host', 'client', 'transport', 'storage', 'ui'], 'engine/ imports only engine/ and types/.'),
  zone('host', ['client', 'transport', 'ui'], 'host/ may import engine/, storage/ and types/.'),
  zone('storage', ['host', 'client', 'transport', 'ui'], 'storage/ may import engine/ and types/ only.'),
  zone('transport', ['engine', 'host', 'client', 'storage', 'ui'], 'transport/ imports only types/.'),
  zone('client', ['ui'], 'client/ must not import ui/.'),
];

const browserOnly = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'crypto', 'fetch',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'Date', 'performance']
  .map((name) => ({ name, message: 'The engine is pure: pass time, randomness and storage in from the host.' }));

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'test-results/', 'playwright-report/', 'tests/fixtures/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'import-x': importX },
    settings: { 'import-x/resolver-next': [createTypeScriptImportResolver()] },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'import-x/no-restricted-paths': ['error', { zones: boundaries }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/engine/**'],
    languageOptions: { globals: {} },
    rules: { 'no-restricted-globals': ['error', ...browserOnly] },
  },
  {
    files: ['*.config.{js,ts}', 'e2e/**', 'tests/**'],
    languageOptions: { globals: { ...globals.node } },
  },
);
