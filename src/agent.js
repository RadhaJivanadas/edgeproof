const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 4) => Number(value.toFixed(digits));

function entropy(probabilities) {
  return -probabilities.reduce((sum, p) => sum + (p > 0 ? p * Math.log(p) : 0), 0);
}

function normalizedProbabilities(raw) {
  const values = raw.map(Number).map((v) => (Number.isFinite(v) ? Math.max(v, 0) : 0));
  const sum = values.reduce((a, b) => a + b, 0);
  if (!sum) return [1 / 3, 1 / 3, 1 / 3];
  return values.map((v) => v / sum);
}

function pick(obj, ...paths) {
  for (const path of paths) {
    const parts = path.split(".");
    let cursor = obj;
    let valid = true;
    for (const part of parts) {
      if (cursor == null || !(part in cursor)) {
        valid = false;
        break;
      }
      cursor = cursor[part];
    }
    if (valid && cursor != null) return cursor;
  }
  return undefined;
}

export function normalizeOdds(record) {
  const names = pick(record, "PriceNames", "priceNames") || [];
  const pct = pick(record, "Pct", "pct") || [];
  const prices = pick(record, "Prices", "prices") || [];

  let probs = pct.map((value) => Number.parseFloat(value));
  if (probs.length !== names.length || probs.some((v) => !Number.isFinite(v))) {
    // TxLINE price scaling can depend on the market. Decimal-looking values are
    // interpreted as decimal odds; otherwise use a neutral fallback.
    const implied = prices.map((price) => {
      const p = Number(price);
      return p > 1 && p < 100 ? 1 / p : 0;
    });
    probs = implied.some(Boolean) ? implied : names.map(() => 1);
  }

  const normalized = normalizedProbabilities(probs);
  const lowerNames = names.map((name) => String(name).toLowerCase());
  const homeIndex = lowerNames.findIndex((n) => /home|participant ?1|\b1\b/.test(n));
  const drawIndex = lowerNames.findIndex((n) => /draw|tie|\bx\b/.test(n));
  const awayIndex = lowerNames.findIndex((n) => /away|participant ?2|\b2\b/.test(n));

  const indices = [
    homeIndex >= 0 ? homeIndex : 0,
    drawIndex >= 0 ? drawIndex : Math.min(1, normalized.length - 1),
    awayIndex >= 0 ? awayIndex : Math.min(2, normalized.length - 1),
  ];

  return {
    fixtureId: Number(pick(record, "FixtureId", "fixtureId")),
    messageId: String(pick(record, "MessageId", "messageId") || "unknown"),
    ts: Number(pick(record, "Ts", "ts") || Date.now()),
    market: String(pick(record, "SuperOddsType", "superOddsType") || "Match Result"),
    period: String(pick(record, "MarketPeriod", "marketPeriod") || "Full Time"),
    inRunning: Boolean(pick(record, "InRunning", "inRunning")),
    probabilities: indices.map((index) => normalized[index] ?? 1 / 3),
    names: indices.map((index, i) => names[index] || ["Home", "Draw", "Away"][i]),
    source: String(pick(record, "Bookmaker", "bookmaker") || "TxLINE StablePrice"),
    raw: record,
  };
}

export function normalizeScore(record) {
  const soccer = pick(record, "scoreSoccer", "ScoreSoccer") || {};
  const p1 = pick(soccer, "Participant1.Total.Goals", "participant1.total.goals") ?? 0;
  const p2 = pick(soccer, "Participant2.Total.Goals", "participant2.total.goals") ?? 0;
  const clockSeconds = Number(pick(record, "dataSoccer.Clock.seconds", "clock.seconds", "Clock.seconds") ?? 0);
  const minutes = Number(pick(record, "dataSoccer.Minutes", "dataSoccer.minutes"));
  const minute = Number.isFinite(minutes) ? minutes : Math.floor(clockSeconds / 60);

  return {
    fixtureId: Number(pick(record, "fixtureId", "FixtureId")),
    seq: Number(pick(record, "seq", "Seq") || 0),
    ts: Number(pick(record, "ts", "Ts") || Date.now()),
    action: String(pick(record, "action", "Action", "dataSoccer.Action") || "update"),
    statusId: Number(pick(record, "statusId", "StatusId", "statusSoccerId") || 0),
    minute,
    homeScore: Number(p1),
    awayScore: Number(p2),
    participant: Number(pick(record, "dataSoccer.Participant", "dataSoccer.participant") || 0),
    outcome: String(pick(record, "dataSoccer.Outcome", "dataSoccer.outcome") || ""),
    raw: record,
  };
}

