export interface UploadProgressCallback {
  (percent: number, loaded: number, total: number): void;
}

interface PresignResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      text ||
      `Request failed with HTTP ${response.status}.`
    );
  }

  return data as T;
}

interface LoginResponse {
  success: boolean;
  token?: string;
}

const CREATOR_TOKEN_KEY = 'creator_session_token';
let memoryCreatorToken = '';

function getCreatorToken(): string {
  try {
    return (
      memoryCreatorToken ||
      sessionStorage.getItem(CREATOR_TOKEN_KEY) ||
      ''
    );
  } catch {
    return '';
  }
}

function setCreatorToken(token: string) {
  memoryCreatorToken = token;

  try {
    sessionStorage.setItem(
      CREATOR_TOKEN_KEY,
      token
    );
  } catch {
    // Cookie fallback remains available for normal deployments.
  }
}

function clearCreatorToken() {
  memoryCreatorToken = '';

  try {
    sessionStorage.removeItem(
      CREATOR_TOKEN_KEY
    );
  } catch {
    // Ignore storage failures.
  }
}

function creatorHeaders(): Record<string, string> {
  const token = getCreatorToken();

  if (!token) return {};

  return {
    Authorization: `Bearer ${token}`,
    'X-Creator-Token': token,
  };
}

export async function verifyCreatorPin(
  pin: string
): Promise<boolean> {
  const response = await fetch(
    '/api/admin/login',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        pin,
      }),
    }
  );

  // A 401 specifically means the PIN is wrong.
  if (response.status === 401) {
    return false;
  }

  // Anything else is a server/deployment/configuration problem,
  // not an incorrect PIN. Preserve the actual error.
  if (!response.ok) {
    const text = await response.text();

    let message = '';

    try {
      const data = text
        ? JSON.parse(text)
        : null;

      message =
        data?.error ||
        text ||
        `Creator login failed with HTTP ${response.status}.`;
    } catch {
      message =
        text ||
        `Creator login failed with HTTP ${response.status}.`;
    }

    throw new Error(message);
  }

  const data =
    await parseJsonResponse<LoginResponse>(
      new Response(
        await response.clone().text(),
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }
      )
    );

  if (data.token) {
    setCreatorToken(data.token);
  }

  return data.success === true;
}

export async function logoutCreator(): Promise<void> {
  try {
    await fetch(
      '/api/admin/logout',
      {
        method: 'POST',
        headers: {
          ...creatorHeaders(),
        },
        credentials: 'include',
      }
    );
  } finally {
    clearCreatorToken();
  }
}

export async function uploadFileToServer(
  file: File,
  onProgress?: UploadProgressCallback
): Promise<string> {
  if (!file) {
    throw new Error(
      'No file selected.'
    );
  }

  if (file.size <= 0) {
    throw new Error(
      'The selected file is empty.'
    );
  }

  const presignResponse =
    await fetch(
      '/api/r2/presign',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
          ...creatorHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          filename: file.name,
          contentType:
            file.type ||
            'application/octet-stream',
          size: file.size,
          creatorToken:
            getCreatorToken(),
        }),
      }
    );

  const presigned =
    await parseJsonResponse<PresignResponse>(
      presignResponse
    );

  await uploadDirectToR2(
    file,
    presigned.uploadUrl,
    onProgress
  );

  return presigned.publicUrl;
}

function uploadDirectToR2(
  file: File,
  uploadUrl: string,
  onProgress?: UploadProgressCallback
): Promise<void> {
  return new Promise(
    (resolve, reject) => {
      const xhr =
        new XMLHttpRequest();

      xhr.open(
        'PUT',
        uploadUrl,
        true
      );

      if (file.type) {
        xhr.setRequestHeader(
          'Content-Type',
          file.type
        );
      }

      xhr.upload.onprogress = (
        event
      ) => {
        if (!event.lengthComputable)
          return;

        const loaded =
          event.loaded;
        const total =
          event.total;

        const percent =
          Math.min(
            99,
            Math.round(
              (loaded / total) *
                100
            )
          );

        onProgress?.(
          percent,
          loaded,
          total
        );
      };

      xhr.onload = () => {
        if (
          xhr.status >= 200 &&
          xhr.status < 300
        ) {
          onProgress?.(
            100,
            file.size,
            file.size
          );

          resolve();
        } else {
          reject(
            new Error(
              `R2 upload failed with HTTP ${xhr.status}.`
            )
          );
        }
      };

      xhr.onerror = () => {
        reject(
          new Error(
            'Network error while uploading to R2.'
          )
        );
      };

      xhr.onabort = () => {
        reject(
          new Error(
            'Upload was cancelled.'
          )
        );
      };

      xhr.ontimeout = () => {
        reject(
          new Error(
            'R2 upload timed out.'
          )
        );
      };

      xhr.timeout =
        30 * 60 * 1000;

      xhr.send(file);
    }
  );
}

