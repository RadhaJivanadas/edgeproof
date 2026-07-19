const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseSseBlock(block) {
  const message = { event: "message", data: "" };
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const separator = rawLine.indexOf(":");
    const field = separator === -1 ? rawLine : rawLine.slice(0, separator);
    const value = separator === -1 ? "" : rawLine.slice(separator + 1).replace(/^ /, "");
    if (field === "event") message.event = value;
    if (field === "data") message.data += `${value}\n`;
    if (field === "id") message.id = value;
  }
  message.data = message.data.trimEnd();
  return message.data ? message : null;
}

async function* readSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const parsed = parseSseBlock(block);
      if (parsed) yield parsed;
    }
  }
}

function parseData(data) {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

export class TxLineClient {
  constructor({ baseUrl, jwt, apiToken, fixtureId }) {
    this.baseUrl = String(baseUrl || "https://txline.txodds.com").replace(/\/$/, "");
    this.jwt = jwt;
    this.apiToken = apiToken;
    this.fixtureId = Number(fixtureId);
    this.running = false;
  }

  headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.jwt}`,
      "X-Api-Token": this.apiToken,
      ...extra,
    };
  }

  async refreshJwt() {
    const response = await fetch(`${this.baseUrl}/auth/guest/start`, { method: "POST" });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TxLINE JWT renewal ${response.status}: ${body.slice(0, 300)}`);
    }
    const payload = await response.json();
    this.jwt = payload.token || payload.jwt || payload;
    if (!this.jwt || typeof this.jwt !== "string") throw new Error("TxLINE JWT renewal returned no token");
    return this.jwt;
  }

  async request(path, options = {}, retryAuth = true) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: this.headers(options.headers || {}),
    });
    if (response.status === 401 && retryAuth) {
      await this.refreshJwt();
      return this.request(path, options, false);
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TxLINE ${response.status}: ${body.slice(0, 300)}`);
    }
    return response.json();
  }

  fixtures() {
    return this.request("/api/fixtures/snapshot");
  }

  oddsSnapshot(fixtureId = this.fixtureId) {
    return this.request(`/api/odds/snapshot/${fixtureId}`);
  }

  scoresSnapshot(fixtureId = this.fixtureId) {
    return this.request(`/api/scores/snapshot/${fixtureId}`);
  }

  // Served as SSE-formatted text (`data: {...}` lines) or a JSON array, and
  // stays empty until TxLINE opens the fixture's historical window.
  async scoresHistorical(fixtureId = this.fixtureId) {
    const response = await fetch(`${this.baseUrl}/api/scores/historical/${fixtureId}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TxLINE ${response.status}: ${body.slice(0, 300)}`);
    }
    const body = (await response.text()).trim();
    if (!body) return [];
    if (body.startsWith("[") || body.startsWith("{")) {
      try {
        return JSON.parse(body);
      } catch {
        /* fall through to SSE parsing */
      }
    }
    const records = [];
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        records.push(JSON.parse(line.slice(5).trim()));
      } catch {
        /* skip malformed frame */
      }
    }
    return records;
  }

  oddsUpdates(epochDay, hourOfDay, interval) {
    return this.request(`/api/odds/updates/${epochDay}/${hourOfDay}/${interval}`);
  }

  scoresUpdates(epochDay, hourOfDay, interval) {
    return this.request(`/api/scores/updates/${epochDay}/${hourOfDay}/${interval}`);
  }

  oddsProof(messageId, ts) {
    const params = new URLSearchParams({ messageId: String(messageId), ts: String(ts) });
    return this.request(`/api/odds/validation?${params}`);
  }

  scoreProof(fixtureId, seq, statKeys = "1,2") {
    const params = new URLSearchParams({
      fixtureId: String(fixtureId),
      seq: String(seq),
      statKeys,
    });
    return this.request(`/api/scores/stat-validation?${params}`);
  }

  async stream(path, onData, onStatus = () => {}) {
    let delay = 1000;
    while (this.running) {
      try {
        onStatus({ path, status: "connecting" });
        const response = await fetch(`${this.baseUrl}${path}`, {
          headers: this.headers({
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          }),
        });
        if (response.status === 401) {
          await this.refreshJwt();
          onStatus({ path, status: "auth-renewed" });
          continue;
        }
        if (!response.ok) throw new Error(`stream ${response.status}`);
        onStatus({ path, status: "connected" });
        delay = 1000;
        for await (const message of readSse(response)) {
          if (!this.running) break;
          const payload = parseData(message.data);
          if (payload && typeof payload === "object") await onData(payload, message);
        }
      } catch (error) {
        onStatus({ path, status: "retrying", error: error.message });
        await sleep(delay);
        delay = Math.min(delay * 2, 15000);
      }
    }
  }

  async start({ onOdds, onScore, onStatus }) {
    if (!this.apiToken) throw new Error("TXLINE_API_TOKEN is required");
    if (!this.jwt) await this.refreshJwt();
    this.running = true;

    // Seed the dashboard so judges see data immediately, even before the next SSE event.
    const [odds, scores] = await Promise.all([
      this.oddsSnapshot(),
      this.scoresSnapshot(),
    ]);
    for (const item of Array.isArray(scores) ? scores : [scores]) await onScore(item);
    for (const item of Array.isArray(odds) ? odds : [odds]) await onOdds(item);

    void this.stream("/api/odds/stream", onOdds, onStatus);
    void this.stream("/api/scores/stream", onScore, onStatus);
  }

  stop() {
    this.running = false;
  }
}
