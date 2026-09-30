# TraceX desktop releases

The `sX.Y.Z` tag builds **TraceX Staging** for `https://stg.tracex.co/`. The
`vX.Y.Z` tag builds **TraceX** for `https://app.tracex.co/`. Each build has its
own application ID, install directory, icon, bundled server, and update channel.

The build workflow uploads installers and immutable update manifests to
`https://dist.tracex.co`:

| Variant | Versioned manifests | Update channel |
| --- | --- | --- |
| Staging | `tracex-staging-X.Y.Z.yml` (also `-mac`, `-linux`) | `tracex-staging.yml` (also `-mac`, `-linux`) |
| Prod | `tracex-X.Y.Z.yml` (also `-mac`, `-linux`) | `tracex.yml` (also `-mac`, `-linux`) |

The infrastructure deployment workflow copies the matching versioned manifests
to the channel names after a successful service deploy. The desktop build does
not promote a channel itself.

## Run locally

Install the repository dependencies first (`rush install` if needed). The `dist`
commands require `qms-desktop-package/dist`, which is created by the Rush
package phase. From the repository root, run:

```bash
node common/scripts/install-run-rush.js package --to qms-desktop -v
cd qms-desktop-package
rushx dist-local --macos --arm64
rushx dist-staging --macos --arm64
```

This example builds both local installers on Apple Silicon macOS. Use `--x64`
instead of `--arm64` on Intel macOS. CI builds the Windows and Linux
installers. The local installers appear in `qms-desktop-package/deploy/` as
`TraceX-...` and `TraceX-Staging-...`. Install and launch both to check that
prod opens `app.tracex.co`, staging opens `stg.tracex.co`, and their local data
is separate. Local macOS packages are unsigned; CI signs the release build
with `dist-signed` or `dist-staging-signed`.

For a quick source checkout run against staging without separate application
identities, first run the Rush package command above, then use `--server`:

```bash
# From the repository root:
cd desktop
rushx start --server https://stg.tracex.co/
```

This uses the same Electron development application profile for both commands.
The selected server is saved locally, and this run does not verify the separate
application IDs, icons, or pinned update channels.
