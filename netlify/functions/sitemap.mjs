import { repository, SNAPSHOT_KEY } from '../../server/feeds/store.mjs';
import { sitemapHandler } from '../../server/assistant/seo.mjs';

export default sitemapHandler({
  pages: ['/', '/map', '/trending', '/rabbit-hole', '/investigate', '/archive', '/sources'],
  async days() {
    const snapshot = await repository().get(SNAPSHOT_KEY, { type: 'json' });
    return snapshot?.days || [];
  },
  async stories(day) {
    return repository().get('v1/days/' + day, { type: 'json' });
  },
});
export const config = { path: '/sitemap.xml', method: ['GET', 'HEAD'] };
