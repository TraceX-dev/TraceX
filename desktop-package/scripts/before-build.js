// electron-builder `beforeBuild` hook.
//
// The app is fully bundled by webpack into ./dist (see ../desktop), so the packaged app
// needs nothing from node_modules. Returning `false` tells electron-builder that
// node_modules are handled externally: it skips dependency install/rebuild and, most
// importantly, the node-module collector. In this Rush/pnpm monorepo the collector falls
// back to `npm list -a`, which walks the whole symlinked workspace and runs out of memory.
module.exports = async function beforeBuild () {
  return false
}
