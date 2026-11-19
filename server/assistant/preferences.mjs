import { getStore } from '@netlify/blobs';
import { getUser } from '@netlify/identity';
import { boundedString, digest, errorResponse, guest, readJson, reply, RequestError, scopeName, setting } from './http.mjs';

export function defaultPreferences() {
  return { saved: [], topics: [], location: 'Maui', notifications: false, history: [] };
}

function strings(input, count, length, label) {
  if (!Array.isArray(input) || input.length > count) throw new RequestError(400, 'Invalid ' + label + '.');
  return [...new Set(input.map(value => boundedString(value, length, label)))];
}

export function cleanHistory(history, count = 24, length = 3000) {
  if (!Array.isArray(history) || history.length > count) throw new RequestError(400, 'Invalid chat history.');
  return history.map(line => {
    if (!['user', 'assistant'].includes(line?.role)) throw new RequestError(400, 'Invalid chat role.');
    return { role: line.role, text: boundedString(line.text, length, 'chat text') };
  });
}

export function cleanPreferences(input) {
  if (typeof input.notifications !== 'boolean') throw new RequestError(400, 'Invalid notification setting.');
  return {
    saved: strings(input.saved, 200, 160, 'saved story IDs'),
    topics: strings(input.topics, 32, 80, 'topics'),
    location: boundedString(input.location, 100, 'location'),
    notifications: input.notifications,
    history: cleanHistory(input.history),
  };
}

export function preferencesHandler({
  storage = (context) => getStore({ name: 'eotw-readers-' + scopeName(context), consistency: 'strong' }),
  accountEnabled = () => setting('EOTW_IDENTITY_ENABLED') === 'true',
  identify = getUser,
} = {}) {
  return async (request, context) => {
    try {
      if (!['GET', 'PUT'].includes(request.method)) return reply({ error: 'Use GET or PUT.' }, 405, { Allow: 'GET, PUT' });
      if (request.headers.get('sec-fetch-site') === 'cross-site') throw new RequestError(403, 'Open EOTW to access preferences.');
      const input = request.method === 'PUT' ? cleanPreferences(await readJson(request, 106496)) : null;
      const enabled = accountEnabled();
      const user = enabled ? await identify() : null;
      // A failed auth check must never overwrite a signed-out reader's profile.
      if (enabled && !user && /(?:^|;\s*)nf_jwt=.+/.test(request.headers.get('cookie') || '')) {
        throw new RequestError(401, 'Your account session expired. Sign in again.');
      }
      const profile = user?.id ? { key: 'account/' + digest(user.id) } : guest(request, request.method === 'GET');
      if (!profile) throw new RequestError(401, 'Open your watchlist to initialize this reader session.');
      const store = storage(context);
      const account = { enabled, signedIn: Boolean(user?.id) };
      const headers = profile.cookie ? { 'set-cookie': profile.cookie } : {};
      if (!input) {
        const row = await store.getWithMetadata(profile.key, { type: 'json' });
        return reply({ ...(row?.data?.preferences || defaultPreferences()), account }, 200, { ...headers, etag: row?.etag || '"new"' });
      }
      const expected = request.headers.get('if-match');
      const condition = expected === '"new"' ? { onlyIfNew: true } : expected ? { onlyIfMatch: expected } : {};
      const saved = await store.setJSON(profile.key, { version: 1, preferences: input }, condition);
      if (!saved.modified) {
        // Blobs may return modified=false for identical contents. Idempotent retries succeed.
        const current = await store.getWithMetadata(profile.key, { type: 'json' });
        if (JSON.stringify(current?.data?.preferences) !== JSON.stringify(input)) {
          throw new RequestError(412, 'Your watchlist changed in another session. Refresh and try again.');
        }
        return reply({ ...input, account }, 200, { ...headers, etag: current.etag });
      }
      return reply({ ...input, account }, 200, { ...headers, ...(saved.etag ? { etag: saved.etag } : {}) });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
