import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const answerPath = path.resolve("answer/final_answer.md");

if (!existsSync(answerPath)) {
  console.error("Missing answer/final_answer.md");
  process.exit(1);
}

const content = readFileSync(answerPath, "utf8");
const requiredSnippets = [
  "# Answer",
  "Company: Aperture Fleet",
  "## Evidence",
  "01_northwind_dispatch.md",
  "02_rook_profile.md",
  "03_signalstep_acquisition.md",
  "## Explanation"
];

for (const snippet of requiredSnippets) {
  if (!content.includes(snippet)) {
    console.error(`Missing required snippet: ${snippet}`);
    process.exit(1);
  }
}

process.stdout.write("Verification passed.\n");
