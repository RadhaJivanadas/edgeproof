const $ = (id) => document.getElementById(id);
const fmtMoney = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(value || 0));
const fmtPct = (value, digits = 1) => `${(Number(value || 0) * 100).toFixed(digits)}%`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

let state = null;
let eventSource = null;

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function renderMode(system) {
  const pill = $("mode-pill");
  const isReplay = system.mode === "demo";
  const txlineReplay = isReplay && system.replaySource === "txline-historical";
  const label = txlineReplay
    ? `TxLINE replay · ${system.status}`
    : isReplay
      ? `judge demo · ${system.status}`
      : `TxLINE live · ${system.status}`;
  pill.querySelector("span:last-child").textContent = label;
  pill.classList.toggle("error", system.status === "error");

  const notice = $("demo-warning");
  if (isReplay) {
    notice.style.display = "block";
    notice.classList.toggle("verified", txlineReplay);
    notice.textContent = txlineReplay
      ? `Deterministic replay captured from authenticated TxLINE historical endpoints${system.replayGeneratedAt ? ` · ${new Date(system.replayGeneratedAt).toLocaleDateString()}` : ""}.`
      : "Synthetic judge replay. The same normalization and decision pipeline is used by the live TxLINE adapter.";
  } else {
    notice.style.display = "none";
  }
  $("replay-controls").style.display = isReplay ? "grid" : "none";
}

function renderMatch(data) {
  const score = data.lastScore;
  const odds = data.lastOdds;
  const fixture = data.system.fixture;
  setText("competition", fixture.competition || "World Cup 2026");
  setText("home-team", fixture.home || odds?.names?.[0] || "Home");
  setText("away-team", fixture.away || odds?.names?.[2] || "Away");
  setText("minute", score ? `${String(score.minute).padStart(2, "0")}′` : "00′");
  setText("score", `${score?.homeScore ?? 0} : ${score?.awayScore ?? 0}`);
  setText("p-home", odds ? fmtPct(odds.probabilities[0]) : "—");
  setText("p-draw", odds ? fmtPct(odds.probabilities[1]) : "—");
  setText("p-away", odds ? fmtPct(odds.probabilities[2]) : "—");
}

function renderKpis(data) {
  setText("equity", fmtMoney(data.equity));
  setText("pnl", fmtMoney(data.metrics.pnl));
  $("pnl").className = `kpi-value ${data.metrics.pnl > 0 ? "positive" : data.metrics.pnl < 0 ? "negative" : ""}`;
  setText("drawdown", `max DD ${fmtMoney(data.metrics.maxDrawdown)}`);
  setText("signal-count", String(data.signals.length));
  const settled = data.metrics.wins + data.metrics.losses;
  setText("hit-rate", settled ? `${Math.round((data.metrics.wins / settled) * 100)}% profitable exits` : "awaiting exits");
  setText("verified-count", String(data.metrics.verified));
}

