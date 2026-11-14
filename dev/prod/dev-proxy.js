//
// Copyright © 2020 Anticrm Platform Contributors.
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

const devProxy = {
  '/account': {
    target: 'http://tracex.local:3000',
    changeOrigin: true,
    pathRewrite: { '^/account': '' },
    logLevel: 'debug'
  },
  '/files': {
    target: 'http://tracex.local:8087',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/api/v1': {
    target: 'http://tracex.local:8087',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/api/forms': {
    target: 'http://tracex.local:8087',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/rekoni/recognize': {
    target: 'http://tracex.local:4004',
    changeOrigin: true,
    pathRewrite: { '^/rekoni/recognize': '/recognize' },
    logLevel: 'debug'
  }
}

const devProxyTest = {
  '/account': {
    target: 'http://tracex.local:3003',
    changeOrigin: true,
    pathRewrite: { '^/account': '' },
    logLevel: 'debug'
  },
  '/files': {
    target: 'http://tracex.local:8083',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/api/v1': {
    target: 'http://tracex.local:8083',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/api/forms': {
    target: 'http://tracex.local:8083',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/rekoni/recognize': {
    target: 'http://tracex.local:4004',
    changeOrigin: true,
    pathRewrite: { '^/rekoni/recognize': '/recognize' },
    logLevel: 'debug'
  }
}

const devProductionProxy = {
  '/account': {
    target: 'https://app.tracex.co/accounts',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/files': {
    target: 'https://app.tracex.co/files',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/api/v1': {
    target: 'https://app.tracex.co',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/api/forms': {
    target: 'https://app.tracex.co',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/rekoni/recognize': {
    target: 'https://app.tracex.co/rekoni',
    changeOrigin: true,
    pathRewrite: { '^/rekoni/recognize': '/recognize' },
    logLevel: 'debug'
  }
}

const devStagingProxy = {
  '/account': {
    target: 'https://stg.tracex.co/accounts',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/files': {
    target: 'https://stg.tracex.co/files',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/api/v1': {
    target: 'https://stg.tracex.co',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/api/forms': {
    target: 'https://stg.tracex.co',
    changeOrigin: true,
    logLevel: 'debug'
  },
  '/rekoni/recognize': {
    target: 'https://stg.tracex.co/rekoni',
    changeOrigin: true,
    pathRewrite: { '^/rekoni/recognize': '/recognize' },
    logLevel: 'debug'
  }
}

module.exports = {
  'dev-server': devProxy,
  'dev-server-test': devProxyTest,
  'dev-production': devProductionProxy,
  'dev-staging': devStagingProxy
}

