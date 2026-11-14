//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rsbuild/core'
import { pluginSass } from '@rsbuild/plugin-sass'
import { pluginSvelte } from '@rsbuild/plugin-svelte'
import { pluginTypeCheck } from '@rsbuild/plugin-type-check'
import { parse } from 'dotenv'
import CompressionPlugin from 'compression-webpack-plugin'
import sveltePreprocess from 'svelte-preprocess'
import proxy from './dev-proxy.js'
import sass from '../../common/scripts/sass-quiet.js'

const require = createRequire(import.meta.url)
const directory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ envMode }) => {
  const production = envMode === 'production'
  const clientType = process.env.CLIENT_TYPE ?? ''
  const developmentEntry = ['dev', 'dev-server', 'dev-server-test', 'dev-production', 'dev-staging'].includes(clientType)
  const dotenvPath = path.join(directory, production ? '.env-prod' : '.env')
  const clientEnv = {
    ...parse(readFileSync(dotenvPath)),
    NODE_ENV: production ? 'production' : 'development',
    CLIENT_TYPE: clientType
  }
  const svelteDirectory = path.dirname(require.resolve('svelte/package.json'))
  const buildCache = process.env.USE_CACHE === 'true'
    ? { cacheDirectory: path.join(directory, '.build_rsbuild'), cacheDigest: [clientType] }
    : false

  return {
    root: directory,
    plugins: [
      pluginSvelte({
        svelteLoaderOptions: {
          emitCss: true,
          hotReload: !production,
          preprocess: sveltePreprocess({
            postcss: true,
            sourceMap: true,
            scss: { implementation: sass }
          }),
          hotOptions: {
            preserveLocalState: true,
            noPreserveStateKey: '@!hmr',
            noReload: true,
            optimistic: false,
            acceptAccessors: true,
            acceptNamedExports: true
          }
        }
      }),
      pluginSass({ sassLoaderOptions: { api: 'modern', implementation: sass } }),
      pluginTypeCheck({
        enable: !production || process.env.DO_VALIDATE === 'true',
        tsCheckerOptions: {
          typescript: { typescriptPath: require.resolve('typescript') }
        }
      }),
      {
        name: 'tracex:benchmark',
        setup(api) {
          if (process.env.TRACEX_BENCHMARK !== 'true') return
          api.onAfterDevCompile(({ stats }) => {
            if (stats.hasErrors()) console.error('[TraceX benchmark] initial compilation failed')
            else console.log('[TraceX benchmark] initial compilation completed')
          })
        }
      }
    ],
    source: {
      define: {
        ...Object.fromEntries(Object.entries(clientEnv).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)])),
        'process.env': JSON.stringify(clientEnv)
      }
    },
    resolve: {
      alias: {
        '@hcengineering/platform-rig/profiles/ui/svelte': path.join(svelteDirectory, 'src/runtime')
      },
      conditionNames: ['svelte', 'browser', 'import', '...'],
      mainFields: ['svelte', 'browser', 'module', 'main']
    },
    output: {
      distPath: { root: path.join(directory, 'dist') },
      assetPrefix: '/',
      dataUriLimit: 0,
      injectStyles: true,
      polyfill: 'off',
      sourceMap: { js: production ? 'source-map' : 'eval-source-map', css: true },
      overrideBrowserslist: ['chrome >= 90', 'edge >= 90', 'firefox >= 90', 'safari >= 14.1']
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
      port: 8080,
      strictPort: true,
      historyApiFallback: { disableDotRule: true },
      publicDir: { name: path.join(directory, 'public') },
      proxy: proxy[clientType] ?? {}
    },
    dev: { cliShortcuts: false, lazyCompilation: false },
    performance: { buildCache, printFileSize: false },
    environments: {
      web: {
        source: {
          entry: {
            index: ['@hcengineering/theme/styles/global.scss', developmentEntry ? './src/main-dev.ts' : './src/main.ts']
          }
        },
        html: {
          title: 'TraceX',
          meta: { viewport: 'width=device-width, initial-scale=1.0' }
        },
        tools: {
          rspack(config) {
            config.resolve.fallback = { ...config.resolve.fallback, crypto: false }
            config.optimization.minimize = production
            if (!production) {
              config.optimization.mangleExports = false
              config.optimization.usedExports = false
            }
            if (production) config.plugins.push(new CompressionPlugin())
          },
          bundlerChain(chain) {
            chain.module.rule('svg').use('svgo').loader(require.resolve('svgo-loader')).options({
              plugins: [{ name: 'removeHiddenElems', active: false }]
            })
          }
        }
      },
      serviceWorker: {
        source: {
          entry: {
            serviceWorker: {
              import: require.resolve('@hcengineering/notification/src/serviceWorker.ts'),
              html: false
            }
          }
        },
        output: {
          target: 'web-worker',
          distPath: { js: '' },
          filename: { js: '[name].js' },
          filenameHash: false
        },
        dev: { hmr: false, liveReload: false },
        tools: {
          rspack(config) {
            config.target = ['webworker', 'es2021']
            config.optimization.runtimeChunk = false
            config.optimization.splitChunks = false
          }
        }
      }
    }
  }
})
