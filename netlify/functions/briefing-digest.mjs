import { generateSituation } from "../../server/assistant/situation.mjs";

// Every ten minutes, two minutes past the collector. One model attempt per six-hour UTC slot.
export const config = { schedule:"2-59/10 * * * *" };
export default async function(_request, context) {
  const result = await generateSituation(context);
  if (!["already-checked","unchanged"].includes(result.status)) console.info("EOTW scheduled briefing",result);
}
