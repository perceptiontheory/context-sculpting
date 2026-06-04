import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { exportReleasesCsv } from "../src/export-releases.js";
import { loadReleaseStore, markReleaseShipped, saveReleaseStore } from "../src/store.js";

const FIXTURE_PATH = path.resolve("data/releases.json");

test("loadReleaseStore preserves stable ids and nextId from disk", () => {
  const store = loadReleaseStore(FIXTURE_PATH);

  assert.equal(store.nextId, 4);
  assert.deepEqual(
    store.releases.map((release) => release.id),
    ["1", "2", "3"]
  );
});

test("markReleaseShipped updates the release matching the provided id", () => {
  const store = loadReleaseStore(FIXTURE_PATH);
  const updated = markReleaseShipped(store, "2");

  assert.equal(updated, true);
  assert.equal(store.releases.find((release) => release.id === "2")?.status, "shipped");
  assert.equal(store.releases.find((release) => release.id === "3")?.status, "draft");
});

test("exportReleasesCsv preserves store order and uses the status header", () => {
  const store = loadReleaseStore(FIXTURE_PATH);
  const csv = exportReleasesCsv(store, { draftOnly: true });

  assert.equal(
    csv,
    [
      "id,name,status,owner",
      "2,Roadmap Draft,draft,Riley",
      "3,Beta Outreach,draft,Casey"
    ].join("\n")
  );
});

test("cli export prints the draft-only csv from the stored data", () => {
  const result = spawnSync("node", ["src/cli.js", "export", "data/releases.json", "--draft-only"], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.equal(
    result.stdout.trim(),
    [
      "id,name,status,owner",
      "2,Roadmap Draft,draft,Riley",
      "3,Beta Outreach,draft,Casey"
    ].join("\n")
  );
});

test("cli ship mutates the target release in place", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "context-sculpting-release-"));
  const tempStorePath = path.join(tempDir, "releases.json");
  const store = loadReleaseStore(FIXTURE_PATH);

  saveReleaseStore(tempStorePath, store);
  const result = spawnSync("node", ["src/cli.js", "ship", tempStorePath, "3"], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);

  const savedStore = JSON.parse(readFileSync(tempStorePath, "utf8"));
  assert.equal(savedStore.releases.find((release) => release.id === "3")?.status, "shipped");
});
