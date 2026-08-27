import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Flat configuration, which is the only kind ESLint 9 reads.
 *
 * The rules are deliberately few. This codebase is checked far harder by the type checker
 * and by its own tests than a linter can manage, so what is left here is the small set of
 * things neither of those catches: unused code, and types that have given up.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'EndlessQuest.html', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  }
);
