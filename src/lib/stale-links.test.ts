import { describe, it, expect } from 'vitest';
import {
  isExpiringMediaUrl,
  canLinkExpire,
  selectRefreshCandidates,
  isSweepDue,
  STALE_SWEEP_INTERVAL_MS,
} from './stale-links';

/**
 * Links only go stale when the host signed them. Everything here exists to keep
 * the sweep narrow: a false positive costs a background tab and a page scrape
 * per dashboard open, so plain URLs must never qualify.
 */

describe('isExpiringMediaUrl', () => {
  it('flags signed CDN links', () => {
    const signed = [
      'https://cdn.example.test/v/clip.mp4?token=abc123&expires=1754031599',
      'https://cdn.example.test/v/clip.mp4?st=Ab3&e=1754031599',
      'https://cdn.example.test/clip.m3u8?X-Amz-Signature=deadbeef&X-Amz-Expires=3600',
      'https://cdn.example.test/clip.mp4?hash=9f8e7d&valid_until=1754031599',
      'https://cdn.example.test/clip.mp4?policy=eyJT&signature=xyz',
      'https://media.example.test/hdnts=exp=1754031599~acl=/*~hmac=ab12/clip.m3u8',
      'https://media.example.test/~a1b2c3d4e5f60718/clip.mp4',
      'https://media.example.test/5d41402abc4b2a76b9719d911017c592/1754031599/clip.mp4',
    ];
    for (const url of signed) {
      expect(isExpiringMediaUrl(url), url).toBe(true);
    }
  });

  it('leaves plain and merely-parameterised URLs alone', () => {
    const stable = [
      'https://cdn.example.test/videos/clip.mp4',
      'https://cdn.example.test/videos/clip.m3u8',
      'https://example.test/watch?v=abc123',
      'https://cdn.example.test/clip.mp4?quality=1080p&autoplay=1',
      'https://cdn.example.test/clip.mp4?utm_source=newsletter',
      'https://media.example.test/2026/08/clip.mp4',
    ];
    for (const url of stable) {
      expect(isExpiringMediaUrl(url), url).toBe(false);
    }
  });

  it('treats unusable input as non-expiring rather than guessing', () => {
    expect(isExpiringMediaUrl(null)).toBe(false);
    expect(isExpiringMediaUrl(undefined)).toBe(false);
    expect(isExpiringMediaUrl('')).toBe(false);
    expect(isExpiringMediaUrl('not a url at all')).toBe(false);
    expect(isExpiringMediaUrl('/relative/clip.mp4?token=abc')).toBe(false);
  });
});

describe('canLinkExpire', () => {
  it('honours an explicit flag over the heuristic in both directions', () => {
    expect(canLinkExpire({ url: 'https://e.test/a', rawVideoSrc: 'https://cdn.test/a.mp4', canExpire: true })).toBe(true);
    expect(canLinkExpire({ url: 'https://e.test/a', rawVideoSrc: 'https://cdn.test/a.mp4?token=x', canExpire: false })).toBe(false);
  });

  it('falls back to the URL shape when unset', () => {
    expect(canLinkExpire({ url: 'https://e.test/a', rawVideoSrc: 'https://cdn.test/a.mp4?token=x' })).toBe(true);
    expect(canLinkExpire({ url: 'https://e.test/a', rawVideoSrc: 'https://cdn.test/a.mp4' })).toBe(false);
  });
});

describe('selectRefreshCandidates', () => {
  it('returns only expiring items, so static libraries cost nothing', () => {
    const videos = [
      { url: 'https://e.test/1', rawVideoSrc: 'https://cdn.test/1.mp4?token=a&expires=1' },
      { url: 'https://e.test/2', rawVideoSrc: 'https://cdn.test/2.mp4' },
      { url: 'https://e.test/3', rawVideoSrc: null },
      { url: 'https://e.test/4', rawVideoSrc: 'https://cdn.test/4.mp4', canExpire: true },
    ];
    expect(selectRefreshCandidates(videos).map(v => v.url)).toEqual([
      'https://e.test/1',
      'https://e.test/4',
    ]);
  });
});

describe('isSweepDue', () => {
  const now = 1_754_031_599_000;

  it('is due when never swept', () => {
    expect(isSweepDue(undefined, now)).toBe(true);
    expect(isSweepDue(null, now)).toBe(true);
    expect(isSweepDue(NaN, now)).toBe(true);
  });

  it('holds off inside the interval and allows it after', () => {
    expect(isSweepDue(now - 1000, now)).toBe(false);
    expect(isSweepDue(now - (STALE_SWEEP_INTERVAL_MS - 1), now)).toBe(false);
    expect(isSweepDue(now - STALE_SWEEP_INTERVAL_MS, now)).toBe(true);
    expect(isSweepDue(now - STALE_SWEEP_INTERVAL_MS * 3, now)).toBe(true);
  });
});

describe('looksLikePreviewMedia / isSafeLinkReplacement', () => {
  it('spots the hover clip a tube site serves next to the real file', async () => {
    const { looksLikePreviewMedia } = await import('./stale-links');
    expect(looksLikePreviewMedia('https://cdn.test/preview/abc.mp4')).toBe(true);
    expect(looksLikePreviewMedia('https://cdn.test/media/abc_trailer.mp4')).toBe(true);
    expect(looksLikePreviewMedia('https://cdn.test/thumbs/abc.mp4')).toBe(true);
    expect(looksLikePreviewMedia('https://cdn.test/videos/abc.mp4')).toBe(false);
  });

  it('ignores the query, where tokens carry arbitrary words', async () => {
    const { looksLikePreviewMedia } = await import('./stale-links');
    expect(looksLikePreviewMedia('https://cdn.test/videos/abc.mp4?t=preview123')).toBe(false);
  });

  it('refuses to trade a working source for a preview clip', async () => {
    const { isSafeLinkReplacement } = await import('./stale-links');
    const real = 'https://cdn.test/videos/abc.mp4';
    const clip = 'https://cdn.test/preview/abc.mp4';

    expect(isSafeLinkReplacement(real, clip)).toBe(false);
    expect(isSafeLinkReplacement(real, 'https://cdn.test/videos/abc.mp4?token=new')).toBe(true);
    // Nothing stored yet, or already a preview: anything is an improvement.
    expect(isSafeLinkReplacement(null, clip)).toBe(true);
    expect(isSafeLinkReplacement(clip, clip)).toBe(true);
    expect(isSafeLinkReplacement(real, null)).toBe(false);
  });
});
