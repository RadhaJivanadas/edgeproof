# 90-second demo script

## 0:00–0:12 — Problem

“Most sports trading bots watch odds in isolation. EdgeProof watches the match event and the price together, then preserves the TxLINE records behind every decision.”

## 0:12–0:25 — Data provenance

Show the mode badge and match card:

“This public link uses a deterministic replay so judges never need credentials or an active fixture. The badge shows whether the replay was captured from authenticated TxLINE historical endpoints or is the fallback synthetic judge dataset.”

If the replay is still synthetic, immediately show a separate 5–10 second terminal or second-service clip with `DATA_MODE=txline` connected. Do not imply synthetic records are live.

## 0:25–0:45 — First autonomous decision

Let the replay reach the away goal and point to the signal:

“The score feed reports the goal, but StablePrice has moved less than the event-adjusted model expects. EdgeProof quantifies the residual edge, explains momentum and volatility, and sizes a half-Kelly paper position capped at 3%.”

## 0:45–1:00 — Regime change

Let the replay reach the red card:

“The red card changes the expected probability response. The agent is not a generic price alert; it reasons about the event and market reaction together.”

## 1:00–1:18 — Verifiability

Open the Proof Vault:

“Every decision retains the TxLINE MessageId, timestamp, fixture ID, and real score sequence. EdgeProof requests odds and score-stat Merkle-proof payloads linked to Solana-anchored roots.”

## 1:18–1:30 — Close

“The same pipeline supports snapshots, historical capture, and live SSE streams. EdgeProof is a repeatable judge demo, a practical shadow-trading agent, and a verifiable execution layer.”
