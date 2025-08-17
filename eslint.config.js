import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";

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

  // JavaScript worker files configuration
  {
    files: ["src/**/*.js"],
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
      "src/webviews/lwc-ui/modules/s/**",
    ],
  },
];
