# Incident Notes

The release reporter briefly drifted toward the abandoned migration plan and then was partially reverted.

Known symptoms from that drift:

- some code paths still derive IDs from names
- some CSV output still uses the old `state` header
- some helper logic still assumes sorted output

Current behavior should match the tests and current spec, not the migration note.
