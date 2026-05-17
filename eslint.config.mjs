import { createRequire } from "module";
const require = createRequire(import.meta.url);
const js = require("@eslint/js");
const typescript = require("@typescript-eslint/eslint-plugin");
const typescriptParser = require("@typescript-eslint/parser");

export default [
  // Base JavaScript recommended rules
  js.configs.recommended,

  // TypeScript configuration
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: {
        // Node.js globals
        global: "readonly",
        process: "readonly",
        Buffer: "readonly",
        console: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",

        // VS Code extension globals
        Thenable: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": typescript,
    },
    rules: {
      // TypeScript-specific rules with relaxed naming for object literals
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "default",
          format: ["camelCase"],
        },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "property",
          format: null, // Allow any format for object properties (like command IDs)
        },
        {
          selector: "objectLiteralProperty",
          format: null, // Allow any format for object literal properties
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        {
          selector: "import",
          format: ["camelCase", "PascalCase"], // Allow both for imports (types and values)
        },
      ],

      // General JavaScript/TypeScript rules
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "off",

      // Disable some rules that might conflict with TypeScript
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Test files configuration
  {
    files: ["src/test/**/*.ts"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
      },
      globals: {
        // Node.js globals
        global: "readonly",
        process: "readonly",
        Buffer: "readonly",
        console: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",

        // Mocha globals for test files
        describe: "readonly",
        it: "readonly",
        before: "readonly",
        after: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        suite: "readonly",
        test: "readonly",

        // VS Code extension globals
        Thenable: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": typescript,
    },
    rules: {
      // Same rules as main TypeScript files
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "default",
          format: ["camelCase"],
        },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "property",
          format: null,
        },
        {
          selector: "objectLiteralProperty",
          format: null,
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
        {
          selector: "import",
          format: ["camelCase", "PascalCase"], // Allow both for imports (types and values)
        },
      ],
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  // JavaScript CommonJS files: src worker, scripts, webpack config
  {
    files: ["src/**/*.js", "scripts/**/*.js", "webpack*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "commonjs",
      globals: {
        // Node.js CommonJS globals
        global: "readonly",
        process: "readonly",
        Buffer: "readonly",
        console: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
      },
    },
    rules: {
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "off",
    },
  },

  // LWC webview components — ESM with legacy decorator syntax (@api, @track, @wire)
  {
    files: ["src/webviews/lwc-ui/**/*.js"],
    plugins: {
      // Stub so eslint-disable comments for @lwc/lwc rules don't cause "rule not found" errors
      "@lwc/lwc": {
        rules: {
          "no-async-operation": { create: () => ({}) },
        },
      },
    },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        sourceType: "module",
        experimentalDecorators: true,
      },
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        Promise: "readonly",
        CustomEvent: "readonly",
        requestAnimationFrame: "readonly",
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      // Style rules off — prevents MegaLinter auto-fix from modifying LWC source files
      curly: "off",
      eqeqeq: "off",
      semi: "off",
      // Downgrade to warn with patterns matching the project convention
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
      }],
      // Existing LWC code uses lexical declarations in switch cases
      "no-case-declarations": "off",
      // Existing LWC code has intermediate assignment patterns
      "no-useless-assignment": "off",
    },
  },

  // Ignore patterns
  {
    ignores: [
      "out/**",
      "node_modules/**",
      "**/*.d.ts",
      ".vscode-test/**",
      "vscode-sfdx-hardis-*.vsix",
      "webpack.config.js",
      // Ignore LWC JS files handled by LWC compiler
      "src/webviews/lwc-ui/index.js",
      "src/webviews/lwc-ui/stubs/**",
      "src/webviews/lwc-ui/modules/s/**",
    ],
  },
];
