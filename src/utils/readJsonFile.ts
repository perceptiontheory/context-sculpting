import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const absolutePath = path.resolve(filePath);
  const contents = await readFile(absolutePath, "utf8");

  try {
    return JSON.parse(contents) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${absolutePath}: ${message}`);
  }
}
