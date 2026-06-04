import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const targetPath = path.resolve("answer/final_answer.md");

if (!existsSync(targetPath)) {
  console.error("Missing answer/final_answer.md");
  process.exit(1);
}

const contents = readFileSync(targetPath, "utf8");

const requiredSnippets = [
  "# Answer",
  "Company: Harbor Grid",
  "## Evidence",
  "## Explanation"
];

for (const snippet of requiredSnippets) {
  if (!contents.includes(snippet)) {
    console.error(`Missing required snippet: ${snippet}`);
    process.exit(1);
  }
}

const evidenceVariants = [
  ["- 01_meridian_stack.md", "- docs/01_meridian_stack.md"],
  ["- 02_mara_chen_profile.md", "- docs/02_mara_chen_profile.md"],
  ["- 03_threadline_acquisition.md", "- docs/03_threadline_acquisition.md"]
];

for (const variants of evidenceVariants) {
  if (!variants.some((snippet) => contents.includes(snippet))) {
    console.error(`Missing required evidence filename: ${variants[0]}`);
    process.exit(1);
  }
}

process.exit(0);
