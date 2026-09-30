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

const { build } = require('../package.json')

const publish = {
  provider: 'generic',
  url: 'https://dist.tracex.co',
  channel: 'tracex-staging'
}

module.exports = {
  ...build,
  productName: 'TraceX Staging',
  extraMetadata: { productName: 'TraceX Staging' },
  appId: 'co.tracex.desktop.staging',
  extraResources: [{
    from: './src/config-staging/',
    to: './config/',
    filter: ['**/*.json']
  }],
  mac: {
    ...build.mac,
    artifactName: 'TraceX-Staging-macos-${version}-${arch}.${ext}',
    icon: './src/staging/AppIcon.icns',
    publish
  },
  win: {
    ...build.win,
    artifactName: 'TraceX-Staging-windows-${version}-${arch}.${ext}',
    icon: './src/staging/AppIcon.ico',
    publish
  },
  nsis: {
    ...build.nsis,
    include: './staging-installer.nsh',
    installerIcon: './src/staging/AppIcon.ico',
    uninstallerIcon: './src/staging/AppIcon.ico'
  },
  linux: {
    ...build.linux,
    artifactName: 'TraceX-Staging-linux-${version}.${ext}',
    icon: './src/staging/AppIcon.png',
    publish
  }
}
