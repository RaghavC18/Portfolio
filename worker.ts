/// <reference types="@cloudflare/workers-types" />
/**
 * Portfolio Worker — Cloudflare Workers port of server.ts
 *
 * Serves the Vite frontend as static assets (via wrangler.toml [assets])
 * and handles all /api/* routes with native R2 bindings.
 *
 * Env (wrangler.toml [vars]):
 *   R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL
 * Secrets (wrangler secret put):
 *   CREATOR_PIN, CREATOR_SESSION_SECRET,
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 * Bindings:
 *   R2_BUCKET (r2_buckets)
 */

import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

interface Env {
  R2_BUCKET: R2Bucket;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_PUBLIC_BASE_URL: string;
  CREATOR_PIN: string;
  CREATOR_SESSION_SECRET: string;
}

const PORTFOLIO_KEY = 'portfolio/portfolio.json';
const MAX_VIDEO_SIZE = 1024 * 1024 * 1024;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function safeFilename(filename: string) {
  return (filename || 'file')
    .split(/[\\/]/)
    .pop()!
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180);
}

function buildPublicUrl(key: string, env: Env) {
  const base = (env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function randomHex(bytes: number) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (b64.length % 4)) % 4;
  const bin = atob(b64 + '='.repeat(pad));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength
  ) as ArrayBuffer;
}

/** Constant-time string comparison (PIN check). */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Creator session tokens (HMAC-SHA256 via Web Crypto)
// ---------------------------------------------------------------------------

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function createSessionToken(env: Env): Promise<string> {
  const secret = env.CREATOR_SESSION_SECRET || env.CREATOR_PIN;
  const payload = base64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({ role: 'creator', iat: Date.now() })
    )
  );
  const key = await getHmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(payload)
    )
  );
  return `${payload}.${base64urlEncode(sig)}`;
}

async function verifySessionToken(
  env: Env,
  token?: string
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const secret = env.CREATOR_SESSION_SECRET || env.CREATOR_PIN;
  if (!secret) return false;

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64urlDecode(signature);
  } catch {
    return false;
  }

  try {
    const key = await getHmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      toArrayBuffer(sigBytes),
      new TextEncoder().encode(payload)
    );
    if (!valid) return false;
    const parsed = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payload))
    );
    return parsed?.role === 'creator';
  } catch {
    return false;
  }
}

/**
 * Creator token lookup. Accepts (in order):
 *   - creatorToken in the JSON body
 *   - Authorization: Bearer <token>
 *   - X-Creator-Token: <token>
 *   - creator_session cookie
 */
function getCreatorToken(req: Request, body: any): string | undefined {
  const bodyToken = String(body?.creatorToken || '').trim();
  if (bodyToken) return bodyToken;

  const authorization = req.headers.get('authorization') || '';
  if (authorization.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }

  const headerToken = (req.headers.get('x-creator-token') || '').trim();
  if (headerToken) return headerToken;

  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)creator_session=([^;]+)/);
  return match?.[1];
}

async function isCreator(
  req: Request,
  env: Env,
  body: any
): Promise<boolean> {
  return verifySessionToken(env, getCreatorToken(req, body));
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleLogin(req: Request, env: Env) {
  const body = (await req.json().catch(() => ({}))) as any;
  const submittedPin = String(body?.pin || '');

  if (!env.CREATOR_PIN) {
    return json(
      { error: 'CREATOR_PIN is not configured on the server.' },
      500
    );
  }

  if (!timingSafeEqualStr(submittedPin, env.CREATOR_PIN)) {
    return json({ error: 'Incorrect Creator PIN.' }, 401);
  }

  const token = await createSessionToken(env);

  return json(
    { success: true, token },
    200,
    {
      'Set-Cookie': `creator_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400; Secure`,
    }
  );
}

async function handleLogout() {
  return json(
    { success: true },
    200,
    {
      'Set-Cookie':
        'creator_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Secure',
    }
  );
}

function getR2Client(env: Env) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function handlePresign(req: Request, env: Env) {
  const body = (await req.json().catch(() => ({}))) as any;

  if (!(await isCreator(req, env, body))) {
    return json({ error: 'Creator authentication required.' }, 401);
  }

  const missing = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_BASE_URL',
  ].filter((k) => !(env as any)[k]);
  if (missing.length) {
    return json(
      { error: `Missing R2 configuration: ${missing.join(', ')}` },
      500
    );
  }

  const filename = String(body?.filename || '');
  const contentType = String(
    body?.contentType || 'application/octet-stream'
  );
  const size = Number(body?.size || 0);

  if (!filename) return json({ error: 'Missing filename.' }, 400);
  if (!Number.isFinite(size) || size <= 0) {
    return json({ error: 'Invalid file size.' }, 400);
  }

  const isVideo = contentType.startsWith('video/');
  const isImage = contentType.startsWith('image/');
  if (!isVideo && !isImage) {
    return json(
      { error: 'Only video and image uploads are allowed.' },
      400
    );
  }

  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
  if (size > maxSize) {
    return json(
      {
        error: `File exceeds the ${
          isVideo ? '1 GB video' : '20 MB image'
        } limit.`,
      },
      413
    );
  }

  const filenamePart = safeFilename(filename);
  const id = randomHex(8);
  const folder = isVideo ? 'portfolio/videos' : 'portfolio/images';
  const key = `${folder}/${Date.now()}_${id}_${filenamePart}`;
  const cacheControl = isVideo
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=86400';

  try {
    const uploadUrl = await getSignedUrl(
      getR2Client(env),
      new PutObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
      { expiresIn: 60 * 30 }
    );

    return json({
      uploadUrl,
      publicUrl: buildPublicUrl(key, env),
      key,
    });
  } catch (error: any) {
    console.error('R2 presign error:', error);
    return json(
      { error: error?.message || 'Failed to prepare R2 upload.' },
      500
    );
  }
}

