import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["--test"], {
  cwd: process.cwd(),
  stdio: "inherit"
});

process.exit(result.status ?? 1);
