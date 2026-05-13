/** @type {import('prettier').Config} */
module.exports = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  arrowParens: 'always',
  bracketSpacing: true,
  endOfLine: 'lf',
  quoteProps: 'as-needed',
  overrides: [
    {
      files: ['*.md', '*.mdx'],
      options: {
        printWidth: 80,
        proseWrap: 'preserve',
      },
    },
    {
      files: ['*.json', '*.jsonc'],
      options: {
        trailingComma: 'none',
      },
    },
  ],
};
