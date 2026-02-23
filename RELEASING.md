# Releasing

Project release workflow (required):

1. Update code.
2. Update `CHANGELOG.md`.
3. Bump `package.json` version.
4. Commit and push to `main`.
5. Create/update git tag: `v<package.json.version>`.
6. Publish/update GitHub Release with notes from matching changelog section.

## Rule

Every future project update must include:
- changelog update
- release update (new version tag/release or release notes update)

## Current release

- `v0.2.0`
- https://github.com/rub1kub/tima-ops-dashboard/releases/tag/v0.2.0
