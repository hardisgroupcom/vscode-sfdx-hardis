const {
  extensionConfig,
  workerConfig,
  lwcWebviewConfig,
} = require("./webpack.common.js");
const TerserPlugin = require("terser-webpack-plugin");

const prodtool = "hidden-source-map";

function prodOptimization() {
  return {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          format: {
            comments: false,
          },
        },
        extractComments: false,
      }),
    ],
  };
}

module.exports = [
  {
    ...extensionConfig,
    mode: "production",
    devtool: prodtool,
    optimization: prodOptimization(),
    infrastructureLogging: { level: "error" },
  },
  {
    ...workerConfig,
    mode: "production",
    devtool: prodtool,
    optimization: prodOptimization(),
    infrastructureLogging: { level: "error" },
  },
  {
    ...lwcWebviewConfig,
    mode: "production",
    devtool: prodtool,
    optimization: prodOptimization(),
    infrastructureLogging: { level: "error" },
  },
];
