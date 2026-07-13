# EdgeProof — Autonomous Decisions, Verifiable Data

## Links

- Live judge demo: <LIVE_URL>
- Public source code: https://github.com/kovyrus/edgeproof
- 60–90 second demo video: <VIDEO_URL>

## One-line pitch

EdgeProof is an autonomous World Cup trading agent that detects delayed odds repricing after live match events, sizes paper positions automatically, explains every decision, and preserves a TxLINE/Solana proof trail.

## Problem

An odds movement alert tells a trader what already happened. It does not answer:

- Which match event caused the movement?
- Has the consensus market repriced enough?
- Is the remaining gap large enough to act on after uncertainty and volatility?
- Can the source data behind the decision be independently verified?

Sports agents also tend to be black boxes. A judge may see a “BUY” label but cannot reconstruct why it happened or trust the underlying record.

## Solution

EdgeProof combines two TxLINE feed families:

- granular score events such as goals, cards, penalties, shots, match phases, and finalisation;
- StablePrice consensus odds for the same fixture.

The agent estimates an event-adjusted fair probability, compares it with actual market repricing, measures short-window momentum and volatility, and acts only when edge and confidence pass hard thresholds. It then:

1. creates an explainable signal;
2. sizes a half-Kelly paper position with a strict bankroll cap;
3. marks and exits the position autonomously;
4. stores the odds `MessageId`, timestamp, fixture ID, and score `seq`;
5. requests TxLINE Merkle-proof payloads for the proof vault.

## What is working

- TxLINE odds and score normalization
- authenticated snapshots and SSE adapters with JWT renewal and reconnect logic
- fixture filtering so separate matches cannot contaminate one strategy
- TxLINE historical replay capture script
- event/price divergence model
- confidence score and capped Kelly sizing
- autonomous paper entries, marks, and exits
- final-score closure of remaining positions
- real-time dashboard and data provenance label
- deterministic judge replay so evaluation never depends on a live fixture
- odds proof and score-stat proof API integration
- automated tests and GitHub Actions CI

## TxLINE integration

TxLINE is the primary and indispensable data source. EdgeProof uses:

- `/api/fixtures/snapshot`
- `/api/odds/snapshot/{fixtureId}`
- `/api/scores/snapshot/{fixtureId}`
- `/api/scores/historical/{fixtureId}`
- `/api/odds/updates/{epochDay}/{hour}/{interval}`
- `/api/odds/stream`
- `/api/scores/stream`
- `/api/odds/validation?messageId=...&ts=...`
- `/api/scores/stat-validation?fixtureId=...&seq=...&statKeys=1,2`

Without TxLINE, EdgeProof loses its event stream, consensus probabilities, deterministic record identifiers, historical replay, and cryptographic audit trail.

## Why it is different

A sharp-movement detector looks only at price. EdgeProof reasons about the **gap between the match event and the market response**. It makes the complete lifecycle visible:

`TxLINE source record → model explanation → risk decision → paper position → proof record`

The product is useful to a trading team as a shadow agent and strategy research interface. The proof vault can also support market settlement and dispute review.

## Judge experience

The public link opens a deterministic replay because the evaluation must not require a judge to buy tokens, create a wallet, possess credentials, or wait for an active match. The dashboard visibly identifies whether the replay is synthetic or captured from authenticated TxLINE historical endpoints.

The accompanying video shows the real TxLINE adapter or the TxLINE-captured historical replay, while the public demo guarantees a complete repeatable product walkthrough.

## Track fit: Trading Tools and Agents

- **Core integration:** live and historical TxLINE odds and score data are jointly processed.
- **Autonomy:** the agent creates, sizes, marks, and closes positions without manual decisions.
- **Strategy quality:** signals are event-aware, volatility-aware, risk-capped, and explained.
- **Practicality:** deterministic evaluation, live mode, reconnects, health check, CI, and a zero-build deployment.
- **TxLINE depth:** snapshots, historical data, both SSE streams, and proof endpoints are first-class features.
