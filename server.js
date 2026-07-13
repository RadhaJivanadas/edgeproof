import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentEngine, normalizeOdds, normalizeScore } from "./src/agent.js";
import { ReplayController } from "./src/replay.js";
import { TxLineClient } from "./src/txline-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const dataMode = String(process.env.DATA_MODE || "demo").toLowerCase();
const replayFile = path.resolve(__dirname, process.env.REPLAY_FILE || "data/demo-replay.json");
const replayMetaFile = path.resolve(__dirname, process.env.REPLAY_META_FILE || "data/replay-meta.json");
let replayMeta = { source: "synthetic", synthetic: true, fixture: {} };
try { replayMeta = JSON.parse(fs.readFileSync(replayMetaFile, "utf8")); } catch {}

const engine = new AgentEngine({
  bankroll: process.env.STARTING_BANKROLL || 10000,
  maxKellyFraction: process.env.MAX_KELLY_FRACTION || 0.03,
  minEdge: process.env.MIN_EDGE || 0.035,
  minConfidence: process.env.MIN_CONFIDENCE || 0.68,
});

const clients = new Set();
const system = {
  mode: dataMode,
  status: dataMode === "demo" ? "ready" : "connecting",
  fixture: {
    id: Number(process.env.TXLINE_FIXTURE_ID || replayMeta.fixture?.id || 18209181),
    home: process.env.HOME_TEAM || replayMeta.fixture?.home || (dataMode === "demo" ? "France" : "Home"),
    away: process.env.AWAY_TEAM || replayMeta.fixture?.away || (dataMode === "demo" ? "Morocco" : "Away"),
    competition: process.env.COMPETITION_NAME || replayMeta.fixture?.competition || "World Cup 2026",
  },
  stream: {},
  error: null,
  syntheticDemo: dataMode === "demo" && replayMeta.synthetic !== false,
  replaySource: dataMode === "demo" ? (replayMeta.source || "synthetic") : null,
  replayGeneratedAt: dataMode === "demo" ? (replayMeta.generatedAt || null) : null,
  txlineBaseUrl: dataMode === "txline" ? String(process.env.TXLINE_BASE_URL || "https://txline.txodds.com") : (replayMeta.baseUrl || null),
};

function fullState() {
  return {
    ...engine.snapshot(),
    system: { ...system },
    replay: replay?.status?.() || null,
    serverTime: Date.now(),
  };
}

function sendEvent(type, payload = fullState()) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const response of clients) response.write(frame);
}

async function tryOddsProof(odds) {
  if (!txline) return null;
  try {
    const raw = await txline.oddsProof(odds.messageId, odds.ts);
    return {
      id: `odds-proof-${odds.messageId}`,
      messageId: odds.messageId,
      fixtureId: odds.fixtureId,
      status: "available",
      network: txline.baseUrl.includes("dev") ? "Solana devnet" : "Solana mainnet",
      root: raw?.summary?.oddsSubTreeRoot || "returned by TxLINE",
      proofNodes: (raw?.subTreeProof?.length || 0) + (raw?.mainTreeProof?.length || 0),
      raw,
    };
  } catch (error) {
    return { id: `odds-proof-${odds.messageId}`, messageId: odds.messageId, status: "error", error: error.message };
  }
}

async function tryScoreProof(score) {
  if (!txline || !score.seq) return null;
  try {
    const raw = await txline.scoreProof(score.fixtureId, score.seq, "1,2");
    return {
      id: `score-proof-${score.fixtureId}-${score.seq}`,
      scoreSeq: score.seq,
      fixtureId: score.fixtureId,
      status: "available",
      network: txline.baseUrl.includes("dev") ? "Solana devnet" : "Solana mainnet",
      root: raw?.summary?.eventStatsSubTreeRoot || "returned by TxLINE",
      proofNodes: (raw?.subTreeProof?.length || 0) + (raw?.mainTreeProof?.length || 0),
      statKeys: [1, 2],
      raw,
    };
  } catch (error) {
    return { id: `score-proof-${score.fixtureId}-${score.seq}`, scoreSeq: score.seq, status: "error", error: error.message };
  }
}