function pathFor(history, index, width = 900, height = 310) {
  if (!history.length) return "";
  const padX = 8, padY = 14;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  return history.map((row, i) => {
    const x = padX + (i / Math.max(history.length - 1, 1)) * innerW;
    const y = padY + (1 - row.probabilities[index]) * innerH;
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function renderChart(data) {
  const history = data.history || [];
  $("home-path").setAttribute("d", pathFor(history, 0));
  $("draw-path").setAttribute("d", pathFor(history, 1));
  $("away-path").setAttribute("d", pathFor(history, 2));

  const grid = $("grid-lines");
  if (!grid.childNodes.length) {
    for (let i = 0; i <= 5; i += 1) {
      const y = 14 + (i / 5) * 282;
      grid.insertAdjacentHTML("beforeend", `<line class="chart-grid" x1="8" y1="${y}" x2="892" y2="${y}" />`);
    }
  }

  const markers = [];
  const relevant = data.signals.slice().reverse();
  for (const signal of relevant) {
    const index = history.findIndex((row) => row.ts >= signal.ts);
    if (index < 0) continue;
    const x = 8 + (index / Math.max(history.length - 1, 1)) * 884;
    markers.push(`<line class="event-marker" x1="${x}" y1="14" x2="${x}" y2="296"/><text class="event-label" x="${x + 5}" y="27">${escapeHtml(signal.id)}</text>`);
  }
  $("chart-events").innerHTML = markers.join("");
}

function renderAgent(data) {
  const latest = data.signals[0];
  const confidence = latest?.confidence || 0;
  $("confidence-ring").textContent = fmtPct(confidence, 0);
  document.documentElement.style.setProperty("--confidence", Math.round(confidence * 100));
  setText("min-edge", fmtPct(data.config.minEdge));
  setText("risk-cap", fmtPct(data.config.maxKellyFraction));
  setText("processed", String(data.metrics.processed));
  setText("agent-pulse", latest && Date.now() - latest.ts < 20000 ? "SIGNAL" : "SCANNING");
}

function renderSignals(data) {
  const container = $("signals");
  if (!data.signals.length) {
    container.className = "empty-state";
    container.textContent = "No trade yet. The agent is waiting for a material event/price divergence.";
    return;
  }
  container.className = "";
  container.innerHTML = data.signals.slice(0, 5).map((signal) => `
    <article class="signal-card">
      <div class="signal-top">
        <div><strong>${escapeHtml(signal.id)} · BUY ${escapeHtml(signal.side)}</strong><div class="signal-score">${escapeHtml(signal.trigger)} · fixture ${signal.fixtureId}</div></div>
        <span class="proof-status ${escapeHtml(signal.proofStatus)}">${escapeHtml(signal.proofStatus)}</span>
      </div>
      <div class="signal-metrics">
        <div><small>MODELED EDGE</small><b>${fmtPct(signal.edge)}</b></div>
        <div><small>CONFIDENCE</small><b>${fmtPct(signal.confidence)}</b></div>
        <div><small>AUTO STAKE</small><b>${fmtMoney(signal.stake)}</b></div>
      </div>
      <p>${escapeHtml(signal.explanation)}</p>
    </article>`).join("");
}

function renderPositions(data) {
  const tbody = $("positions");
  if (!data.positions.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No open positions</td></tr>`;
    return;
  }
  tbody.innerHTML = data.positions.slice(0, 10).map((position) => `
    <tr>
      <td>${escapeHtml(position.id)}</td>
      <td><strong>${escapeHtml(position.side)}</strong></td>
      <td>${fmtMoney(position.stake)}</td>
      <td>${fmtPct(position.entryProbability)}</td>
      <td>${fmtPct(position.currentProbability)}</td>
      <td class="${position.pnl >= 0 ? "positive" : "negative"}">${fmtMoney(position.pnl)}</td>
      <td><span class="status-chip">${escapeHtml(position.status)}</span></td>
    </tr>`).join("");
}

function renderProofs(data) {
  const container = $("proofs");
  if (!data.proofs.length) {
    container.innerHTML = `<div class="empty-state wide">Proof records appear as the replay reaches decisive events.</div>`;
    return;
  }
  container.innerHTML = data.proofs.slice(0, 8).map((proof) => `
    <article class="proof-card">
      <div class="proof-card-head"><strong>${proof.messageId ? "ODDS PROOF" : "SCORE PROOF"}</strong><span class="proof-icon">✓</span></div>
      <div class="proof-row"><span>Status</span><code>${escapeHtml(proof.status)}</code></div>
      <div class="proof-row"><span>Record</span><code>${escapeHtml(proof.messageId || `seq:${proof.scoreSeq}`)}</code></div>
      <div class="proof-row"><span>Root</span><code>${escapeHtml(proof.root || "returned")}</code></div>
      <div class="proof-row"><span>Nodes</span><code>${escapeHtml(proof.proofNodes ?? "—")}</code></div>
      <div class="proof-row"><span>Network</span><code>${escapeHtml(proof.network || "Solana")}</code></div>
    </article>`).join("");
}

function renderReplay(replay) {
  if (!replay) return;
  setText("replay-progress", `${replay.index} / ${replay.total} events`);
  $("progress-bar").style.width = `${Math.round(replay.progress * 100)}%`;
  $("play-btn").textContent = replay.running ? "Ⅱ Pause" : "▶ Play";
  $("speed-select").value = String(replay.speed);
}

function render(next) {
  state = next;
  renderMode(next.system);
  renderMatch(next);
  renderKpis(next);
  renderChart(next);
  renderAgent(next);
  renderSignals(next);
  renderPositions(next);
  renderProofs(next);
  renderReplay(next.replay);
}

async function command(action, body = {}) {
  await fetch(`/api/replay/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

$("play-btn").addEventListener("click", () => command(state?.replay?.running ? "pause" : "start"));
$("reset-btn").addEventListener("click", () => command("reset"));
$("speed-select").addEventListener("change", (event) => command("speed", { speed: Number(event.target.value) }));

async function connect() {
  const initial = await fetch("/api/state").then((response) => response.json());
  render(initial);
  if (new URLSearchParams(location.search).has("snapshot")) return;
  eventSource = new EventSource("/api/events");
  eventSource.addEventListener("state", (event) => render(JSON.parse(event.data)));
  eventSource.addEventListener("system", async () => {
    const fresh = await fetch("/api/state").then((response) => response.json());
    render(fresh);
  });
  eventSource.onerror = () => setTimeout(() => {
    eventSource?.close();
    connect().catch(console.error);
  }, 1500);
}

connect().catch((error) => {
  console.error(error);
  $("mode-pill").querySelector("span:last-child").textContent = "connection error";
});
