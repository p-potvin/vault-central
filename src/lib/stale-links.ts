/**
 * Expiring media links.
 *
 * A saved `rawVideoSrc` only goes stale when the host signed it — a token, an
 * expiry stamp, a CDN hash in the path. Plain static URLs keep working
 * indefinitely, so re-extracting them is pure waste: a background tab, a page
 * load and a scrape per item, for a link that was never going to break.
 *
 * So we tag the ones that *can* expire and only ever revisit those.
 */
import type { VideoData } from '../types/schemas';

/**
 * Query keys that signal a signed URL. Deliberately conservative — a false
 * positive costs a needless re-extraction, so only well-known signing
 * parameters are listed rather than anything that merely looks random.
 */
const SIGNING_PARAM_PATTERNS: RegExp[] = [
  /^(x-amz-)?(signature|credential|security-token|expires|date|algorithm|signedheaders)$/i,
  /^(token|st|hash|md5|sig|signature|key|secret)$/i,
  /^(e|exp|expire|expires|expiry|expiration|valid_?until|validto|ttl)$/i,
  /^(policy|auth|authkey|access_?token|session|nonce)$/i,
  /^(ip|client_?ip|uid|user_?id)$/i,
  /^(__hdnea__|hdnts|hdnea|hmac|verify|wmsauthsign)$/i,
];

/** Path segments used by CDNs to embed a signature (Akamai, KeyCDN, HLS tokens). */
const SIGNED_PATH_PATTERNS: RegExp[] = [
  /\/hdnts?=/i,
  /\/~[a-f0-9]{16,}\//i,
  /\/[a-f0-9]{32}\/\d{10}\//i, // md5 hash + unix expiry, very common on tube CDNs
];

/**
 * Does this media URL carry signing material that will eventually expire?
 * Returns false for anything unparseable — an unknown shape is not a reason to
 * schedule repeated network work against it.
 */
export function isExpiringMediaUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  for (const key of url.searchParams.keys()) {
    if (SIGNING_PARAM_PATTERNS.some(re => re.test(key))) return true;
  }
  return SIGNED_PATH_PATTERNS.some(re => re.test(url.pathname));
}

/**
 * Decide whether an item's link should be treated as expiring.
 *
 * An explicit `canExpire` on the record always wins, so a manual correction is
 * never overridden by the heuristic on the next sweep.
 */
export function canLinkExpire(video: Pick<VideoData, 'rawVideoSrc' | 'url'> & { canExpire?: boolean }): boolean {
  if (typeof video.canExpire === 'boolean') return video.canExpire;
  return isExpiringMediaUrl(video.rawVideoSrc);
}

/** Items worth revisiting on a sweep: expiring links with something to re-extract. */
export function selectRefreshCandidates<T extends Pick<VideoData, 'rawVideoSrc' | 'url'> & { canExpire?: boolean }>(
  videos: T[],
): T[] {
  return videos.filter(v => Boolean(v.url) && canLinkExpire(v));
}

/** How long a sweep result stands before another is allowed. */
export const STALE_SWEEP_INTERVAL_MS = 30 * 60 * 1000;

/**
 * True when a sweep is due. Unknown/!finite timestamps count as due — a missing
 * marker means we have never swept.
 */
export function isSweepDue(lastSweepAtMs: number | null | undefined, now = Date.now()): boolean {
  if (typeof lastSweepAtMs !== 'number' || !isFinite(lastSweepAtMs)) return true;
  return now - lastSweepAtMs >= STALE_SWEEP_INTERVAL_MS;
}

/**
 * Tube sites serve a short hover clip alongside the real file, usually under a
 * path or filename saying so. Both are .mp4, so a scorer that only rewards the
 * extension will happily pick the clip — which is how a refresh replaced a good
 * rawVideoSrc with a few seconds of preview and lost the real link.
 *
 * Used both to penalise these during extraction and to refuse them as a
 * replacement for a source that already works.
 */
const PREVIEW_MEDIA_PATTERNS: RegExp[] = [
  /preview/i,
  /trailer/i,
  /sample/i,
  /teaser|snippet/i,
  /\/thumbs?\//i,
  /\/(seek|sprite|storyboard|timeline)\//i,
];

export function looksLikePreviewMedia(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  let probe = rawUrl;
  try {
    const u = new URL(rawUrl);
    probe = u.pathname; // ignore query: tokens often contain arbitrary words
  } catch { /* fall back to the whole string */ }
  return PREVIEW_MEDIA_PATTERNS.some(re => re.test(probe));
}

/**
 * Should a refreshed link replace the stored one?
 *
 * A refresh exists to recover from expiry, so trading a working source for a
 * preview clip is strictly a loss. When the current source does not look like a
 * preview and the candidate does, keep what we have.
 */
export function isSafeLinkReplacement(current: string | null | undefined, candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  if (candidate === current) return true;
  if (!current) return true;
  return !(looksLikePreviewMedia(candidate) && !looksLikePreviewMedia(current));
}
