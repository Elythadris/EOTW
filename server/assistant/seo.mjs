import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const storyId = /^\d{4}-\d{2}-\d{2}-[a-f0-9]{20}$/;
const isDay = /^\d{4}-\d{2}-\d{2}$/;
const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
const sitemapNamespace = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
const text = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const escape = (value) => text(value).replace(/[&<>"']/g, letter => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[letter]);

function httpUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.password && !url.username ? url : null;
  } catch { return null; }
}

export function originFor(context) {
  const url = httpUrl(context?.site?.url || process.env.URL);
  if (!url || context?.deploy?.context !== 'production') return null;
  return 'https://' + url.host;
}

let appShell;
export async function builtShell() {
  if (!appShell) appShell = await readFile(join(process.cwd(), 'dist/index.html'), 'utf8');
  return appShell;
}

function time(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function storyHtml(shell, page) {
  const { title, description, canonical, event } = page;
  const tags = ['<title>' + escape(title) + '</title>', '<meta name="description" content="' + escape(description) + '">',
    '<meta property="og:title" content="' + escape(title) + '">', '<meta property="og:description" content="' + escape(description) + '">',
    '<meta property="og:type" content="' + (event ? 'article' : 'website') + '">', '<meta name="twitter:card" content="summary">',
    '<meta name="twitter:title" content="' + escape(title) + '">', '<meta name="twitter:description" content="' + escape(description) + '">'];
  if (canonical) tags.push('<link rel="canonical" href="' + escape(canonical) + '">', '<meta property="og:url" content="' + escape(canonical) + '">');
  if (event && time(event.publishedAt)) tags.push('<meta property="article:published_time" content="' + escape(time(event.publishedAt)) + '">');
  if (event && time(event.updatedAt)) tags.push('<meta property="article:modified_time" content="' + escape(time(event.updatedAt)) + '">');
  const source = event && httpUrl(event.url);
  const credit = source ? '<p><a href="' + escape(source.href) + '">Read the original report from ' + escape(event.source) + '</a></p>' : '';
  const fallback = '<noscript><main><article><h1>' + escape(event?.title || title) + '</h1><p>' + escape(description) + '</p>' + credit + '<a href="/">Open the briefing</a></article></main></noscript>';
  return shell
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b[^>]*(?:name|property)\s*=\s*["'](?:description|og:(?:title|description|type|url)|twitter:(?:card|title|description))["'][^>]*>/gi, '')
    .replace(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/gi, '')
    .replace(/<\/head>/i, () => tags.join('\n') + '\n</head>')
    .replace(/<\/body>/i, () => fallback + '\n</body>');
}

function headers(type, status, indexable) {
  const result = {
    'content-type': type + '; charset=utf-8', 'x-content-type-options': 'nosniff',
    'cache-control': 'public, max-age=0, must-revalidate',
    'netlify-cdn-cache-control': status === 200 ? 'public, s-maxage=120, stale-while-revalidate=300' : 'public, s-maxage=30',
    'referrer-policy':'strict-origin-when-cross-origin', 'content-security-policy':policy,
  };
  if (status === 503) {
    result['cache-control'] = 'no-store'; result['netlify-cdn-cache-control'] = 'no-store'; result['retry-after'] = '60';
  }
  if (!indexable || status !== 200) result['x-robots-tag'] = 'noindex';
  return result;
}

export function storyHandler(search, shell = builtShell) {
  return async (request, context) => {
    const head = request.method === 'HEAD';
    if (!['GET','HEAD'].includes(request.method)) return new Response(null, {status:405, headers:{ Allow:'GET, HEAD' }});
    const url = new URL(request.url);
    const origin = originFor(context);
    const id = context?.params?.id || url.pathname.slice('/story/'.length);
    let status = 404;
    let page = { title:'Story not found | EOTW', description:'This story is unavailable in the EOTW archive.' };
    try {
      if (storyId.test(id)) {
        const { events, health, updatedAt } = await search({ id });
        const event = events.find(story => story.id === id);
        if (event) {
          status = 200;
          page = { title:text(event.title).slice(0, 230) + ' | EOTW', description:text(event.summary || event.title).slice(0, 300), canonical:origin && origin + '/story/' + id, event };
        } else if (!updatedAt && !health?.some(source => source.lastSuccess)) {
          throw Error('Awaiting first successful collection');
        }
      }
    } catch {
      status = 503; page = { title:'Archive temporarily unavailable | EOTW', description:'Please check the archive again shortly.' };
    }
    try {
      const document = head ? null : storyHtml(await shell(), page);
      return new Response(document, {status, headers:headers('text/html',status,origin === url.origin)});
    } catch {
      return new Response(head ? null : 'The briefing is temporarily unavailable.', {status:503, headers:headers('text/plain',503,false)});
    }
  };
}

const urlset = rows => xmlHeader + '<urlset xmlns="' + sitemapNamespace + '">' + rows.map(({loc, lastmod}) => '<url><loc>' + escape(loc) + '</loc>' + (lastmod ? '<lastmod>' + escape(lastmod) + '</lastmod>' : '') + '</url>').join('') + '</urlset>';

export function sitemapHandler({ pages, days, stories }) {
  return async (request, context) => {
    if (!['GET','HEAD'].includes(request.method)) return new Response(null, {status:405, headers:{ Allow:'GET, HEAD' }});
    const url = new URL(request.url);
    const origin = originFor(context);
    const answer = (xml, status) => new Response(request.method === 'HEAD' ? null : xml, {
      status, headers:{ ...headers('application/xml',status,origin === url.origin), 'netlify-vary':'query=part|day' },
    });
    if (!origin) return answer(urlset([]),200);
    const day = url.searchParams.get('day');
    const part = url.searchParams.get('part');
    try {
      if (part === 'pages' && day === null) return answer(urlset(pages.map(path => ({loc:origin + path}))),200);
      if (part !== null || (day !== null && !isDay.test(day))) return answer(urlset([]),404);
      if (day !== null) {
        const records = await stories(day);
        if (!records) return answer(urlset([]),404);
        return answer(urlset(records.filter(row => storyId.test(row.id)).map(row => ({
          loc:origin + '/story/' + row.id, lastmod:time(row.updatedAt) || time(row.publishedAt),
        }))),200);
      }
      const archives = await days();
      const maps = [origin + '/sitemap.xml?part=pages', ...[...new Set(archives)].filter(value => isDay.test(value)).sort().reverse().map(value => origin + '/sitemap.xml?day=' + value)];
      const xml = xmlHeader + '<sitemapindex xmlns="' + sitemapNamespace + '">' + maps.map(loc => '<sitemap><loc>' + escape(loc) + '</loc></sitemap>').join('') + '</sitemapindex>';
      return answer(xml,200);
    } catch { return answer(urlset([]),503); }
  };
}
