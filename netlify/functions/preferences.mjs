import { preferencesHandler } from '../../server/assistant/preferences.mjs';

export default preferencesHandler();
export const config = {
  path: '/api/preferences',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
