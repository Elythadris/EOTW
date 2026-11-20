import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { communityHandler } from "../server/community/handler.mjs";
import { activeBoard, applyAction, member, perTopic, readAction, topicById } from "../server/community/board.mjs";

const base = "https://watch.example";
const ctx = { deploy: { context: "production" } };
const owner = { id: "test-reader-one", email: "private@example.org", name: "Private name" };
const other = { id: "test-reader-two" };
const post = (text = "Has the public advisory changed?", nonce = randomUUID()) => ({ action: "post", text, nonce });
function harness() {
  let entry = null, revision = 0, now = Date.now(), enabled = true, identifyError = false;
  const store = {
    getWithMetadata: async () => entry && structuredClone(entry),
    setJSON: async (_, data, condition) => {
      if (condition.onlyIfNew ? Boolean(entry) : condition.onlyIfMatch !== entry?.etag) return { modified: false };
      entry = { data: structuredClone(data), etag: String(++revision) };
      return { modified: true };
    },
  };
  const run = async (user, action, options = {}) => {
    const request = new Request(base + "/api/community?topic=" + (options.topic || "maui"), {
      method: action ? "POST" : "GET",
      headers: { "content-type": "application/json", origin: base, ...options.headers },
      ...(action ? { body: JSON.stringify(action) } : {}),
    });
    return communityHandler({
      storage: () => store, clock: () => now, accountEnabled: () => enabled,
      identify: async () => { if (identifyError) throw Error("Account unavailable"); return user; },
    })(request, ctx);
  };
  return { run, advance: ms => { now += ms; }, disable: () => { enabled = false; },
    failAuth: () => { identifyError = true; }, snapshot: () => structuredClone(entry?.data) };
}

test("public can read; author is derived only from the verified session and writes require a same-origin JSON request", async () => {
  const h = harness();
  const empty = await h.run(null);
  assert.equal(empty.headers.get("cache-control"), "private, no-store");
  assert.deepEqual((await empty.json()).messages, []);
  const forged = { ...post(), author: "Publisher", email: owner.email, user: owner, moderator: true };
  assert.equal((await h.run(null, forged, { headers: { "x-user-id": owner.id, cookie: "nf_jwt=fake" } })).status, 401);
  assert.equal((await h.run(owner, forged, { headers: { origin: "https://elsewhere.example" } })).status, 403);
  assert.equal((await h.run(owner, forged, { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await h.run(owner, forged, { headers: { "content-type": "text/plain" } })).status, 415);
  const created = await h.run(owner, { ...forged, source: "https://weather.gov/" });
  assert.equal(created.status, 201);
  const saved = (await created.json()).messages[0];
  assert.match(saved.author, /^Reader [A-F0-9]{10}$/);
  assert.equal(saved.own, true);
  const publicView = await (await h.run(null)).json();
  assert.equal(publicView.messages[0].id, saved.id);
  assert.equal(publicView.messages[0].source, "https://weather.gov/");
  assert.equal(publicView.messages[0].canRemove, false);
  assert.doesNotMatch(JSON.stringify(publicView), /private@example|Private name|test-reader-one|Publisher|[a-f0-9]{64}/);
  assert.doesNotMatch(JSON.stringify(h.snapshot()), /private@example|test-reader-one|Private name/);
  assert.deepEqual((await (await h.run(null, null, { topic: "world" })).json()).messages, []);
  assert.equal((await h.run(null, null, { topic: "unknown" })).status, 404);
  h.disable();
  assert.equal((await h.run(owner, post())).status, 503);
  assert.equal((await (await h.run(null)).json()).messages.length, 1);
});

test("concurrent writes preserve both readers, retry idempotency and account-wide rate limits", async () => {
  const h = harness();
  const first = post("First sourced observation.");
  const second = post("A separate question.");
  const result = await Promise.all([h.run(owner, first), h.run(other, second)]);
  assert.deepEqual(result.map(r => r.status), [201, 201]);
  const replay = await h.run(owner, first);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).messages.length, 2);
  assert.equal((await h.run(owner, { ...first, text: "Changed using the same reference." })).status, 409);
  assert.equal((await h.run(owner, post("Another message."), { topic: "world" })).status, 429);
  h.advance(31_000);
  assert.equal((await h.run(owner, post(" FIRST SOURCED   observation. "), { topic: "world" })).status, 409);
  for (let i = 0; i < 11; i++) {
    assert.equal((await h.run(owner, post("Question number " + i), { topic: "world" })).status, 201);
    h.advance(31_000);
  }
  assert.equal((await h.run(owner, post("Beyond the hourly limit."))).status, 429);
  h.advance(3_600_000);
  assert.equal((await h.run(owner, post("A later allowed question."))).status, 201);
});

test("reporting and removal respect verified roles, preserve privacy and do not reset the posting limit", async () => {
  const h = harness();
  const saved = post();
  const { id } = (await (await h.run(owner, saved)).json()).messages[0];
  const mod = { id: "moderator", roles: ["community-moderator"] };
  const forgedRole = { ...other, userMetadata: { roles: ["admin"] } };
  assert.equal((await h.run(forgedRole, { action: "remove", id, moderator: true })).status, 403);
  assert.equal((await h.run(forgedRole, { action: "report", id })).status, 200);
  assert.equal((await h.run(other, { action: "report", id })).status, 200);
  assert.equal((await (await h.run(null)).json()).messages[0].flags, 0);
  assert.equal((await (await h.run(mod)).json()).messages[0].flags, 1);
  assert.equal((await h.run(other, { action: "dismiss", id })).status, 403);
  const reviewed = await h.run(mod, { action: "dismiss", id });
  assert.equal((await reviewed.json()).messages[0].flags, 0);
  assert.equal((await h.run(mod, { action: "remove", id })).status, 200);
  assert.deepEqual((await (await h.run(null)).json()).messages, []);
  assert.equal((await h.run(owner, saved)).status, 409);
  assert.equal((await h.run(owner, post("A new post after removal."))).status, 429);
});

test("messages have bounded retention; unsafe submissions stay out of shared storage", async () => {
  const room = topicById("maui");
  const now = Date.now();
  const board = activeBoard(null, now);
  for (let i = 0; i <= perTopic; i++) {
    const by = member({ id: "test-reader-" + i }, "prod");
    applyAction(board, room, by, readAction(post("Observation " + i)), now + i);
  }
  assert.equal(board.messages.length, perTopic);
  assert.equal(board.messages[0].text, "Observation 1");
  assert.equal(activeBoard(board, now + 31 * 86_400_000).messages.length, 0);
  assert.equal(activeBoard(board, now + 3_700_000).receipts.length, 0);
  const h = harness();
  for (const action of [post("a".repeat(801)), post("Phone 808-555-0188."), post("Write private@example.org"), post("Call +44 20 7946 0958"),
    post("Visit https://example.org"), { ...post(), source: "javascript:alert(1)" },
    { ...post(), source: "https://user:pass@example.org/" }, { ...post(), source: "https://127.0.0.1/" },
    { ...post(), source: "https://example.org/?token=secret" }, { ...post(), source: "https://example.org/#access_token=secret" }, { ...post(), nonce: [randomUUID()] }])
    assert.equal((await h.run(owner, action)).status, 400);
  assert.equal(h.snapshot(), undefined);
  h.failAuth();
  assert.equal((await (await h.run(null)).json()).account.unavailable, true);
  assert.equal((await h.run(owner, post())).status, 503);
});
