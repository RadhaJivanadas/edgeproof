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

test("normalizes a raw TxLINE historical score record", () => {
  const score = normalizeScore({
    FixtureId: 18257739,
    Action: "goal",
    Ts: 1784496390003,
    Seq: 1049,
    StatusId: 7,
    Participant: 1,
    Clock: { Running: true, Seconds: 5739 },
    Score: {
      Participant1: { Total: { Goals: 1, Corners: 9 } },
      Participant2: { Total: { YellowCards: 3, RedCards: 1 } },
    },
  });
  assert.equal(score.homeScore, 1);
  assert.equal(score.awayScore, 0);
  assert.equal(score.minute, 95);
  assert.equal(score.participant, 1);
  assert.equal(score.action, "goal");
});

test("normalizes StablePrice 1X2 odds with part1/part2 outcome names", () => {
  const odds = normalizeOdds({
    FixtureId: 18257739,
    MessageId: "m-stab",
    Ts: 1784487902001,
    Bookmaker: "TXLineStablePriceDemargined",
    SuperOddsType: "1X2_PARTICIPANT_RESULT",
    PriceNames: ["part1", "draw", "part2"],
    Pct: ["50.0", "30.0", "20.0"],
  });
  assert.deepEqual(odds.probabilities.map((x) => Number(x.toFixed(3))), [0.5, 0.3, 0.2]);
});

test("keeps the last known score for records without a score block", () => {
  const engine = new AgentEngine();
  engine.ingestScore(normalizeScore({
    FixtureId: 1, Seq: 5, Ts: 1000, Action: "goal", Participant: 1,
    Clock: { Running: true, Seconds: 600 },
    Score: { Participant1: { Total: { Goals: 1 } } },
  }));
  engine.ingestScore(normalizeScore({ FixtureId: 1, Seq: 6, Ts: 2000, Action: "shot" }));
  assert.equal(engine.lastScore.homeScore, 1);
  assert.equal(engine.lastScore.awayScore, 0);
  assert.equal(engine.lastScore.minute, 10);
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
