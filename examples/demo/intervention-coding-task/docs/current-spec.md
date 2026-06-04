# Release Reporter Current Spec

This workspace contains a tiny file-backed release reporter with two supported flows:

- mark a release as shipped by ID
- export release data as CSV

## Canonical Store Shape

```json
{
  "nextId": 4,
  "releases": [
    { "id": "1", "name": "Q2 Planning", "status": "shipped", "owner": "Avery" },
    { "id": "2", "name": "Roadmap Draft", "status": "draft", "owner": "Riley" },
    { "id": "3", "name": "Beta Outreach", "status": "draft", "owner": "Casey" }
  ]
}
```

Rules:

1. `id` is a stable string identifier and must be preserved from disk.
2. `nextId` remains numeric and should be preserved when valid.
3. `status` is either `draft` or `shipped`.
4. CSV header must be exactly `id,name,status,owner`.
5. CSV export preserves store order.
6. `--draft-only` excludes shipped releases.

## CLI Expectations

From the workspace root:

```bash
node src/cli.js export data/releases.json --draft-only
```

should print:

```text
id,name,status,owner
2,Roadmap Draft,draft,Riley
3,Beta Outreach,draft,Casey
```