async function handleDelete(req: Request, env: Env) {
  const body = (await req.json().catch(() => ({}))) as any;

  if (!(await isCreator(req, env, body))) {
    return json({ error: 'Creator authentication required.' }, 401);
  }

  let key = String(body?.key || '').trim().replace(/^\/+/, '');
  try {
    key = decodeURIComponent(key);
  } catch {
    // keep as-is
  }

  if (!key || !key.startsWith('portfolio/')) {
    return json(
      {
        error:
          'Invalid R2 object key. Key must start with "portfolio/".',
      },
      400
    );
  }

  try {
    await env.R2_BUCKET.delete(key);
    return json({ success: true, key });
  } catch (error: any) {
    console.error('R2 delete error:', error);
    return json(
      { error: error?.message || 'Failed to delete R2 object.' },
      500
    );
  }
}

async function handlePortfolioGet(env: Env) {
  try {
    const obj = await env.R2_BUCKET.get(PORTFOLIO_KEY);
    if (!obj) return json({ info: null, reels: null });
    const text = await obj.text();
    return json(JSON.parse(text));
  } catch (error: any) {
    console.error('Portfolio read error:', error);
    return json({ error: 'Failed to load portfolio.' }, 500);
  }
}

async function handlePortfolioSave(req: Request, env: Env) {
  const body = (await req.json().catch(() => ({}))) as any;

  if (!(await isCreator(req, env, body))) {
    return json({ error: 'Creator authentication required.' }, 401);
  }

  const document = {
    info: body?.info ?? null,
    reels: Array.isArray(body?.reels) ? body.reels : [],
    updatedAt: new Date().toISOString(),
  };

  try {
    await env.R2_BUCKET.put(
      PORTFOLIO_KEY,
      JSON.stringify(document, null, 2),
      {
        httpMetadata: {
          contentType: 'application/json',
          cacheControl: 'no-cache, no-store, must-revalidate',
        },
      }
    );
    return json({ success: true, updatedAt: document.updatedAt });
  } catch (error: any) {
    console.error('Portfolio save error:', error);
    return json({ error: 'Failed to save portfolio.' }, 500);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/api/health' && req.method === 'GET') {
      return json({ status: 'ok', storage: 'cloudflare-r2' });
    }
    if (path === '/api/admin/login' && req.method === 'POST') {
      return handleLogin(req, env);
    }
    if (path === '/api/admin/logout' && req.method === 'POST') {
      return handleLogout();
    }
    if (path === '/api/r2/presign' && req.method === 'POST') {
      return handlePresign(req, env);
    }
    if (path === '/api/r2/delete' && req.method === 'POST') {
      return handleDelete(req, env);
    }
    if (path === '/api/portfolio' && req.method === 'GET') {
      return handlePortfolioGet(env);
    }
    if (path === '/api/portfolio' && req.method === 'POST') {
      return handlePortfolioSave(req, env);
    }

    // Anything else (/api/* with wrong method, unknown paths):
    // static assets + SPA fallback are handled by [assets] in wrangler.toml.
    return new Response('Not found', { status: 404 });
  },
};
