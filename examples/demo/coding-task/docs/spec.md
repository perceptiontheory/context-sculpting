# Task Manager Spec

This workspace contains a tiny file-backed task manager with three supported flows:

- mark a task as completed by ID
- export tasks as CSV
- preserve stable task IDs across loads and saves

## Canonical Store Shape

```json
{
  "nextId": 4,
  "tasks": [
    { "id": "1", "title": "Book venue", "status": "done" },
    { "id": "2", "title": "Draft agenda", "status": "pending" },
    { "id": "3", "title": "Send invites", "status": "pending" }
  ]
}
```

Rules:

1. `id` is a stable string identifier. It is not derived from `title`.
2. `nextId` should remain numeric and should be preserved from disk when valid.
3. `status` is either `pending` or `done`.

## Completion Behavior

- Completing a task must target the task with the matching `id`.
- If the ID is not found, the operation should report failure without mutating unrelated tasks.

## CSV Export Behavior

- CSV header must be exactly: `id,title,status`
- Export should preserve the current task order from the store.
- When `pendingOnly` is true, exclude completed tasks.
- The exported status column must be named `status`, not `state`.

## CLI Expectations

From the workspace root:

- `node src/cli.js export data/tasks.json --pending`

should print the pending-task CSV described above.
