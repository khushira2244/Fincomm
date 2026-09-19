#!/usr/bin/env node
// Uploads the built Vite frontend (dist/) into this Convex deployment's
// own File Storage and records path -> storageId mappings via
// convex/staticSite.ts, so convex/http.ts's catch-all HTTP Action can
// serve it from this project's own *.convex.site domain. Convex has no
// built-in static-hosting product, so this script + those two files
// together are a real, from-scratch implementation of one.
//
// Usage:
//   npm run build && node scripts/deploy-static-site.mjs         # dev
//   npm run build && node scripts/deploy-static-site.mjs --prod  # prod
//
// Convex-side calls go through `npx convex run`, which uses this
// machine's already-authenticated CLI session (admin rights), rather
// than trying to grant a script admin auth via the public client SDK.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIST_DIR = "dist";
const prod = process.argv.includes("--prod");
const deployFlag = prod ? ["--prod"] : [];

// Invoke convex's CLI entry point directly with node + an argv array
// (shell: false) instead of going through `npx`/`convex` .cmd shims on
// Windows: each of those is a batch file that re-tokenizes its
// arguments through cmd.exe, and that re-tokenization silently mangled
// embedded double quotes in JSON args containing spaces/semicolons
// (e.g. a "text/javascript; charset=utf-8" content type). Calling
// node.exe directly with a real argv array sidesteps that entirely.
const convexCli = fileURLToPath(new URL("../node_modules/convex/bin/main.js", import.meta.url));

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8",
};

function convexRun(fn, args) {
  const out = execFileSync(
    process.execPath,
    [convexCli, "run", ...deployFlag, fn, JSON.stringify(args)],
    { encoding: "utf8" },
  ).trim();
  // `convex run` prints nothing at all for a function that returns
  // null/undefined (e.g. recordAsset), rather than printing "null".
  return out === "" ? null : JSON.parse(out);
}

function walk(dir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(walk(full));
    else files.push(full);
  }
  return files;
}

if (!existsSync(DIST_DIR)) {
  console.error(`No ${DIST_DIR}/ directory found — run "npm run build" first.`);
  process.exit(1);
}

const files = walk(DIST_DIR);
if (files.length === 0) {
  console.error(`${DIST_DIR}/ is empty — run "npm run build" first.`);
  process.exit(1);
}

console.log(`Deploying ${files.length} file(s) to ${prod ? "PRODUCTION" : "dev"}...`);

const uploadedPaths = [];

for (const file of files) {
  const relPath = "/" + relative(DIST_DIR, file).split(sep).join("/");
  const contentType = CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
  const bytes = readFileSync(file);

  const uploadUrl = convexRun("staticSite:generateUploadUrl", {});
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: bytes,
  });
  if (!uploadRes.ok) {
    throw new Error(`Upload failed for ${relPath}: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  const { storageId } = await uploadRes.json();

  convexRun("staticSite:recordAsset", { path: relPath, storageId, contentType });
  uploadedPaths.push(relPath);
  console.log(`  uploaded ${relPath}`);
}

const removed = convexRun("staticSite:pruneAssetsNotIn", { keepPaths: uploadedPaths });
if (removed > 0) console.log(`Pruned ${removed} stale asset(s).`);

console.log(`Done. ${uploadedPaths.length} file(s) live on ${prod ? "production" : "dev"}.`);
