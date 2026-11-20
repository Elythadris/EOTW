import { collect } from "../../server/feeds/store.mjs";

export default async function (request) {
  const body = await request.json().catch(() => ({}));
  const nextTime = Date.parse(body?.next_run);
  const nextScheduledAt = Number.isFinite(nextTime) ? new Date(nextTime).toISOString() : null;
  const result = await collect({ nextScheduledAt });
  console.info("EOTW scheduled collection", result);
}
// Netlify evaluates the ten-minute schedule in UTC on the published deployment.
export const config = { schedule: "*/10 * * * *" };
