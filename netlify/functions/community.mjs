import { communityHandler } from "../../server/community/handler.mjs";

export default communityHandler();
export const config = {
  path: "/api/community",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
