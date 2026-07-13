# EdgeProof submission checklist

## Deadline priority

The India listing requires the same project to be submitted to both the global track and India listing. Do not wait for a perfect live match and miss the India deadline.

## Required before submission

- [ ] Create a public GitHub repository named `edgeproof`.
- [ ] Push this folder to the repository.
- [ ] Confirm GitHub Actions CI passes.
- [ ] Deploy on Render using `render.yaml`.
- [ ] Confirm `/api/health` returns `{"ok":true,...}`.
- [ ] Record a 60–90 second demo following `DEMO_SCRIPT.md`.
- [ ] Replace `<LIVE_URL>`, `<GITHUB_URL>`, and `<VIDEO_URL>` in `SUBMISSION.md`.
- [ ] Submit to **Trading Tools and Agents**.
- [ ] Submit the same project to **TxODDS World Cup Buildathon India**.

## Strongly recommended TxLINE evidence

- [ ] Activate the free TxLINE World Cup API token.
- [ ] Run `npm run fixtures:txline` to find covered fixture IDs.
- [ ] Choose a fixture completed between roughly 6 hours and 2 weeks ago.
- [ ] Run `npm run capture:txline` with `TXLINE_FIXTURE_ID` and token.
- [ ] Confirm `data/replay-meta.json` has `"source": "txline-historical"`.
- [ ] Change Render `REPLAY_FILE` to `data/txline-replay.json`.
- [ ] Record the provenance badge, real MessageId/seq values, and proof vault in the video.

## Deployment strategy

- Public URL: deterministic replay, ideally captured from real TxLINE historical data.
- Optional live clip: `DATA_MODE=txline` with the token stored only as an environment secret.
- Never expose `TXLINE_API_TOKEN`, guest JWT, wallet seed phrase, or private key.
- Do not make judges create a wallet, pay SOL, or supply credentials.

## Final checks

```bash
npm ci
npm test
npm run preflight
```

- [ ] Dashboard loads on desktop and mobile.
- [ ] Replay begins automatically.
- [ ] Reset, Play/Pause, and speed controls work.
- [ ] Signals explain event shock, price response, volatility, confidence, and stake.
- [ ] Final match event closes all positions.
- [ ] Data provenance is truthful and visible.
- [ ] Synthetic performance is not presented as real profitability.