function eventImpact(action, participant, outcome) {
  const a = String(action).toLowerCase();
  const o = String(outcome).toLowerCase();
  if (a.includes("goal") && !a.includes("disallow") && !o.includes("overturn")) return participant === 2 ? -0.23 : 0.23;
  if (a.includes("red") || (a.includes("card") && o.includes("red"))) return participant === 2 ? 0.11 : -0.11;
  if (a.includes("penalty") && !o.includes("miss")) return participant === 2 ? -0.08 : 0.08;
  if (a.includes("shot") && (o.includes("target") || o.includes("woodwork"))) return participant === 2 ? -0.025 : 0.025;
  if (a.includes("corner") || a.includes("highdanger")) return participant === 2 ? -0.012 : 0.012;
  return 0;
}

export class AgentEngine {
  constructor(options = {}) {
    this.bankroll = Number(options.bankroll || 10000);
    this.startingBankroll = this.bankroll;
    this.maxKellyFraction = Number(options.maxKellyFraction || 0.03);
    this.minEdge = Number(options.minEdge || 0.035);
    this.minConfidence = Number(options.minConfidence || 0.68);
    this.history = [];
    this.signals = [];
    this.positions = [];
    this.proofs = [];
    this.lastOdds = null;
    this.lastScore = null;
    this.pendingImpact = 0;
    this.pendingEvent = null;
    this.lastSignalAt = 0;
    this.metrics = {
      processed: 0,
      verified: 0,
      pnl: 0,
      wins: 0,
      losses: 0,
      maxDrawdown: 0,
      peakEquity: this.bankroll,
    };
  }

  ingestScore(score, proof = null) {
    this.lastScore = score;
    const impact = eventImpact(score.action, score.participant, score.outcome);
    if (impact) {
      this.pendingImpact = impact;
      this.pendingEvent = score;
    }
    if (proof) this.addProof(proof);
    this.metrics.processed += 1;

    // A final score can arrive after the final odds tick. Close any remaining
    // paper positions against the latest consensus instead of leaving them open.
    const finalised = score.action === "game_finalised" || score.statusId === 100;
    if (finalised && this.lastOdds) this.markPositions(this.lastOdds);

    return this.snapshot();
  }

  ingestOdds(odds, proof = null) {
    const previous = this.lastOdds;
    this.lastOdds = odds;
    this.metrics.processed += 1;

    if (previous) {
      this.history.push({
        ts: odds.ts,
        minute: this.lastScore?.minute ?? 0,
        probabilities: odds.probabilities.map((p) => round(p)),
        score: [this.lastScore?.homeScore ?? 0, this.lastScore?.awayScore ?? 0],
      });
      if (this.history.length > 180) this.history.shift();
      this.markPositions(odds);
      this.evaluate(previous, odds);
    } else {
      this.history.push({
        ts: odds.ts,
        minute: this.lastScore?.minute ?? 0,
        probabilities: odds.probabilities.map((p) => round(p)),
        score: [this.lastScore?.homeScore ?? 0, this.lastScore?.awayScore ?? 0],
      });
    }

    if (proof) this.addProof(proof);
    return this.snapshot();
  }

