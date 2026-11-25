import { PlatformPost } from './types';

/**
 * Pull the JSON object out of a model reply.
 *
 * The prompt asks for raw JSON, but models still wrap it in ``` fences (with or
 * without a language tag) or add a sentence before/after it. Try the raw text,
 * then the text with fences stripped, then the outermost {...} span.
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();
  const candidates = [
    text,
    text.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, ''),
  ];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try the next candidate
    }
  }
  throw new Error('Claude response is not valid JSON');
}

function toText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function toHashtags(v: unknown): string[] {
  // A single string like "#ai #community" or "ai, community" is a common slip.
  const list: unknown[] = Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.split(/[\s,]+/)
      : [];
  return list.map(toText).filter((h) => h.length > 0);
}

/**
 * Coerce the parsed model reply into GeneratedContent's shape.
 *
 * The model's JSON is untrusted: a post can come back with `hashtags` as a
 * string, missing, or holding numbers, and `caption`/`hook` can be missing.
 * Before this, one such post made `post.hashtags.map` (or `h.replace`) throw,
 * which killed the whole run and discarded every platform's post after the
 * tokens were already paid for. Non-object entries are dropped; fields are
 * coerced to the types PlatformPost declares.
 */
export function coercePosts(parsed: unknown): PlatformPost[] {
  const posts = (parsed as { posts?: unknown } | null)?.posts;
  if (!Array.isArray(posts)) {
    throw new Error('Claude response missing posts array');
  }
  return posts
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null && !Array.isArray(p))
    .map((p) => ({
      ...p,
      platform: toText(p.platform) as PlatformPost['platform'],
      hook: toText(p.hook),
      caption: toText(p.caption),
      hashtags: toHashtags(p.hashtags),
    }));
}
