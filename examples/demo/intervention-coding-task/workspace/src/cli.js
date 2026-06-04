import path from "node:path";
import { exportReleasesCsv } from "./export-releases.js";
import { renderSummary } from "./summary.js";
import { loadReleaseStore, markReleaseShipped, saveReleaseStore } from "./store.js";

function main(argv) {
  const [command, fileArg, ...rest] = argv;

  if (!command || !fileArg) {
    throw new Error("Usage: node src/cli.js <ship|export|summary> <store-file> [args]");
  }

  const filePath = path.resolve(process.cwd(), fileArg);
  const store = loadReleaseStore(filePath);

  if (command === "ship") {
    const releaseId = rest[0];
    if (!releaseId) {
      throw new Error("The ship command requires a release ID.");
    }

    const updated = markReleaseShipped(store, releaseId);
    if (!updated) {
      process.stdout.write(`Release ${releaseId} not found.\n`);
      process.exitCode = 1;
      return;
    }

    saveReleaseStore(filePath, store);
    process.stdout.write(`Shipped release ${releaseId}.\n`);
    return;
  }

  if (command === "export") {
    const draftOnly = rest.includes("--draft-only");
    process.stdout.write(`${exportReleasesCsv(store, { draftOnly })}\n`);
    return;
  }

  if (command === "summary") {
    process.stdout.write(`${renderSummary(store)}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main(process.argv.slice(2));
