import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TxLineClient } from "../src/txline-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputPath = path.resolve(root, process.env.REPLAY_FILE || "data/txline-replay.json");
const metaPath = path.resolve(root, process.env.REPLAY_META_FILE || "data/replay-meta.json");
const fixtureId = Number(process.env.TXLINE_FIXTURE_ID);
const apiToken = process.env.TXLINE_API_TOKEN;

if (!Number.isInteger(fixtureId) || fixtureId < 1) {
  throw new Error("TXLINE_FIXTURE_ID must be a positive integer");
}
if (!apiToken) {
  throw new Error("TXLINE_API_TOKEN is required. Activate the free World Cup tier first.");
}

const client = new TxLineClient({
  baseUrl: process.env.TXLINE_BASE_URL,
  jwt: process.env.TXLINE_JWT,
  apiToken,
  fixtureId,
});

const unwrap = (value) => {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "items", "results", "updates", "fixtures"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return value ? [value] : [];
};

const tsOf = (row) => {
  const raw = Number(row?.Ts ?? row?.ts ?? row?.Timestamp ?? row?.timestamp ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
};

const fixtureOf = (row) => Number(row?.FixtureId ?? row?.fixtureId ?? 0);
const messageIdOf = (row) => String(row?.MessageId ?? row?.messageId ?? "");
const seqOf = (row) => Number(row?.Seq ?? row?.seq ?? 0);
const actionOf = (row) => String(row?.action ?? row?.Action ?? "").toLowerCase();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function bucketFor(timestamp) {
  const date = new Date(timestamp);
  return {
    epochDay: Math.floor(timestamp / 86_400_000),
    hour: date.getUTCHours(),
    interval: Math.floor(date.getUTCMinutes() / 5),
  };
}

function uniqueBy(rows, keyFn) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = keyFn(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function proofSummary(kind, raw, record) {
  const rootValue = kind === "odds"
    ? raw?.summary?.oddsSubTreeRoot
    : raw?.summary?.eventStatsSubTreeRoot;
  return {
    id: `${kind}-proof-${kind === "odds" ? messageIdOf(record) : seqOf(record)}`,
    messageId: kind === "odds" ? messageIdOf(record) : undefined,
    scoreSeq: kind === "score" ? seqOf(record) : undefined,
    fixtureId,
    status: "available",
    network: client.baseUrl.includes("dev") ? "Solana devnet" : "Solana mainnet",
    root: rootValue || "returned by TxLINE",
    proofNodes: (raw?.subTreeProof?.length || 0) + (raw?.mainTreeProof?.length || 0),
    statKeys: kind === "score" ? [1, 2] : undefined,
    capturedFromTxline: true,
  };
}

await client.refreshJwt();

const [fixturePayload, historicalPayload] = await Promise.all([
  client.fixtures(),
  client.scoresHistorical(fixtureId),
]);

const fixture = unwrap(fixturePayload).find((row) => fixtureOf(row) === fixtureId) || {};
const scores = uniqueBy(
  unwrap(historicalPayload)
    .filter((row) => fixtureOf(row) === fixtureId && tsOf(row) > 0)
    .sort((a, b) => tsOf(a) - tsOf(b)),
  (row) => seqOf(row) || `${tsOf(row)}:${actionOf(row)}`,
);

if (!scores.length) {
  throw new Error("No historical score records returned. TxLINE historical scores are available only for eligible completed fixtures.");
}

const minTs = tsOf(scores[0]);
const maxTs = tsOf(scores.at(-1));
const bucketStarts = [];
for (let ts = Math.floor(minTs / 300_000) * 300_000; ts <= maxTs + 300_000; ts += 300_000) {
  bucketStarts.push(ts);
  if (bucketStarts.length > 48) break;
}

const oddsRows = [];
for (const timestamp of bucketStarts) {
  const { epochDay, hour, interval } = bucketFor(timestamp);
  try {
    const payload = await client.oddsUpdates(epochDay, hour, interval);
    oddsRows.push(...unwrap(payload).filter((row) => fixtureOf(row) === fixtureId));
  } catch (error) {
    console.warn(`Skipping odds bucket ${epochDay}/${hour}/${interval}: ${error.message}`);
  }
}

const odds = uniqueBy(
  oddsRows.filter((row) => tsOf(row) > 0).sort((a, b) => tsOf(a) - tsOf(b)),
  (row) => messageIdOf(row) || `${tsOf(row)}:${JSON.stringify(row?.Pct ?? row?.pct ?? [])}`,
);

if (!odds.length) {
  throw new Error("No historical odds records found for this fixture. Choose another recently completed covered fixture.");
}

const merged = [
  ...scores.map((data) => ({ type: "score", ts: tsOf(data), data })),
  ...odds.map((data) => ({ type: "odds", ts: tsOf(data), data })),
].sort((a, b) => a.ts - b.ts || (a.type === "score" ? -1 : 1));

const timeline = merged.map((item, index) => {
  const previousTs = index ? merged[index - 1].ts : item.ts;
  const matchDeltaMinutes = Math.max(0, item.ts - previousTs) / 60_000;
  return {
    type: item.type,
    delayMs: index === 0 ? 200 : Math.round(clamp(matchDeltaMinutes * 170, 90, 1200)),
    data: item.data,
  };
});

const proofCandidates = [];
const finalScore = [...scores].reverse().find((row) => actionOf(row) === "game_finalised" || Number(row?.statusId ?? row?.StatusId) === 100);
const finalOdds = odds.at(-1);

if (finalOdds && messageIdOf(finalOdds)) {
  try {
    const raw = await client.oddsProof(messageIdOf(finalOdds), tsOf(finalOdds));
    proofCandidates.push({ type: "proof", delayMs: 300, data: proofSummary("odds", raw, finalOdds) });
  } catch (error) {
    console.warn(`Odds proof capture skipped: ${error.message}`);
  }
}

if (finalScore && seqOf(finalScore) > 0) {
  try {
    const raw = await client.scoreProof(fixtureId, seqOf(finalScore), "1,2");
    proofCandidates.push({ type: "proof", delayMs: 300, data: proofSummary("score", raw, finalScore) });
  } catch (error) {
    console.warn(`Score proof capture skipped: ${error.message}`);
  }
}

timeline.push(...proofCandidates);

const participant1 = fixture.Participant1 ?? fixture.participant1 ?? process.env.HOME_TEAM ?? "Participant 1";
const participant2 = fixture.Participant2 ?? fixture.participant2 ?? process.env.AWAY_TEAM ?? "Participant 2";
const p1IsHome = fixture.Participant1IsHome ?? fixture.participant1IsHome ?? true;
const home = p1IsHome ? participant1 : participant2;
const away = p1IsHome ? participant2 : participant1;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(timeline, null, 2)}\n`);
fs.writeFileSync(metaPath, `${JSON.stringify({
  source: "txline-historical",
  synthetic: false,
  generatedAt: new Date().toISOString(),
  baseUrl: client.baseUrl,
  fixture: {
    id: fixtureId,
    home,
    away,
    competition: fixture.CompetitionName ?? fixture.competitionName ?? process.env.COMPETITION_NAME ?? "TxLINE covered fixture",
    startTime: fixture.StartTime ?? fixture.startTime ?? new Date(minTs).toISOString(),
  },
  records: { scores: scores.length, odds: odds.length, proofs: proofCandidates.length },
  note: "Captured from TxLINE authenticated historical endpoints; credentials are not stored.",
}, null, 2)}\n`);

console.log(`Wrote ${timeline.length} replay events to ${path.relative(root, outputPath)}`);
console.log(`Wrote provenance to ${path.relative(root, metaPath)}`);
console.log(`Fixture: ${home} vs ${away}; ${scores.length} scores, ${odds.length} odds, ${proofCandidates.length} proofs`);