/**
 * Extracts the Cloudflare R2 object key from:
 * - portfolio/videos/<filename>
 * - portfolio/images/<filename>
 * - https://pub-xxxx.r2.dev/portfolio/videos/<filename>
 * - https://cdn.domain.com/portfolio/images/<filename>
 */
export function extractR2Key(
  urlOrKey?: string
): string | null {
  if (!urlOrKey) return null;

  const trimmed =
    urlOrKey.trim();

  if (!trimmed) return null;

  // Already a raw R2 key
  if (
    trimmed.startsWith(
      'portfolio/videos/'
    ) ||
    trimmed.startsWith(
      'portfolio/images/'
    ) ||
    trimmed.startsWith(
      'portfolio/'
    )
  ) {
    try {
      return decodeURIComponent(
        trimmed
      );
    } catch {
      return trimmed;
    }
  }

  // Leading slash
  const cleaned =
    trimmed.replace(
      /^\/+/,
      ''
    );

  if (
    cleaned.startsWith(
      'portfolio/videos/'
    ) ||
    cleaned.startsWith(
      'portfolio/images/'
    ) ||
    cleaned.startsWith(
      'portfolio/'
    )
  ) {
    try {
      return decodeURIComponent(
        cleaned
      );
    } catch {
      return cleaned;
    }
  }

  // Full URL
  try {
    const url =
      new URL(trimmed);

    const pathname =
      url.pathname;

    const portfolioIdx =
      pathname.indexOf(
        'portfolio/'
      );

    if (portfolioIdx !== -1) {
      const key =
        pathname.substring(
          portfolioIdx
        );

      try {
        return decodeURIComponent(
          key
        );
      } catch {
        return key;
      }
    }
  } catch {
    // Not a standard absolute URL.
  }

  return null;
}

/**
 * Returns true if the provided URL/path is an R2 object.
 */
export function isR2Url(
  urlOrKey?: string
): boolean {
  return (
    extractR2Key(
      urlOrKey
    ) !== null
  );
}

/**
 * Deletes an R2 object.
 */
export async function deleteR2Object(
  urlOrKey?: string
): Promise<boolean> {
  const key =
    extractR2Key(
      urlOrKey
    );

  if (!key) {
    return false;
  }

  const response =
    await fetch(
      '/api/r2/delete',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
          ...creatorHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          key,
          creatorToken:
            getCreatorToken(),
        }),
      }
    );

  await parseJsonResponse<{
    success: boolean;
    key?: string;
  }>(response);

  return true;
}

/**
 * Backward compatibility alias.
 */
export const deleteVideoBlob =
  deleteR2Object;

export async function saveServerPortfolio(
  info: any,
  reels: any[]
): Promise<void> {
  const response =
    await fetch(
      '/api/portfolio',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
          ...creatorHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          info,
          reels:
            Array.isArray(reels)
              ? reels
              : [],
          creatorToken:
            getCreatorToken(),
        }),
      }
    );

  await parseJsonResponse(
    response
  );
}

export async function fetchServerPortfolio() {
  const response =
    await fetch(
      '/api/portfolio',
      {
        method: 'GET',
        cache: 'no-store',
      }
    );

  return parseJsonResponse<{
    info: any;
    reels: any[] | null;
    updatedAt?: string;
  }>(response);
}

export function formatVideoUrl(
  url?: string
): string {
  if (!url) return '';

  return url.trim();
}
