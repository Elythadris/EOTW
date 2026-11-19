import { collect } from "../../server/feeds/store.mjs";

export default async function () {
  const result = await collect();
  console.info("EOTW scheduled collection", result);
}
// Every fifth minute UTC. Each adapter separately enforces its own cadence and backoff.
export const config = { schedule: "*/5 * * * *" };
