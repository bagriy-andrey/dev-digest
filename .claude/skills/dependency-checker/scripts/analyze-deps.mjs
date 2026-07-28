#!/usr/bin/env node
// Deterministic data-gathering for the dependency-checker skill: per-package on-disk sizes
// (direct deps only — transitive weight is already folded into the top-level dir via hoisting)
// and cross-package version drift. No npm registry calls — everything reads the local checkout.
//
// Usage: node analyze-deps.mjs <pkg-dir> [<pkg-dir> ...]
// Output: JSON on stdout — { packages: [...], drift: [...] }

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("usage: node analyze-deps.mjs <pkg-dir> [<pkg-dir> ...]");
  process.exit(1);
}

function duBytes(path) {
  if (!existsSync(path)) return 0;
  try {
    // -sk: total size in KB, portable across macOS/Linux du.
    const out = execSync(`du -sk "${path}"`, { encoding: "utf8" });
    return parseInt(out.split("\t")[0], 10) * 1024;
  } catch {
    return 0;
  }
}

function humanSize(bytes) {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${bytes}B`;
}

const versionMap = new Map(); // depName -> [{ pkg, version }]
const packages = [];

for (const dir of dirs) {
  const pkgJsonPath = join(dir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    console.error(`skip ${dir}: no package.json`);
    continue;
  }
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const name = pkgJson.name ?? basename(dir);
  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  const nodeModules = join(dir, "node_modules");

  const depSizes = [];
  for (const [depName, declaredRange] of Object.entries(deps)) {
    const depPath = join(nodeModules, ...depName.split("/")); // handles @scope/name
    const bytes = duBytes(depPath);
    depSizes.push({ name: depName, declaredRange, bytes, human: humanSize(bytes) });

    let installedVersion = declaredRange;
    const depPkgJson = join(depPath, "package.json");
    if (existsSync(depPkgJson)) {
      try {
        installedVersion = JSON.parse(readFileSync(depPkgJson, "utf8")).version ?? declaredRange;
      } catch {
        /* keep declaredRange */
      }
    }
    const bucket = versionMap.get(depName) ?? [];
    bucket.push({ pkg: name, version: installedVersion });
    versionMap.set(depName, bucket);
  }

  depSizes.sort((a, b) => b.bytes - a.bytes);
  const totalBytes = existsSync(nodeModules)
    ? readdirSync(nodeModules)
        .filter((d) => !d.startsWith("."))
        .reduce((sum, d) => sum + duBytes(join(nodeModules, d)), 0)
    : 0;

  packages.push({
    package: name,
    dir,
    directDepCount: Object.keys(pkgJson.dependencies ?? {}).length,
    directDevDepCount: Object.keys(pkgJson.devDependencies ?? {}).length,
    nodeModulesTotalBytes: totalBytes,
    nodeModulesTotalHuman: humanSize(totalBytes),
    heaviestDeps: depSizes.slice(0, 10),
  });
}

const drift = [...versionMap.entries()]
  .map(([name, entries]) => ({ name, entries, distinctVersions: new Set(entries.map((e) => e.version)).size }))
  .filter((d) => d.distinctVersions > 1);

console.log(JSON.stringify({ packages, drift }, null, 2));