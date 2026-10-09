import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 8000;
const CHECK_UA = 'Mozilla/5.0 (compatible; CinemaWrapper/1.0; frame-compatibility-check)';

/**
 * GET /api/check-frame?url=<target> — ADMIN ONLY.
 *
 * Diagnostic tool: performs a server-side HEAD request (fallback: 1-byte
 * ranged GET) against the target URL and reports the exact response headers
 * that decide whether the site may be embedded in an iframe:
 *
 *   - X-Frame-Options        (DENY / SAMEORIGIN block embedding)
 *   - Content-Security-Policy: frame-ancestors (blocks embedding unless the
 *     wrapper's origin — or * — is listed)
 *
 * It only READS and REPORTS headers. It never proxies content and never
 * strips or rewrites protection headers — that would be circumventing the
 * target site's explicit anti-framing policy.
 */
export async function GET(req: NextRequest) {
  const authed = await requireAuth();
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = req.nextUrl.searchParams.get('url')?.trim();
  if (!raw) {
    return NextResponse.json({ error: 'Missing "url" query parameter.' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    return NextResponse.json(
      { error: 'Invalid URL. Use a full http(s) URL.' },
      { status: 400 }
    );
  }

  const base = {
    url: target.toString(),
    reachable: false,
    status: 0,
    contentType: null as string | null,
    xFrameOptions: null as string | null,
    contentSecurityPolicy: null as string | null,
    frameAncestors: null as string[] | null,
    allowsFraming: false,
    advice: '',
  };

  try {
    let res = await fetch(target.toString(), {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': CHECK_UA, Accept: 'text/html,*/*' },
    });

    // Some servers reject HEAD — retry with a 1-byte ranged GET.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(target.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': CHECK_UA, Accept: 'text/html,*/*', Range: 'bytes=0-0' },
      });
    }

    const xfo = res.headers.get('x-frame-options');
    const csp = res.headers.get('content-security-policy');
    const faMatch = csp?.match(/frame-ancestors\s+([^;]+)/i);
    const frameAncestors = faMatch ? faMatch[1].trim().split(/\s+/).filter(Boolean) : null;

    const xfoUpper = (xfo || '').toUpperCase();
    const blockedByXfo = xfoUpper.includes('DENY') || xfoUpper.includes('SAMEORIGIN');
    const blockedByCsp =
      frameAncestors !== null &&
      frameAncestors.length > 0 &&
      (frameAncestors.includes("'none'") || !frameAncestors.includes('*'));

    const allowsFraming = res.ok && !blockedByXfo && !blockedByCsp;

    let advice: string;
    if (blockedByXfo && blockedByCsp) {
      advice =
        'The site explicitly blocks embedding (both X-Frame-Options and CSP frame-ancestors). It cannot be shown inside the iframe — choose a source that permits embedding.';
    } else if (blockedByXfo) {
      advice =
        'The site sends X-Frame-Options (DENY/SAMEORIGIN), which forbids embedding it in an iframe. Choose a source that permits embedding.';
    } else if (blockedByCsp) {
      advice =
        'The site\'s Content-Security-Policy frame-ancestors directive does not list this origin, so embedding is blocked. Choose a source that permits embedding.';
    } else if (!res.ok) {
      advice = `The server responded with HTTP ${res.status}. Check that the URL is correct and publicly reachable.`;
    } else {
      advice = 'The site allows embedding — it can be displayed inside the cinema iframe.';
    }

    return NextResponse.json({
      ...base,
      reachable: true,
      status: res.status,
      contentType: res.headers.get('content-type'),
      xFrameOptions: xfo,
      contentSecurityPolicy: csp,
      frameAncestors,
      allowsFraming,
      advice,
    });
  } catch (err) {
    return NextResponse.json({
      ...base,
      reachable: false,
      allowsFraming: false,
      advice: 'Could not reach the URL from the server. Check the URL and that the site is online.',
      error: err instanceof Error ? err.message : 'fetch failed',
    });
  }
}
