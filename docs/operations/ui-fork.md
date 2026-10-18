# Blxzzen UI fork

The `blxzzen-ui` branch contains two UI patches: thread details start hidden and open with the existing toggle; floating browser previews start at the top right, drag from their top edge, and resize independently from every edge or corner. Hold Shift while resizing to preserve the current window ratio. Floating browsers cover chat without moving it or the composer. Device previews retain upstream behavior.

`fork-upstream-base` marks the exact source commit of the installed official app. The installer rebuilds only the web UI and preserves the shipped desktop shell, backend, native modules, release connection settings, bundle identifier, and user data. It verifies the archive and local app signature before replacing anything. The installed copy is locally signed rather than signed by T3 Tools. Vendor-bound macOS passkey entitlements cannot be carried into a locally signed fork; browser passkeys that depend on T3 Tools' keychain group remain a limitation of local builds.

## Update after an official app update

Use Node 24 and the repository's pinned pnpm version. From a clean `blxzzen-ui` checkout, run:

```sh
node scripts/update-ui-fork.mjs
```

This reads the installed release's source commit, fetches that exact commit, rebases the two UI patches and fork tooling, installs dependencies, runs the focused tests, lint, and web typecheck, then builds and installs the UI. Relaunch T3 Code to activate it. Official app updates replace the custom UI; rerun this command afterward. The updater preserves normal upstream release updates rather than running an ongoing background patcher.

If a future upstream change conflicts, resolve the rebase and run `git rebase --continue`, then rerun the command. A failed rebase or verification leaves the installed app unchanged. Push the updated branch with `git push --force-with-lease origin blxzzen-ui` when you want to back up a rebased version to GitHub.

## Build, install, or undo

```sh
node scripts/install-ui-fork.mjs stage    # build and verify release/T3 Code (Beta).app
node scripts/install-ui-fork.mjs install  # build, verify, back up, and install
node scripts/install-ui-fork.mjs restore  # restore the untouched official app
```

Each command accepts a different app path as its next argument. Original app backups live in `~/Library/Application Support/BlxzzenT3Fork/backups/`. Relaunch after installing or restoring. These commands never open or modify your conversation database.
