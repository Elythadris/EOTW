import { randomBytes, createHash } from 'node:crypto';

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const setting = (name) => globalThis.Netlify?.env?.get(name) ?? process.env[name];
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const reply = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', ...headers },
});

export function errorResponse(error) {
  if (error instanceof RequestError) return reply({ error: error.message }, error.status);
  console.error('EOTW request dependency failed', { type: error?.name || 'Error' });
  return reply({ error: 'The service is temporarily unavailable. Please try again.' }, 503);
}

export async function readJson(request, maxBytes) {
  const origin = request.headers.get('origin');
  if (origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new RequestError(403, 'Open EOTW to make this request.');
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415, 'Send an application/json body.');
  }
  if (Number(request.headers.get('content-length')) > maxBytes) throw new RequestError(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, 'A JSON body is required.');
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RequestError(413, 'Request is too large.');
      }
      parts.push(chunk.value);
    }
    const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'Send a JSON object.');
  } finally {
    reader.releaseLock();
  }
}

// The random cookie is a bearer capability. Storage contains only its digest.
export function guest(request, create = false) {
  const secure = new URL(request.url).protocol === 'https:';
  const name = secure ? '__Host-eotw-reader' : 'eotw-reader-dev';
  const pair = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  const existing = pair?.slice(name.length + 1);
  if (existing && /^[a-zA-Z0-9_-]{43}$/.test(existing)) return { key: 'guest/' + digest(existing) };
  if (!create) return null;
  const token = randomBytes(32).toString('base64url');
  const cookie = name + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000' + (secure ? '; Secure' : '');
  return { key: 'guest/' + digest(token), cookie };
}

export function scopeName(context) {
  if (context?.deploy?.context === 'production') return 'prod';
  return 'preview-' + digest(context?.deploy?.id || 'local').slice(0, 18);
}

export function boundedString(value, max, label, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new RequestError(400, 'Invalid ' + label + '.');
  }
  return value.trim();
}