  evaluate(previous, current) {
    const marketMove = current.probabilities[0] - previous.probabilities[0];
    const recent = this.history.slice(-8).map((row) => row.probabilities[0]);
    const mean = recent.reduce((a, b) => a + b, 0) / Math.max(recent.length, 1);
    const variance = recent.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(recent.length, 1);
    const volatility = Math.sqrt(variance);
    const momentum = recent.length > 2 ? recent.at(-1) - recent[0] : 0;
    const timePressure = clamp((this.lastScore?.minute ?? 0) / 90, 0, 1);

    // The event model estimates the immediate probability shift that should be
    // visible after a goal/card/penalty. The gap is a potential stale-price edge.
    const expectedShift = this.pendingImpact * (0.72 + 0.28 * timePressure);
    const eventGap = expectedShift - marketMove;
    const momentumEdge = momentum * 0.35;
    const modelEdge = eventGap + momentumEdge;
    const side = modelEdge >= 0 ? 0 : 2;
    const edge = Math.abs(modelEdge);

    const entropyDrop = entropy(previous.probabilities) - entropy(current.probabilities);
    const confidence = clamp(
      0.45 + edge * 4.2 + Math.min(Math.abs(entropyDrop) * 1.8, 0.12) - Math.min(volatility * 2, 0.13),
      0.05,
      0.97,
    );

    const now = current.ts;
    const cooldownPassed = now - this.lastSignalAt > 12000;
    if (edge >= this.minEdge && confidence >= this.minConfidence && cooldownPassed) {
      const fairProbability = clamp(current.probabilities[side] + edge, 0.02, 0.98);
      const marketProbability = current.probabilities[side];
      const decimalOdds = 1 / Math.max(marketProbability, 0.01);
      const b = decimalOdds - 1;
      const q = 1 - fairProbability;
      const fullKelly = clamp((b * fairProbability - q) / Math.max(b, 0.01), 0, 1);
      const fraction = Math.min(fullKelly * 0.5, this.maxKellyFraction);
      const stake = round(this.bankroll * fraction, 2);

      const signal = {
        id: `SIG-${String(this.signals.length + 1).padStart(3, "0")}`,
        ts: current.ts,
        fixtureId: current.fixtureId,
        side: [current.names[0], current.names[1], current.names[2]][side],
        sideIndex: side,
        edge: round(edge),
        confidence: round(confidence),
        marketProbability: round(marketProbability),
        fairProbability: round(fairProbability),
        stake,
        trigger: this.pendingEvent
          ? `${this.pendingEvent.action} at ${this.pendingEvent.minute}'`
          : "consensus momentum divergence",
        explanation: this.explain({ expectedShift, marketMove, momentum, volatility, edge }),
        oddsMessageId: current.messageId,
        scoreSeq: this.pendingEvent?.seq || this.lastScore?.seq || 0,
        proofStatus: "pending",
      };

      this.signals.unshift(signal);
      this.signals = this.signals.slice(0, 20);
      this.lastSignalAt = now;
      if (stake > 0) this.openPosition(signal, current);
      this.pendingImpact *= 0.35;
      this.pendingEvent = null;
    } else {
      this.pendingImpact *= 0.82;
      if (Math.abs(this.pendingImpact) < 0.005) {
        this.pendingImpact = 0;
        this.pendingEvent = null;
      }
    }
  }

  explain({ expectedShift, marketMove, momentum, volatility, edge }) {
    const lag = expectedShift - marketMove;
    const lagText = Math.abs(lag) > 0.02
      ? `event-adjusted probability moved ${Math.abs(lag * 100).toFixed(1)}pp less than expected`
      : "market repricing is close to the event model";
    const momentumText = `${Math.abs(momentum * 100).toFixed(1)}pp short-window consensus momentum`;
    const volText = `${(volatility * 100).toFixed(1)}pp local volatility`;
    return `${lagText}; ${momentumText}; ${volText}; resulting modeled edge ${(edge * 100).toFixed(1)}pp.`;
  }

