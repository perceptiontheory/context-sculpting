import { summarizeReleases } from "./store.js";

export function renderSummary(store) {
  const counts = summarizeReleases(store);
  return `draft=${counts.draft} shipped=${counts.shipped}`;
}
