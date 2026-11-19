import { generateSituation } from "../../server/assistant/situation.mjs";

// Every five minutes, two minutes past the collector. One model attempt per six-hour UTC slot.
export const config = { schedule:"2-59/5 * * * *" };
export default async function(_request, context) {
  const result = await generateSituation(context);
  if (!["already-checked","unchanged"].includes(result.status)) console.info("EOTW scheduled briefing",result);
}
