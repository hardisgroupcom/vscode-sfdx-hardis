const path = require("path");
const webpack = require("webpack");
const LwcWebpackPlugin = require("lwc-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

const extensionConfig = {
  target: "node",
  entry: "./src/extension.ts",
  output: {
    path: path.resolve(__dirname, "out"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
  },
  externals: {
    vscode: "commonjs vscode",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
};

const workerConfig = {
  target: "node",
  entry: "./src/worker.ts",
  output: {
    path: path.resolve(__dirname, "out"),
    filename: "worker.js",
    libraryTarget: "commonjs2",
  },
  externals: {
    vscode: "commonjs vscode",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
};

const lwcWebviewConfig = {
  target: "web",
  entry: "./src/webviews/lwc-ui/index.js",
  output: {
    path: path.resolve(__dirname, "out", "webviews"),
    filename: "lwc-ui.js",
  },
  resolve: {
    extensions: [".js", ".ts"],
    modules: ["node_modules"],
    fallback: {
      process: require.resolve("process/browser"),
    },
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        include: [
          path.resolve(__dirname, "src/webviews/lwc-ui"),
          path.resolve(__dirname, "src/webviews"),
        ],
        use: [
          {
            loader: "babel-loader",
            options: {
              presets: ["@babel/preset-env"],
              plugins: [
                [
                  "@lwc/babel-plugin-component",
                  {
                    namespace: "s",
                    experimentalDynamicComponent: true,
                    enableDynamicComponents: true,
                  },
                ],
              ],
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: "process/browser",
    }),
    new LwcWebpackPlugin({
      modules: [
        {
          dir: path.resolve(__dirname, "src/webviews/lwc-ui/modules"),
        },
        {
          npm: "lightning-base-components",
        },
      ],
      experimentalSyntheticShadow: true,
      experimentalDynamicComponent: true,
      enableDynamicComponents: true,
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(
            __dirname,
            "node_modules/@salesforce-ux/design-system/assets/styles/salesforce-lightning-design-system.min.css",
          ),
          to: path.resolve(
            __dirname,
            "out/assets/styles/salesforce-lightning-design-system.min.css",
          ),
          noErrorOnMissing: true,
        },
        {
          from: path.resolve(
            __dirname,
            "node_modules/@salesforce-ux/design-system/assets/icons",
          ),
          to: path.resolve(__dirname, "out/assets/icons"),
          noErrorOnMissing: true,
        },
        {
          from: path.resolve(
            __dirname,
            "node_modules/mermaid/dist/mermaid.min.js",
          ),
          to: path.resolve(__dirname, "out/webviews"),
          noErrorOnMissing: true,
        },
        {
          from: path.resolve(__dirname, "resources/git-icons"),
          to: path.resolve(__dirname, "out/resources/git-icons"),
          noErrorOnMissing: true,
        },
        {
          from: path.resolve(
            __dirname,
            "resources/sfdx-hardis.jsonschema.json",
          ),
          to: path.resolve(
            __dirname,
            "out/resources/sfdx-hardis.jsonschema.json",
          ),
          noErrorOnMissing: true,
        },
      ],
    }),
  ],
};

module.exports = { extensionConfig, workerConfig, lwcWebviewConfig };
