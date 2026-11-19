#!/usr/bin/env node
// Bumps package.json version (plain semver, no zero-padding). Used by .githooks/pre-push.
import { readFileSync, writeFileSync } from "node:fs";

const bumpType = process.argv[2];
if (!["major", "minor", "patch"].includes(bumpType)) {
  console.error("usage: bump-version.mjs <major|minor|patch>");
  process.exit(1);
}

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
let [major, minor, patch] = pkg.version.split(".").map(Number);

if (bumpType === "major") {
  major++;
  minor = 0;
  patch = 0;
} else if (bumpType === "minor") {
  minor++;
  patch = 0;
} else {
  patch++;
}

pkg.version = `${major}.${minor}.${patch}`;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(pkg.version);
