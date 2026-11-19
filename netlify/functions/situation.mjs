import { readSituation } from "../../server/assistant/situation.mjs";

export default readSituation;
export const config = { path:"/api/situation", rateLimit:{windowLimit:100, windowSize:60, aggregateBy:["ip","domain"]} };