  openPosition(signal, odds) {
    const duplicate = this.positions.some((p) => p.status === "OPEN" && p.sideIndex === signal.sideIndex);
    if (duplicate) return;
    this.positions.unshift({
      id: `POS-${String(this.positions.length + 1).padStart(3, "0")}`,
      signalId: signal.id,
      openedAt: signal.ts,
      fixtureId: signal.fixtureId,
      side: signal.side,
      sideIndex: signal.sideIndex,
      entryProbability: signal.marketProbability,
      currentProbability: signal.marketProbability,
      stake: signal.stake,
      pnl: 0,
      status: "OPEN",
      reason: signal.trigger,
      oddsMessageId: odds.messageId,
    });
    this.positions = this.positions.slice(0, 30);
  }

  markPositions(odds) {
    for (const position of this.positions) {
      if (position.status !== "OPEN") continue;
      position.currentProbability = round(odds.probabilities[position.sideIndex]);
      // Paper mark-to-market: probability appreciation relative to entry,
      // scaled by entry probability to approximate a binary share position.
      position.pnl = round(position.stake * ((position.currentProbability - position.entryProbability) / Math.max(position.entryProbability, 0.02)), 2);

      const age = odds.ts - position.openedAt;
      const probabilityMove = position.currentProbability - position.entryProbability;
      const takeProfit = age > 10000 && probabilityMove >= 0.012;
      const stopLoss = age > 10000 && probabilityMove <= -0.025;
      const finalised = this.lastScore?.action === "game_finalised" || this.lastScore?.statusId === 100;
      if (takeProfit || stopLoss || finalised) {
        const reason = finalised ? "verified final" : takeProfit ? "edge realized" : "risk stop";
        this.closePosition(position, reason);
      }
    }
    const openPnl = this.positions.filter((p) => p.status === "OPEN").reduce((sum, p) => sum + p.pnl, 0);
    const realized = this.positions.filter((p) => p.status === "CLOSED").reduce((sum, p) => sum + p.pnl, 0);
    this.metrics.pnl = round(openPnl + realized, 2);
    const equity = this.startingBankroll + this.metrics.pnl;
    this.metrics.peakEquity = Math.max(this.metrics.peakEquity, equity);
    const dd = this.metrics.peakEquity - equity;
    this.metrics.maxDrawdown = Math.max(this.metrics.maxDrawdown, round(dd, 2));
  }

  closePosition(position, reason) {
    if (position.status !== "OPEN") return;
    position.status = "CLOSED";
    position.closedAt = Date.now();
    position.closeReason = reason;
    this.bankroll = round(this.bankroll + position.pnl, 2);
    if (position.pnl >= 0) this.metrics.wins += 1;
    else this.metrics.losses += 1;
  }

  addProof(proof) {
    const id = proof.messageId || proof.scoreSeq || proof.id;
    if (this.proofs.some((p) => (p.messageId || p.scoreSeq || p.id) === id)) return;
    this.proofs.unshift({ ...proof, receivedAt: Date.now() });
    this.proofs = this.proofs.slice(0, 20);
    if (proof.status === "verified" || proof.verified === true) this.metrics.verified += 1;

    for (const signal of this.signals) {
      if (signal.oddsMessageId === proof.messageId || signal.scoreSeq === proof.scoreSeq) {
        signal.proofStatus = proof.status || (proof.verified ? "verified" : "available");
      }
    }
  }

  reset() {
    const options = {
      bankroll: this.startingBankroll,
      maxKellyFraction: this.maxKellyFraction,
      minEdge: this.minEdge,
      minConfidence: this.minConfidence,
    };
    Object.assign(this, new AgentEngine(options));
  }

  snapshot() {
    return {
      bankroll: round(this.bankroll, 2),
      equity: round(this.startingBankroll + this.metrics.pnl, 2),
      metrics: { ...this.metrics },
      lastOdds: this.lastOdds,
      lastScore: this.lastScore,
      history: [...this.history],
      signals: [...this.signals],
      positions: [...this.positions],
      proofs: [...this.proofs],
      config: {
        minEdge: this.minEdge,
        minConfidence: this.minConfidence,
        maxKellyFraction: this.maxKellyFraction,
      },
    };
  }
}
