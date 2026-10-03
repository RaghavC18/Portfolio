import 'dotenv/config';

import express from 'express';
import path from 'path';
import crypto from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || '';
const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const CREATOR_PIN = process.env.CREATOR_PIN || '';

const SESSION_SECRET =
  process.env.CREATOR_SESSION_SECRET ||
  CREATOR_PIN ||
  'change-this-session-secret';

const PORTFOLIO_KEY = 'portfolio/portfolio.json';
const MAX_VIDEO_SIZE = 1024 * 1024 * 1024;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

function requireR2Config() {
  const missing = [
    ['R2_ACCOUNT_ID', R2_ACCOUNT_ID],
    ['R2_ACCESS_KEY_ID', R2_ACCESS_KEY_ID],
    ['R2_SECRET_ACCESS_KEY', R2_SECRET_ACCESS_KEY],
    ['R2_BUCKET_NAME', R2_BUCKET_NAME],
    ['R2_PUBLIC_BASE_URL', R2_PUBLIC_BASE_URL],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(
      `Missing R2 environment variables: ${missing.join(', ')}`
    );
  }
}

requireR2Config();

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const app = express();

app.use(express.json({ limit: '2mb' }));

function safeFilename(filename: string) {
  return path
    .basename(filename || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180);
}

function buildPublicUrl(key: string) {
  return `${R2_PUBLIC_BASE_URL}/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

function signSession(payload: string) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
}

function createSessionToken() {
  const payload = Buffer.from(
    JSON.stringify({
      role: 'creator',
      iat: Date.now(),
    })
  ).toString('base64url');

  return `${payload}.${signSession(payload)}`;
}

function verifySessionToken(token?: string) {
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;
  const expected = signSession(payload);

  if (signature.length !== expected.length) return false;

  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
    ) {
      return false;
    }
  } catch {
    return false;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );

    return parsed?.role === 'creator';
  } catch {
    return false;
  }
}

/**
 * Creator authentication for protected endpoints.
 *
 * Preferred in AI Studio preview:
 *   Authorization: Bearer <token>
 *
 * Also accepts:
 *   X-Creator-Token: <token>
 *
 * Cookie is retained for normal deployments:
 *   creator_session=<token>
 */
function getCreatorToken(req: express.Request): string | undefined {
  // Most reliable in AI Studio preview: token in POST body.
  const bodyToken = String(req.body?.creatorToken || '').trim();
  if (bodyToken) return bodyToken;

  const authorization = String(req.headers.authorization || '');

  if (authorization.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }

  const headerToken = String(
    req.headers['x-creator-token'] || ''
  ).trim();

  if (headerToken) return headerToken;

  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(
    /(?:^|;\s*)creator_session=([^;]+)/
  );

  return match?.[1];
}

function isCreator(req: express.Request) {
  return verifySessionToken(
    getCreatorToken(req)
  );
}

function requireCreator(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!isCreator(req)) {
    return res.status(401).json({
      error: 'Creator authentication required.',
    });
  }

  next();
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    storage: 'cloudflare-r2',
  });
});

/**
 * Creator PIN login.
 * Returns the signed session token to the frontend AND sets a cookie fallback.
 */
app.post('/api/admin/login', (req, res) => {
  const submittedPin = String(req.body?.pin || '');

  if (!CREATOR_PIN) {
    return res.status(500).json({
      error: 'CREATOR_PIN is not configured on the server.',
    });
  }

  const submitted = Buffer.from(submittedPin);
  const expected = Buffer.from(CREATOR_PIN);

  if (
    submitted.length !== expected.length ||
    !crypto.timingSafeEqual(submitted, expected)
  ) {
    return res.status(401).json({
      error: 'Incorrect Creator PIN.',
    });
  }

  const token = createSessionToken();

  const secure =
    process.env.NODE_ENV === 'production'
      ? '; Secure'
      : '';

  res.setHeader(
    'Set-Cookie',
    `creator_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400${secure}`
  );

  console.log('Creator login successful; token issued.');

  return res.json({
    success: true,
    token,
  });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader(
    'Set-Cookie',
    'creator_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'
  );

  return res.json({
    success: true,
  });
});

app.post('/api/r2/presign', requireCreator, async (req, res) => {
  try {
    const filename = String(req.body?.filename || '');
    const contentType = String(
      req.body?.contentType || 'application/octet-stream'
    );
    const size = Number(req.body?.size || 0);

    if (!filename) {
      return res.status(400).json({
        error: 'Missing filename.',
      });
    }

    if (!Number.isFinite(size) || size <= 0) {
      return res.status(400).json({
        error: 'Invalid file size.',
      });
    }

    const isVideo = contentType.startsWith('video/');
    const isImage = contentType.startsWith('image/');

    if (!isVideo && !isImage) {
      return res.status(400).json({
        error: 'Only video and image uploads are allowed.',
      });
    }

    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;

    if (size > maxSize) {
      return res.status(413).json({
        error: `File exceeds the ${
          isVideo ? '1 GB video' : '20 MB image'
        } limit.`,
      });
    }

    const filenamePart = safeFilename(filename);
    const id = crypto.randomBytes(8).toString('hex');
    const folder = isVideo
      ? 'portfolio/videos'
      : 'portfolio/images';

    const key = `${folder}/${Date.now()}_${id}_${filenamePart}`;
    const cacheControl = isVideo
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=86400';

    const uploadUrl = await getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
      { expiresIn: 60 * 30 }
    );

    return res.json({
      uploadUrl,
      publicUrl: buildPublicUrl(key),
      key,
    });
  } catch (error: any) {
    console.error('R2 presign error:', error);

    return res.status(500).json({
      error:
        error?.message ||
        'Failed to prepare R2 upload.',
    });
  }
});

app.post('/api/r2/delete', requireCreator, async (req, res) => {
  try {
    let key = String(req.body?.key || '').trim().replace(/^\/+/, '');

    try {
      key = decodeURIComponent(key);
    } catch {
      // Keep key as is
    }

    if (!key || !key.startsWith('portfolio/')) {
      return res.status(400).json({
        error: 'Invalid R2 object key. Key must start with "portfolio/".',
      });
    }

    await r2.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      })
    );

    return res.json({ success: true, key });
  } catch (error: any) {
    console.error('R2 delete error:', error);

    return res.status(500).json({
      error:
        error?.message ||
        'Failed to delete R2 object.',
    });
  }
});

app.get('/api/portfolio', async (_req, res) => {
  try {
    const result = await r2.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: PORTFOLIO_KEY,
      })
    );

    if (!result.Body) {
      return res.json({
        info: null,
        reels: null,
      });
    }

    const text = await result.Body.transformToString();

    return res.json(JSON.parse(text));
  } catch (error: any) {
    if (
      error?.name === 'NoSuchKey' ||
      error?.$metadata?.httpStatusCode === 404
    ) {
      return res.json({
        info: null,
        reels: null,
      });
    }

    console.error('Portfolio read error:', error);

    return res.status(500).json({
      error: 'Failed to load portfolio.',
    });
  }
});

app.post('/api/portfolio', requireCreator, async (req, res) => {
  try {
    const info = req.body?.info || null;
    const reels = Array.isArray(req.body?.reels)
      ? req.body.reels
      : [];

    const document = {
      info,
      reels,
      updatedAt: new Date().toISOString(),
    };

    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: PORTFOLIO_KEY,
        Body: JSON.stringify(document, null, 2),
        ContentType: 'application/json',
        CacheControl: 'no-cache, no-store, must-revalidate',
      })
    );

    return res.json({
      success: true,
      updatedAt: document.updatedAt,
    });
  } catch (error: any) {
    console.error('Portfolio save error:', error);

    return res.status(500).json({
      error: 'Failed to save portfolio.',
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } =
      await import('vite');

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(
      process.cwd(),
      'dist'
    );

    app.use(express.static(distPath));

    app.get('*', (_req, res) => {
      res.sendFile(
        path.join(distPath, 'index.html')
      );
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Portfolio server running on port ${PORT}`
    );
    console.log('Storage: Cloudflare R2');
    console.log(`Bucket: ${R2_BUCKET_NAME}`);
  });
}

startServer().catch((error) => {
  console.error(
    'Failed to start portfolio server:',
    error
  );
  process.exit(1);
});
