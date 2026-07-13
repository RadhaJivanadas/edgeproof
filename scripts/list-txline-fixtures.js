import { TxLineClient } from "../src/txline-client.js";

const apiToken = process.env.TXLINE_API_TOKEN;
if (!apiToken) throw new Error("TXLINE_API_TOKEN is required");

const client = new TxLineClient({
  baseUrl: process.env.TXLINE_BASE_URL,
  jwt: process.env.TXLINE_JWT,
  apiToken,
  fixtureId: 0,
});

const unwrap = (value) => {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "items", "results", "fixtures"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return value ? [value] : [];
};

await client.refreshJwt();
const payload = await client.fixtures();
const now = Date.now();
const rows = unwrap(payload)
  .map((fixture) => {
    const startRaw = fixture.StartTime ?? fixture.startTime;
    const start = typeof startRaw === "number"
      ? new Date(startRaw < 10_000_000_000 ? startRaw * 1000 : startRaw)
      : new Date(startRaw);
    const p1 = fixture.Participant1 ?? fixture.participant1 ?? "Participant 1";
    const p2 = fixture.Participant2 ?? fixture.participant2 ?? "Participant 2";
    const p1Home = fixture.Participant1IsHome ?? fixture.participant1IsHome ?? true;
    return {
      id: Number(fixture.FixtureId ?? fixture.fixtureId),
      start,
      home: p1Home ? p1 : p2,
      away: p1Home ? p2 : p1,
      state: fixture.GameState ?? fixture.gameState ?? "?",
      competition: fixture.CompetitionName ?? fixture.competitionName ?? "",
    };
  })
  .filter((row) => Number.isInteger(row.id) && !Number.isNaN(row.start.getTime()))
  .sort((a, b) => b.start - a.start);

console.log("FixtureId | Start UTC | State | Match | Competition");
for (const row of rows.slice(0, 100)) {
  const ageHours = (now - row.start.getTime()) / 3_600_000;
  const historicalHint = ageHours >= 6 && ageHours <= 14 * 24 ? " [historical window]" : "";
  console.log(`${row.id} | ${row.start.toISOString()} | ${row.state} | ${row.home} vs ${row.away} | ${row.competition}${historicalHint}`);
}
