# Releasing ClutchCode to npm

Everything mechanical is verified and automated. What remains needs a human
with an npm account — Claude cannot create an npm organisation, hold
credentials, or publish, and publishing is effectively irreversible (npm's
unpublish policy is narrow, so a name and version, once public, are taken).

## What is already proven

Verified locally, offline, without publishing anything:

- **Lockstep versioning** — all 11 publishable manifests are at the same
  version; `clutchcode-vscode` is `private: true`, so it is excluded
  structurally rather than by remembering to skip it.
- **`workspace:*` is rewritten by packing** — `pnpm pack` on
  `@clutchcode/cli` produces a tarball whose manifest carries
  `"@clutchcode/agent-api": "0.1.0"`, pinned, with zero unrewritten specs.
- **The packed artifacts run standalone** — all 11 tarballs installed into a
  clean directory as `file:` dependencies, with no repo on the path. npm's
  generated `.bin/clutchcode` shim runs: `--help` renders, and `doctor` exits
  0 while exercising sandbox, keychain and toolchain detection across ten
  packages.
- **Dependency surface** — exactly `ajv`, `commander`, `smol-toml`.

## Why pack-then-publish, rather than `pnpm publish -r`

The two tools each do half the job and neither does both:

- **`pnpm`** rewrites `workspace:*` into real versions. `npm` does not.
- **`npm`** speaks OIDC trusted publishing and `--provenance`. `pnpm publish`
  exposes no OIDC, provenance or trusted-publishing flags at all.

So `.github/workflows/release.yml` packs with `pnpm` and publishes the
resulting tarballs with `npm`. The tarball is the handoff. The workflow also
**fails the release** if any packed manifest still contains a `workspace:`
spec, rather than shipping something npm could not install.

## One-time setup (you must do this)

1. **Create the `@clutchcode` organisation** on npmjs.com with an account you
   control.
2. **Configure a trusted publisher** for each package, on npm, pointing at:
   - repository: `Derric01/ClutchCode`
   - workflow: `.github/workflows/release.yml`
   - environment: *(leave blank unless you add one)*

   This is what lets the workflow authenticate with **no stored token**. There
   is deliberately no `NPM_TOKEN` secret in this repo.

## Releasing

1. Run the **Release** workflow from the Actions tab with `dry_run` **true**
   (the default). It runs the full build/test/lint gate, packs, checks for
   surviving `workspace:` specs, then does `npm publish --dry-run` on each
   tarball. Nothing is published.
2. Read the dry-run output. Confirm the package list and versions are what you
   intend.
3. Re-run with `dry_run` **false** to publish for real.
4. Verify from a clean machine: `npx clutchcode@latest --help`.

There is **no tag or push trigger** by design. A release should be a
deliberate act, and a workflow that can publish by accident is a worse failure
than one that needs a button.

## Not verified

The workflow itself has **never run**. OIDC trusted publishing, the
`npm@^11.5.1` floor it needs, and provenance attestation are written against
npm's documented behaviour and cannot be exercised without a real npm
organisation and a real publish. Treat the first `dry_run` as the test of this
file, not as a formality.
