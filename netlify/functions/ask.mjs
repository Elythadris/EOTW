import { askHandler } from '../../server/assistant/ask.mjs';

export default askHandler();
export const config = {
  path: '/api/ask',
  rateLimit: { windowLimit: 12, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
