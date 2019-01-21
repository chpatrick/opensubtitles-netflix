const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin')

module.exports = env => ({
  entry: {
    "background": './src/background.ts',
    "player-payload": "./src/player-payload.tsx",
    "content-script": "./src/content-script.ts"
  },
  devtool: (env && env.sourceMap) ? 'inline-source-map' : undefined,
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: [
          { loader: "style-loader" },
          { loader: "css-loader" }
        ]
      },
      {
        test: /\.svg$/,
        use: [
          { loader: "url-loader" },
        ]
      }
    ]
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ]
  },
  output: {
    path: path.resolve(__dirname, 'dist')
  },
  plugins: [
    new webpack.DefinePlugin({
      'OS_USER_AGENT': JSON.stringify((env && env.userAgent) || 'TemporaryUserAgent'),
      'OS_PAYLOAD_SRC': (env && env.devServer) ? "'https://localhost:8080/player-payload.js'" : "chrome.extension.getURL('player-payload.js')"
    }),
    new CopyWebpackPlugin([ 'src/manifest.json' ])
  ],
  devServer: {
    writeToDisk: true,
    disableHostCheck: true,
    https: true
  }
});