async function ingestOdds(raw, requestProof = false) {
  const rows = Array.isArray(raw) ? raw : [raw];
  for (const row of rows) {
    const odds = normalizeOdds(row);
    if (odds.fixtureId && odds.fixtureId !== system.fixture.id) continue;
    const isResultMarket = /result|moneyline|1x2|match/i.test(odds.market) && odds.probabilities.length >= 3;
    if (!isResultMarket) continue;
    const proof = requestProof ? await tryOddsProof(odds) : null;
    engine.ingestOdds(odds, proof);
    sendEvent("state");
  }
}

async function ingestScore(raw, requestProof = false) {
  const rows = Array.isArray(raw) ? raw : [raw];
  for (const row of rows) {
    const score = normalizeScore(row);
    if (score.fixtureId && score.fixtureId !== system.fixture.id) continue;
    const proof = requestProof && (score.action === "game_finalised" || score.action === "halftime_finalised")
      ? await tryScoreProof(score)
      : null;
    engine.ingestScore(score, proof);
    sendEvent("state");
  }
}

let replay = null;
let txline = null;

if (dataMode === "demo") {
  replay = new ReplayController(replayFile, {
    onEvent: async (item) => {
      if (item.type === "odds") await ingestOdds(item.data);
      if (item.type === "score") await ingestScore(item.data);
      if (item.type === "proof") {
        engine.addProof(item.data);
        sendEvent("state");
      }
    },
    onReset: () => {
      engine.reset();
      system.status = "ready";
      sendEvent("state");
    },
    onStatus: () => sendEvent("state"),
    onEnd: () => {
      system.status = "replay complete";
      sendEvent("state");
    },
  });
  setTimeout(() => replay.start(), 600);
} else {
  txline = new TxLineClient({
    baseUrl: process.env.TXLINE_BASE_URL,
    jwt: process.env.TXLINE_JWT,
    apiToken: process.env.TXLINE_API_TOKEN,
    fixtureId: system.fixture.id,
  });
  txline.start({
    onOdds: (row) => ingestOdds(row, true),
    onScore: (row) => ingestScore(row, true),
    onStatus: (entry) => {
      system.stream[entry.path] = entry;
      system.status = Object.values(system.stream).some((s) => s.status === "connected") ? "live" : "connecting";
      if (entry.error) system.error = entry.error;
      sendEvent("system", system);
    },
  }).catch((error) => {
    system.status = "error";
    system.error = error.message;
    sendEvent("system", system);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  }[ext] || "application/octet-stream";
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  if (!body) return {};
  try { return JSON.parse(body); } catch { return {}; }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/api/health") return json(response, 200, { ok: true, mode: dataMode, status: system.status });
  if (url.pathname === "/api/state") return json(response, 200, fullState());

  if (url.pathname === "/api/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(`event: state\ndata: ${JSON.stringify(fullState())}\n\n`);
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  if (url.pathname.startsWith("/api/replay/") && dataMode === "demo") {
    const action = url.pathname.split("/").pop();
    const payload = await readJson(request);
    if (action === "start") replay.start();
    if (action === "pause") replay.pause();
    if (action === "reset") replay.reset();
    if (action === "speed") replay.setSpeed(payload.speed);
    sendEvent("state");
    return json(response, 200, fullState());
  }

  if (url.pathname === "/api/txline/proof" && txline) {
    try {
      const proof = await txline.oddsProof(url.searchParams.get("messageId"), url.searchParams.get("ts"));
      return json(response, 200, proof);
    } catch (error) {
      return json(response, 502, { error: error.message });
    }
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const safePath = path.normalize(path.join(publicDir, pathname));
  if (!safePath.startsWith(publicDir)) return json(response, 403, { error: "forbidden" });

  fs.readFile(safePath, (error, data) => {
    if (error) return json(response, 404, { error: "not found" });
    response.writeHead(200, { "Content-Type": contentType(safePath), "Cache-Control": "no-cache" });
    response.end(data);
  });
});

server.listen(port, () => {
  console.log(`EdgeProof running on http://localhost:${port} (${dataMode} mode)`);
});
