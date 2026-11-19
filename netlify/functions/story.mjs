import { searchEvents } from "../../server/feeds/store.mjs";
import { storyHandler } from "../../server/assistant/seo.mjs";

export default storyHandler(searchEvents);
export const config = { path: "/story/:id", method: ["GET", "HEAD"] };
