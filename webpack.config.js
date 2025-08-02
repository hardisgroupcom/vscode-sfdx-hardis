const path = require('path');
const webpack = require('webpack');
const LwcWebpackPlugin = require('lwc-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: 'node', // vscode extensions run in Node.js context
  mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

  entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'out' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'out'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log", // enables logging required for problem matchers
  },
};

/** @type {import('webpack').Configuration} */
const workerConfig = {
  target: 'node',
  mode: 'none',
  
  entry: './src/worker.ts',
  output: {
    path: path.resolve(__dirname, 'out'),
    filename: 'worker.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log",
  },
};

/** @type {import('webpack').Configuration} */
const lwcWebviewConfig = {
  target: 'web',
  mode: 'none',
  
  entry: './src/webviews/lwc-demo/index.js',
  output: {
    path: path.resolve(__dirname, 'out', 'webviews'),
    filename: 'lwc-demo.js',
  },
  resolve: {
    extensions: ['.js', '.ts'],
    fallback: {
      "process": require.resolve("process/browser"),
    }
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        include: [
          path.resolve(__dirname, 'src/webviews/lwc-demo'),
          path.resolve(__dirname, 'src/webviews'),
        ],
        use: [
          {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env'],
              plugins: [
                ['@lwc/babel-plugin-component', {
                  namespace: 's'
                }]
              ]
            }
          }
        ]
      }
    ]
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
    }),
    new LwcWebpackPlugin({
      modules: [
        {
          dir: path.resolve(__dirname, 'src/webviews/lwc-demo/modules'),
        }
      ],
      mode: 'development',
      experimentalSyntheticShadow: true,
      experimentalDynamicComponent: true
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'node_modules/@salesforce-ux/design-system/assets/styles/salesforce-lightning-design-system.min.css'),
          to: 'assets/slds.css'
        },
        {
          from: path.resolve(__dirname, 'node_modules/@salesforce-ux/design-system/assets/icons'),
          to: 'assets/icons'
        }
      ]
    })
  ],
  devtool: 'source-map',
  infrastructureLogging: {
    level: "log",
  },
};

module.exports = [extensionConfig, workerConfig, lwcWebviewConfig];
