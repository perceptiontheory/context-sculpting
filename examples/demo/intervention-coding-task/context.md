Authoritative signals:

- the tests under `tests/`
- what `node verify.mjs` expects

Additional context:

- the docs under `../docs/` disagree in places
- `current-spec.md` describes the intended current behavior
- `legacy-migration.md` describes an abandoned migration path that conflicts with the current tests
- `incident-notes.md` explains how the repo ended up in this partially migrated state

Working expectations:

- prefer minimal changes
- do not loosen tests to hide bugs
- keep the CLI surface intact
