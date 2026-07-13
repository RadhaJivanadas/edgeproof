import fs from "node:fs";
import path from "node:path";

const required = [
  "README.md",
  "LICENSE",
  "render.yaml",
  "server.js",
  "package.json",
  "public/index.html",
  "data/demo-replay.json",
  "data/replay-meta.json",
];

let failed = false;

function fail(message) {
  console.error(`ERROR: ${message}`);
  failed = true;
}

for (const file of required) {
  if (!fs.existsSync(file)) fail(`Missing required file: ${file}`);
}

if (fs.existsSync("data/replay-meta.json")) {
  try {
    const meta = JSON.parse(fs.readFileSync("data/replay-meta.json", "utf8"));
    if (!meta.source) fail("data/replay-meta.json must declare a source");

    if (meta.synthetic) {
      console.warn(
        "WARNING: replay is synthetic. Capture a TxLINE historical replay before final judging when possible.",
      );
    } else {
      console.log(
        `TxLINE replay provenance: ${meta.fixture?.home ?? "?"} vs ${meta.fixture?.away ?? "?"}, generated ${meta.generatedAt ?? "unknown"}`,
      );
    }
  } catch (error) {
    fail(`Invalid data/replay-meta.json: ${error.message}`);
  }
}

if (fs.existsSync("render.yaml")) {
  const renderConfig = fs.readFileSync("render.yaml", "utf8");
  for (const requiredText of ["type: web", "npm start", "/api/health"]) {
    if (!renderConfig.includes(requiredText)) {
      fail(`render.yaml is missing expected configuration: ${requiredText}`);
    }
  }
}

if (fs.existsSync("README.md")) {
  const readme = fs.readFileSync("README.md", "utf8");
  for (const requiredText of ["TxLINE", "npm start", "npm test"]) {
    if (!readme.includes(requiredText)) fail(`README.md is missing: ${requiredText}`);
  }
}

const excludedDirectories = new Set([".git", "node_modules"]);
const textExtensions = new Set([
  ".js",
  ".json",
  ".md",
  ".yaml",
  ".yml",
  ".html",
  ".css",
  ".txt",
]);
const secretPatterns = [
  { name: "committed TxLINE API token", regex: /TXLINE_API_TOKEN\s*=\s*["']?(?!<|\.\.\.|your-|example|$)[A-Za-z0-9_-]{20,}/i },
  { name: "private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "seed phrase assignment", regex: /(?:seed|mnemonic)(?:_phrase)?\s*[:=]\s*["'][a-z]+(?:\s+[a-z]+){11,23}["']/i },
];

function scanDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excludedDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      scanDirectory(fullPath);
      continue;
    }

    if (!textExtensions.has(path.extname(entry.name))) continue;
    const contents = fs.readFileSync(fullPath, "utf8");
    for (const pattern of secretPatterns) {
      if (pattern.regex.test(contents)) fail(`${pattern.name} detected in ${fullPath}`);
    }
  }
}

scanDirectory(".");

if (failed) process.exit(1);
console.log("Preflight product, deployment, provenance, and secret checks passed.");
