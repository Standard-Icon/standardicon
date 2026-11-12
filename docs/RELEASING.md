# Releasing

How versions work for The Standard Icon Set, and how to cut a release.

## One version for everything

The version lives in one place: `version` in the root `package.json`. Everything else reads it at build time:

- the `standardicon` npm package (`cli/package.mjs` writes its `package.json` and fills `{{version}}` into its README),
- `/icons.json` on the site,
- `standardicon --version`.

`npm run release -- <version>` changes it, along with the lockfile, any package under `packages/` (such as a future `@standardicon/react`, whose dependencies on our other packages move to the same version), and the changelog. Never edit a version by hand.

## Versioning rules

The set follows [semantic versioning](https://semver.org). An icon's name is its public API: people write it in `add` commands, import paths, URLs and code. So the question for every release is "could this break someone who upgrades?"

### Major (2.0.0)

Anything that can break an existing project.

- An icon is removed.
- An icon is renamed. The old name becomes an alias (see below), but the rename is still major because the old name will stop working at the next major version.
- An alias is removed.
- An icon loses a weight or size it used to come in.
- A redraw changes what an icon means, so it would look wrong where it's already used (a "save" icon that becomes a cloud).
- A breaking CLI change: a command, option or JSON field is removed or changes meaning, or a default changes (such as the default size or output folder).
- The URL layout on the site or the shape of `/icons.json` changes incompatibly.
- The minimum Node version goes up.

### Minor (1.1.0)

New things, nothing broken.

- New icons.
- New aliases or keywords.
- An icon gains weights or sizes, such as new hand-drawn geometry at 24.
- New CLI commands, options or JSON fields.
- A new package, such as `@standardicon/react`.

### Patch (1.0.1)

Fixes that keep every name and meaning.

- A redraw that keeps the name and meaning: pixel fitting, alignment, a cleaner path, better optical balance.
- Moving an icon to a different category. Categories are for browsing, not part of the name.
- CLI bug fixes, and changes to help text or the README.

When a release has several kinds of change, the biggest one wins.

### Aliases

When an icon is renamed, its old name stays as an alias until the next major version, so `add old-name` keeps working and writes the file under the new name. A major release may drop those aliases; its changelog lists each one it drops. Aliases that are just other common names (`external-link` for `pop-out`) aren't deprecated and stay.

### Before 1.0.0

Until launch, every release is an alpha: `0.3.0-alpha.1`, `0.3.0-alpha.2`, then `0.4.0-alpha.1` when the changes call for a new minor version. Nothing is promised before 1.0.0. Alphas publish under the `latest` dist-tag, so a plain `npx standardicon` gets the newest alpha:

    npm publish --tag latest

The first public release, at launch, is 1.0.0. npm never lets a version number be reused, even after it's removed, so don't publish a plain version (such as 0.3.0) until launch.

## The changelog

`CHANGELOG.md` has one section per release, plus an `Unreleased` section at the top that collects changes until the next release. Entries are generated from the icon data, not written by hand. Edit the wording afterwards if a change needs explaining.

`npm run changelog` (`scripts/changelog.mjs`) lists icons that were added, renamed, redrawn, removed or moved, and says which kind of version they call for.

- `npm run changelog` reads the report from the last `npm run sync` (`.sync/report.json`).
- `npm run changelog -- --since v1.0.0` compares `icons/icons.json` at a git tag with the current file. This sees every sync since that release, so it's the one to trust before releasing.
- Add `--write` to either to merge the result into the `Unreleased` section of `CHANGELOG.md`. Merging folds several syncs together: an icon added then removed within one release disappears, and a rename of a rename shows as one rename.

Renames are found two ways: the icon records saw the same Figma component under a new name, or a removed name is now an alias of a new icon. A rename that neither catches shows up as one removal and one addition, so check removals by hand before releasing.

Since each sync replaces `.sync/report.json`, either run `npm run changelog -- --write` after every sync, or run it once with `--since <last tag>` before releasing.

## Cutting a release

1. Sync and review the icons (`npm run sync`).
2. Update the changelog and pick the version:

       npm run changelog -- --since v1.0.0 --write

   It prints the kind of version the changes call for. Read the `Unreleased` section and tidy the wording.

3. Set the version:

       npm run release -- 1.1.0 --dry-run
       npm run release -- 1.1.0

   This updates `package.json`, `package-lock.json`, anything in `packages/`, and dates the `Unreleased` section as `1.1.0 (YYYY-MM-DD)`. It doesn't commit, tag or publish.

4. Check and commit:

       npm test
       npm run build
       git commit -am "Release 1.1.0"

5. Tag and push. The release workflow publishes on a `v*` tag:

       git tag v1.1.0
       git push && git push origin v1.1.0

Until launch, publish every alpha with `--tag latest` (see Before 1.0.0). After launch, prereleases such as `1.1.0-rc.1` publish with `--tag next`.

## What ships in the npm package

Only `cli.mjs`, `icon.mjs`, `icons.json`, `README.md`, `LICENSE` and `package.json`, written by `cli/package.mjs`. A test fails if anything else appears. Font files must never go in: Polymath is licensed for standardicon.com only.

The package README's source is `cli/README.md`. `{{count}}` and `{{version}}` are filled in at build time.

## Still to decide

- `REPOSITORY` in `cli/package.mjs` is `null` until the public GitHub repo exists. Setting it adds `repository` and `bugs` to the package, and npm trusted publishing needs `repository` to match the repo that publishes.
