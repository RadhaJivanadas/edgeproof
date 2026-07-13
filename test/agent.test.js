import test from "node:test";
import assert from "node:assert/strict";
import { AgentEngine, normalizeOdds, normalizeScore } from "../src/agent.js";

test("normalizes TxLINE odds percentages", () => {
  const odds = normalizeOdds({
    FixtureId: 1,
    MessageId: "m1",
    Ts: 1000,
    SuperOddsType: "Match Result",
    PriceNames: ["Home", "Draw", "Away"],
    Pct: ["0.500", "0.300", "0.200"],
  });
  assert.deepEqual(odds.probabilities.map((x) => Number(x.toFixed(3))), [0.5, 0.3, 0.2]);
});

test("normalizes soccer score payload", () => {
  const score = normalizeScore({
    fixtureId: 1,
    seq: 7,
    ts: 1000,
    action: "goal",
    dataSoccer: { Minutes: 22, Participant: 1, Outcome: "Scored" },
    scoreSoccer: {
      Participant1: { Total: { Goals: 1 } },
      Participant2: { Total: { Goals: 0 } },
    },
  });
  assert.equal(score.homeScore, 1);
  assert.equal(score.awayScore, 0);
  assert.equal(score.minute, 22);
});

test("opens a risk-capped position after event/price divergence", () => {
  const engine = new AgentEngine({ bankroll: 10000, minEdge: 0.02, minConfidence: 0.55 });
  engine.ingestOdds(normalizeOdds({
    FixtureId: 1, MessageId: "m1", Ts: 1000, SuperOddsType: "Match Result",
    PriceNames: ["Home", "Draw", "Away"], Pct: ["0.55", "0.27", "0.18"],
  }));
  engine.ingestScore(normalizeScore({
    fixtureId: 1, seq: 2, ts: 2000, action: "goal",
    dataSoccer: { Minutes: 12, Participant: 2, Outcome: "Scored" },
    scoreSoccer: { Participant1: { Total: { Goals: 0 } }, Participant2: { Total: { Goals: 1 } } },
  }));
  engine.ingestOdds(normalizeOdds({
    FixtureId: 1, MessageId: "m2", Ts: 20000, SuperOddsType: "Match Result",
    PriceNames: ["Home", "Draw", "Away"], Pct: ["0.50", "0.30", "0.20"],
  }));
  assert.equal(engine.signals.length, 1);
  assert.equal(engine.positions.length, 1);
  assert.ok(engine.positions[0].stake <= 300);
});

test("closes remaining positions when a final score arrives after the last odds tick", () => {
  const engine = new AgentEngine({ bankroll: 10000, minEdge: 0.02, minConfidence: 0.55 });
  engine.ingestOdds(normalizeOdds({
    FixtureId: 1, MessageId: "m1", Ts: 1000, SuperOddsType: "Match Result",
    PriceNames: ["Home", "Draw", "Away"], Pct: ["0.55", "0.27", "0.18"],
  }));
  engine.ingestScore(normalizeScore({
    fixtureId: 1, seq: 2, ts: 2000, action: "goal",
    dataSoccer: { Minutes: 12, Participant: 2, Outcome: "Scored" },
    scoreSoccer: { Participant1: { Total: { Goals: 0 } }, Participant2: { Total: { Goals: 1 } } },
  }));
  engine.ingestOdds(normalizeOdds({
    FixtureId: 1, MessageId: "m2", Ts: 20000, SuperOddsType: "Match Result",
    PriceNames: ["Home", "Draw", "Away"], Pct: ["0.50", "0.30", "0.20"],
  }));
  assert.equal(engine.positions[0].status, "OPEN");

  engine.ingestScore(normalizeScore({
    fixtureId: 1, seq: 99, ts: 21000, action: "game_finalised", statusId: 100,
    dataSoccer: { Minutes: 90, Participant: 0, Outcome: "" },
    scoreSoccer: { Participant1: { Total: { Goals: 1 } }, Participant2: { Total: { Goals: 2 } } },
  }));

  assert.equal(engine.positions[0].status, "CLOSED");
  assert.equal(engine.positions[0].closeReason, "verified final");
});
