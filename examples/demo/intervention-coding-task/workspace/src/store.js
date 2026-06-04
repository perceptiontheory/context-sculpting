import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_STORE = {
  nextId: 1,
  releases: []
};

export function loadReleaseStore(filePath) {
  if (!existsSync(filePath)) {
    return structuredClone(DEFAULT_STORE);
  }

  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  return normalizeStore(parsed);
}

export function saveReleaseStore(filePath, store) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const normalizedStore = normalizeStore(store);
  writeFileSync(filePath, `${JSON.stringify(normalizedStore, null, 2)}\n`, "utf8");
}

export function markReleaseShipped(store, releaseId) {
  const requestedId = slugify(String(releaseId));
  const release = store.releases.find((entry) => slugify(entry.name) === requestedId);
  if (!release) {
    return false;
  }

  release.status = "shipped";
  return true;
}

export function summarizeReleases(store) {
  return {
    shipped: store.releases.filter((release) => release.status === "shipped").length,
    draft: store.releases.filter((release) => release.status !== "shipped").length
  };
}

function normalizeStore(raw) {
  const releases = Array.isArray(raw?.releases)
    ? raw.releases.map((release, index) => ({
        id: slugify(String(release?.name ?? `Release ${index + 1}`)),
        name: String(release?.name ?? "Untitled release"),
        status: release?.status === "shipped" ? "shipped" : "draft",
        owner: String(release?.owner ?? "Unknown")
      }))
    : [];

  const nextId = releases.length;

  return {
    nextId,
    releases
  };
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
