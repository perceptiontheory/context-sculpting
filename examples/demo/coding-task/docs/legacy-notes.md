# Legacy Notes

These notes are from an old prototype and are no longer authoritative.

- Task IDs were once derived from slugified titles to make JSON diffs easier to read.
- CSV export used the header `id,title,state`.
- Export rows were sorted alphabetically by title so that spreadsheets looked tidy.

These ideas survived in some code paths during a refactor, but they are not the current contract.
