const ESLintWebpackPlugin = require('eslint-webpack-plugin')

module.exports = {
  configureWebpack: {
    resolve: {
      fallback: {
        assert: require.resolve('assert/'),
        fs: false,
        http: require.resolve('stream-http'),
        https: require.resolve('https-browserify'),
        path: require.resolve('path-browserify'),
        querystring: require.resolve('querystring-es3'),
        stream: require.resolve('stream-browserify'),
        url: require.resolve('url/'),
        util: require.resolve('util/'),
        zlib: require.resolve('browserify-zlib'),
      },
    },
    optimization: {
      splitChunks: {
        chunks: 'all',
      },
    },
  },
  chainWebpack: config => {
    config.plugin('eslint').use(ESLintWebpackPlugin, [
      {
        context: __dirname,
        files: ['src/**/*.{js,jsx,ts,vue}'],
        extensions: ['js', 'jsx', 'ts', 'vue'],
        failOnWarning: false,
        failOnError: true,
      },
    ])

    // svg: https://github.com/visualfanatic/vue-svg-loader
    const svgRule = config.module.rule('svg')
    svgRule.uses.clear()
    svgRule.delete('type')
    svgRule
      .use('vue-loader')
      .loader('vue-loader')
      .end()
      .use('vue-svg-loader')
      .loader('vue-svg-loader')
      // vue-svg-loader removes viewBox by default if width and height are present to optimize size
      // override to preserve width and height while allowing it to scale properly if width and height are overridden (e.g. set to 100% to fill container)
      // https://github.com/visualfanatic/vue-svg-loader/issues/58
      .options({
        svgo: {
          plugins: [{ removeViewBox: false }],
        },
      })
  },
}
