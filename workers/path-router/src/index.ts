/**
 * Path router for mesaorigins.com
 *
 * App paths → APP_ORIGIN (Cloud Run)
 * Everything else → MARKETING_ORIGIN (Vercel)
 */
export interface Env {
  APP_ORIGIN: string;
  MARKETING_ORIGIN: string;
}

const APP_PREFIXES = [
  '/login',
  '/admin',
  '/api',
  '/auth',
  '/mesaops',
  '/mesaleads',
  '/mesaerp',
  '/supplier-portal',
  '/command',
  '/app-assets',
  '/sw.js',
  '/manifest.webmanifest',
  '/icons',
] as const;

function isAppPath(pathname: string): boolean {
  return APP_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function requireOrigin(value: string | undefined, name: string): string {
  if (!value || !/^https:\/\/[^/]+$/i.test(value)) {
    throw new Error(
      `${name} must be an https origin with no path or trailing slash (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let appOrigin: string;
    let marketingOrigin: string;
    try {
      appOrigin = requireOrigin(env.APP_ORIGIN, 'APP_ORIGIN');
      marketingOrigin = requireOrigin(env.MARKETING_ORIGIN, 'MARKETING_ORIGIN');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid Worker env';
      return new Response(message, { status: 500 });
    }

    const url = new URL(request.url);
    const origin = isAppPath(url.pathname) ? appOrigin : marketingOrigin;
    const target = new URL(`${url.pathname}${url.search}`, `${origin}/`);

    const headers = new Headers(request.headers);
    // Let fetch set Host from the target origin (Cloud Run / Vercel hostname).
    headers.delete('host');
    headers.set('X-Forwarded-Host', url.host);
    headers.set('X-Forwarded-Proto', 'https');

    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    const upstream = await fetch(new Request(target.toString(), init));
    const response = new Response(upstream.body, upstream);
    response.headers.set('X-Mesa-Router', isAppPath(url.pathname) ? 'app' : 'marketing');
    response.headers.set('X-Mesa-Upstream-Host', new URL(origin).host);
    return response;
  },
};
