// eslint.config.js
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      // Auto-generated files
      'src/syntaxes/agentlang.monarch.ts',
      // Ignore dist folders
      '**/dist/**',
      // Ignore out folder
      'out/**',
      // Config files not included in tsconfig
      'vite.config.ts',
      'vitest.config.ts',
      // Ignore all config.ts files (configuration files)
      '**/*.config.ts',
    ],
  },
  // Apply typescript-eslint recommended configs
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'prefer-spread': 'warn',
      'no-useless-escape': 'warn',
    },
  },
];
