import { createHash, randomInt } from 'node:crypto';
import { getStore } from '@netlify/blobs';

function limit(value, fallback, cap) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? Math.min(number, cap) : 0;
}

export function dailyLimits(env) {
  return { global: limit(env('AI_DAILY_LIMIT'), 25, 500), visitor: limit(env('AI_VISITOR_DAILY_LIMIT'), 5, 30) };
}

async function available(store, prefix, count) {
  const { blobs } = await store.list({ prefix });
  const used = new Set(blobs.map(item => item.key));
  return Array.from({ length: count }, (_, index) => prefix + index).filter(key => !used.has(key));
}

async function claim(store, free) {
  // Listing is a hint. The atomic create is the exclusive right to use a slot.
  for (let attempt = 0; attempt < 4 && free.length; attempt++) {
    const index = randomInt(free.length);
    const [key] = free.splice(index, 1);
    if ((await store.set(key, 'reserved', { onlyIfNew: true })).modified) return true;
  }
  return false;
}

let lastPruned = '';
async function prune(store, day) {
  if (lastPruned === day) return;
  lastPruned = day;
  try {
    const cutoff = new Date(Date.parse(day) - 7 * 86400000).toISOString().slice(0, 10);
    const { directories } = await store.list({ prefix: 'days/', directories: true });
    for (const directory of directories.filter(path => /^days\/\d{4}-\d\d-\d\d\/?$/.test(path) && path.slice(5, 15) < cutoff).slice(0, 3)) {
      const { blobs } = await store.list({ prefix: directory.replace(/\/?$/, '/') });
      for (let i = 0; i < blobs.length; i += 10) {
        await Promise.all(blobs.slice(i, i + 10).map(blob => store.delete(blob.key)));
      }
    }
  } catch {
    lastPruned = '';
  }
}

export async function reserve({ ip, site, limits, context, store = getStore({ name: 'eotw-model-permits', consistency: 'strong' }), now = new Date() }) {
  if (!ip || !limits.global || !limits.visitor) return false;
  const day = now.toISOString().slice(0, 10);
  const prefix = 'days/' + day + '/';
  // The index contains neither raw IPs nor prompts. Every visitor is keyed to the
  // platform-supplied IP so clearing anonymous cookies cannot reset the allowance.
  const visitor = createHash('sha256').update([day, site, ip].join('|')).digest('hex');
  const globalSlots = await available(store, prefix + 'site/', limits.global);
  if (!globalSlots.length) return false;
  const visitorSlots = await available(store, prefix + 'readers/' + visitor + '/', limits.visitor);
  if (!await claim(store, visitorSlots)) return false;
  if (!await claim(store, globalSlots)) return false;
  if (context?.waitUntil) context.waitUntil(prune(store, day));
  return true;
}
