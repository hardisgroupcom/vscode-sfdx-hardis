const {
  extensionConfig,
  workerConfig,
  lwcWebviewConfig,
} = require("./webpack.common.js");

const devtool = "source-map";

module.exports = [
  {
    ...extensionConfig,
    mode: "development",
    devtool,
    infrastructureLogging: { level: "log" },
  },
  {
    ...workerConfig,
    mode: "development",
    devtool,
    infrastructureLogging: { level: "log" },
  },
  {
    ...lwcWebviewConfig,
    mode: "development",
    devtool,
    infrastructureLogging: { level: "log" },
  },
];
