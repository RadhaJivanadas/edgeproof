import fs from "node:fs";

const required = [
  "README.md",
  "SUBMISSION.md",
  "render.yaml",
  "server.js",
  "public/index.html",
  "data/demo-replay.json",
  "data/replay-meta.json",
];

let failed = false;
for (const file of required) {
  if (!fs.existsSync(file)) {
    console.error(`Missing required file: ${file}`);
    failed = true;
  }
}

const meta = JSON.parse(fs.readFileSync("data/replay-meta.json", "utf8"));
if (meta.synthetic) {
  console.warn("WARNING: replay-meta.json is still synthetic. Capture real TxLINE historical data before final submission when possible.");
} else {
  console.log(`TxLINE replay provenance: ${meta.fixture?.home} vs ${meta.fixture?.away}, generated ${meta.generatedAt}`);
}

const submission = fs.readFileSync("SUBMISSION.md", "utf8");
for (const placeholder of ["<LIVE_URL>", "<GITHUB_URL>", "<VIDEO_URL>"]) {
  if (submission.includes(placeholder)) console.warn(`Submission placeholder remains: ${placeholder}`);
}

if (failed) process.exit(1);
console.log("Preflight file checks passed.");
