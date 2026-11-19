import { test } from "node:test";
import assert from "node:assert/strict";
import { askHandler } from "../server/assistant/ask.mjs";
import { groundedAnswer } from "../server/assistant/answer.mjs";
import { dailyLimits, reserve } from "../server/assistant/quota.mjs";
import { inputQuery, retrieve } from "../server/assistant/retrieval.mjs";

const event = {
  id: "observatory-record",
  title: "Observatory publishes a review",
  summary: "The review describes a corrected measurement.",
  source: "Test observatory",
  url: "https://example.org/review",
  location: "Maui",
  rank: 2,
  category: "Science",
  publishedAt: "2026-04-10T10:00:00Z",
  status: "confirmed",
  timeline: [],
};
const report = {
  paragraphs: [
    {
      text: "The observatory reported a correction.",
      support: [{ id: "1", quote: "a corrected measurement" }],
    },
  ],
};
const request = (body, origin = "https://watch.example") =>
  new Request("https://watch.example/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
const search = async () => ({ events: [event] });

test("retrieval honors selection, avoids unsupported source URLs and excludes social content", async () => {
  const events = [
    event,
    { ...event, id: "bad", url: "javascript:alert(1)" },
    { ...event, id: "r", source: "Reddit", url: "https://example.org/r" },
  ];
  const records = await retrieve(
    inputQuery({ question: "Analyze this story", storyId: event.id }),
    async () => ({ events }),
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].url, event.url);
  assert.equal(
    (await retrieve(inputQuery({ question: "Pineapple cultivation" }), search))
      .length,
    0,
  );
});

test("preset story questions stay on the selected event and investigations search the named topic", async () => {
  const seen = [];
  const lookup = async (options) => {
    seen.push(options);
    return { events: [event] };
  };
  await retrieve(
    inputQuery({
      question: "What evidence supports this report?",
      storyId: event.id,
    }),
    lookup,
  );
  assert.deepEqual(
    seen.map((call) => call.id),
    [event.id],
  );
  seen.length = 0;
  await retrieve(
    inputQuery({
      question: "What does the archive report about the observatory?",
      filters: { q: "Observatory" },
    }),
    lookup,
  );
  assert.ok(
    seen.some((call) => call.view === "archive" && call.q === "observatory"),
  );
});

test("citations are built from retrieved URLs and require an exact match to an excerpt", async () => {
  const records = await retrieve(
    inputQuery({ question: "Observatory" }),
    search,
  );
  const answer = groundedAnswer(report, records);
  assert.deepEqual(answer.citations, [
    { id: "1", title: event.title, url: event.url },
  ]);
  assert.match(answer.answer, /\[1\]/);
  for (const support of [
    [],
    [{ id: "9", quote: event.title }],
    [{ id: "1", quote: "Text absent from record" }],
  ]) {
    assert.equal(
      groundedAnswer({ paragraphs: [{ text: "A claim", support }] }, records),
      null,
    );
  }
  assert.equal(
    groundedAnswer(
      {
        paragraphs: [
          {
            text: "See https://invented.example",
            support: report.paragraphs[0].support,
          },
        ],
      },
      records,
    ),
    null,
  );
});

test("ask endpoint checks origin, validates input and spends a permit before contacting the model", async () => {
  const calls = [];
  const handler = askHandler({
    search,
    env: () => undefined,
    model: () => async () => {
      calls.push("provider");
      return report;
    },
    permit: async () => {
      calls.push("permit");
      return true;
    },
  });
  assert.equal(
    (
      await handler(
        request({ question: "Observatory" }, "https://elsewhere.example"),
      )
    ).status,
    403,
  );
  assert.equal(
    (await handler(request({ question: "x".repeat(801) }))).status,
    400,
  );
  assert.equal(
    (await handler(new Request("https://watch.example/api/ask"))).status,
    405,
  );
  assert.deepEqual(calls, []);
  assert.equal(
    (
      await (
        await handler(request({ question: "Observatory" }), { ip: "192.0.2.4" })
      ).json()
    ).mode,
    "ai",
  );
  assert.deepEqual(calls, ["permit", "provider"]);
});

test("storage outage, exhausted permits, absent model, and invalid model output return source material", async () => {
  const unsafe = () => {
    throw Error("A paid call must not be made");
  };
  const cases = [
    { model: () => null, permit: unsafe },
    { model: () => unsafe, permit: async () => false },
    {
      model: () => unsafe,
      permit: async () => {
        throw Error("Offline");
      },
    },
    { model: () => async () => ({ paragraphs: [] }), permit: async () => true },
  ];
  for (const options of cases) {
    const response = await askHandler({ search, ...options })(
      request({ question: "Observatory" }),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "sources");
    assert.equal(body.citations[0].url, event.url);
  }
  const empty = await askHandler({
    search: async () => ({ events: [] }),
    model: unsafe,
  })(request({ question: "Observatory" }));
  assert.deepEqual((await empty.json()).citations, []);
});

test("concurrent daily reservations cannot exceed network or site caps", async () => {
  const keys = new Set();
  const store = {
    list: async ({ prefix }) => ({
      blobs: [...keys]
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key })),
    }),
    set: async (key, value, options) => {
      assert.equal(options.onlyIfNew, true);
      if (keys.has(key)) return { modified: false };
      keys.add(key);
      return { modified: true };
    },
  };
  const base = {
    site: "site",
    limits: { global: 3, visitor: 2 },
    store,
    now: new Date("2026-01-01T01:00:00Z"),
  };
  const calls = await Promise.all(
    Array.from({ length: 15 }, () => reserve({ ...base, ip: "192.0.2.1" })),
  );
  assert.equal(calls.filter(Boolean).length, 2);
  const more = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      reserve({ ...base, ip: "192.0.2." + (i + 2) }),
    ),
  );
  assert.equal(more.filter(Boolean).length, 1);
  assert.equal(
    await reserve({ ...base, ip: "192.0.2.1", now: new Date("2026-01-02") }),
    true,
  );
  assert.deepEqual(
    dailyLimits(() => undefined),
    { global: 25, visitor: 5 },
  );
  assert.equal(dailyLimits(() => "bad").global, 0);
});
