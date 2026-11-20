import { assessmentHandler } from "../../server/assistant/assessment.mjs";

export default assessmentHandler();
export const config = {path:"/api/assessment",rateLimit:{windowLimit:30,windowSize:60,aggregateBy:["ip","domain"]}};
