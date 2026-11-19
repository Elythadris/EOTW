import { test } from "node:test";
import assert from "node:assert/strict";
import { preferencesHandler } from "../server/assistant/preferences.mjs";

const url = "https://watch.example/api/preferences";
function harness(user = null) {
  const rows = new Map();
  let revision = 0;
  const store = {
    getWithMetadata: async (key) => rows.get(key) || null,
    setJSON: async (key, data, condition) => {
      const current = rows.get(key);
      if (
        (condition.onlyIfNew && current) ||
        (condition.onlyIfMatch && current?.etag !== condition.onlyIfMatch)
      )
        return { modified: false };
      const etag = '"' + ++revision + '"';
      rows.set(key, { data, etag });
      return { modified: true, etag };
    },
  };
  return {
    rows,
    handler: preferencesHandler({
      storage: () => store,
      accountEnabled: () => Boolean(user),
      identify: async () => user,
    }),
  };
}
const get = (cookie) => new Request(url, { headers: cookie ? { cookie } : {} });
const put = (body, cookie, etag, origin = "https://watch.example") =>
  new Request(url, {
    method: "PUT",
    headers: {
      origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(etag ? { "if-match": etag } : {}),
    },
    body: JSON.stringify(body),
  });

test("guest cookie is secure and guest profiles are isolated by possession", async () => {
  const { handler, rows } = harness();
  const first = await handler(get());
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  const set = first.headers.get("set-cookie");
  assert.match(set, /HttpOnly; SameSite=Strict/);
  assert.match(set, /; Secure/);
  const cookie = set.split(";")[0];
  const profile = await first.json();
  const edited = { ...profile, saved: ["story-1"], location: "Oahu" };
  assert.equal(
    (await handler(put(edited, cookie, first.headers.get("etag")))).status,
    200,
  );
  assert.equal((await (await handler(get(cookie))).json()).location, "Oahu");
  assert.equal((await (await handler(get())).json()).location, "Maui");
  assert.equal(rows.size, 1);
  assert.ok(![...rows.keys()][0].includes(cookie.split("=")[1]));
  assert.equal((await handler(put(edited, null))).status, 401);
});

test("preferences reject cross-origin writes, oversize input and stale versions", async () => {
  const { handler } = harness();
  const initial = await handler(get());
  const prefs = await initial.json();
  const cookie = initial.headers.get("set-cookie").split(";")[0];
  const etag = initial.headers.get("etag");
  assert.equal(
    (await handler(put(prefs, cookie, etag, "https://unrelated.example")))
      .status,
    403,
  );
  assert.equal(
    (
      await handler(
        put({ ...prefs, topics: Array(33).fill("science") }, cookie, etag),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handler(
        put(
          { ...prefs, history: [{ role: "system", text: "x" }] },
          cookie,
          etag,
        ),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handler(
        put({ ...prefs, location: "a".repeat(110000) }, cookie, etag),
      )
    ).status,
    413,
  );
  assert.equal(
    (await handler(put({ ...prefs, location: "Oahu" }, cookie, etag))).status,
    200,
  );
  assert.equal(
    (await handler(put({ ...prefs, location: "Kauai" }, cookie, etag))).status,
    412,
  );
});

test("signed-in accounts use a verified identity instead of a client identity or guest cookie", async () => {
  const { handler, rows } = harness({ id: "account-id" });
  const initial = await handler(get());
  const body = await initial.json();
  assert.equal(initial.headers.has("set-cookie"), false);
  assert.deepEqual(body.account, { enabled: true, signedIn: true });
  assert.equal(
    (
      await handler(
        put({ ...body, account: { id: "others" }, location: "Kauai" }),
      )
    ).status,
    200,
  );
  assert.ok([...rows.keys()][0].startsWith("account/"));
  assert.equal((await (await handler(get())).json()).location, "Kauai");
});
