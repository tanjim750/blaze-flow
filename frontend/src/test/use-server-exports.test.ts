import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `"use server"` module may only export async functions. Exporting anything else
 * (an object, a constant) makes Next refuse to load the module at runtime, and every
 * server action in it then fails — which is how the review actions all broke at once.
 * Type-only exports are erased at compile time, so they are allowed.
 */
const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const serverModules = sourceFiles(SRC).filter((path) => /^\s*["']use server["']/.test(readFileSync(path, "utf8")));

describe('"use server" modules', () => {
  it("are found", () => {
    expect(serverModules.length).toBeGreaterThan(0);
  });

  it.each(serverModules.map((path) => [relative(SRC, path), path]))("%s exports only async functions", (_name, path) => {
    const offending = readFileSync(path, "utf8")
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => line.startsWith("export "))
      .filter(({ line }) => !/^export\s+(async\s+function|type\s|interface\s)/.test(line))
      .map(({ line, number }) => `${number}: ${line}`);
    expect(offending).toEqual([]);
  });
});
