const path = require('node:path')
const js = require('@eslint/js')
const { FlatCompat } = require('@eslint/eslintrc')
const fpPlugin = require('eslint-plugin-fp')
const globals = require('globals')

const noMutatingMethodsRule = fpPlugin?.rules?.['no-mutating-methods']
if (noMutatingMethodsRule) {
  noMutatingMethodsRule.meta = {
    ...(noMutatingMethodsRule.meta || {}),
    schema: [
      {
        type: 'object',
        properties: {
          allowedObjects: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
        },
        additionalProperties: false,
      },
    ],
  }
}

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

module.exports = [
  {
    ignores: ['dist/**', 'public/dbcache.js'],
  },
  ...compat.config({
    parser: 'vue-eslint-parser',
    extends: [
      'eslint:recommended',
      'plugin:jest-dom/recommended',
      'plugin:testing-library/vue',
      'plugin:vue/vue3-recommended',
      'plugin:import/recommended',
      'plugin:promise/recommended',
      'plugin:n/recommended',
      'prettier',
    ],
    parserOptions: {
      parser: '@babel/eslint-parser',
      sourceType: 'module',
    },
    plugins: ['fp', 'node', 'jest-dom', 'testing-library', 'prettier'],
    settings: {
      'import/resolver': {
        webpack: {
          config: {
            resolve: {
              alias: {
                '@': path.resolve(__dirname, 'src'),
              },
              extensions: ['.js', '.jsx', '.ts', '.tsx', '.vue', '.json'],
            },
          },
        },
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx', '.vue', '.json'],
        },
      },
    },
    rules: {
      'prettier/prettier': [2],
      'vue/component-name-in-template-casing': [2, 'PascalCase'],
      'vue/attribute-hyphenation': 0,
      'vue/attributes-order': 0,
      'vue/html-closing-bracket-newline': 0,
      'vue/max-attributes-per-line': 0,
      'vue/multiline-html-element-content-newline': 0,
      'vue/no-lone-template': 0,
      'vue/multi-word-component-names': 0,
      'vue/no-reserved-component-names': 0,
      'vue/require-default-prop': 0,
      'vue/require-prop-types': 0,
      'vue/singleline-html-element-content-newline': 0,
      // use fork to allow MemberExpressions
      // https://github.com/jfmengels/eslint-plugin-fp/pull/54
      'fp/no-mutating-methods': [
        2,
        {
          allowedObjects: ['$router', 'router', '_'],
        },
      ],
      'testing-library/render-result-naming-convention': 0,
      'testing-library/prefer-screen-queries': 0,
      'n/no-missing-import': 0, // added because node algorigth does not understand out webpack alias (@)
    },
  }),
  // {
  //   files: ['src/**/*.js', 'src/**/*.vue'],
  //   rules: {
  //     // browser bundle uses DOM/Blob APIs that are unavailable in Node,
  //     // so disable Node builtin compatibility checks there
  //     'n/no-unsupported-features/node-builtins': 0,
  //   },
  // },
  {
    files: ['**/*.test.js', '**/*.spec.js', '**/__tests__/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
]
