import assert from 'node:assert';
import { normalizeRenderablePosts } from './supabase-insert';
import { PlatformPost } from './types';

/**
 * Regression tests for normalizeRenderablePosts — platform validation before
 * a content item is persisted.
 *
 * The generator's prompt pins each post's `platform` to one of the four
 * supported values, but nothing enforced it. A miscased ("YouTube") or drifted
 * ("linkedin") platform indexes PLATFORM_FRAMES[...] as undefined, so the
 * Remotion payload's `durationInFrames` becomes undefined — and JSON.stringify
 * drops undefined, silently persisting an unrenderable video_outputs row. This
 * locks the normalize-then-validate guard that closes the gap.
 *
 * Dependency-free — run directly with ts-node
 * (npx ts-node agents/content-pipeline/platform-validation.test.ts).
 */
let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function post(platform: string): PlatformPost {
  return {
    platform: platform as PlatformPost['platform'],
    hook: `hook for ${platform}`,
    caption: `caption for ${platform}`,
    hashtags: ['plugai'],
  };
}

check('valid lowercase platforms pass through unchanged', () => {
  const input = [post('instagram'), post('tiktok'), post('facebook'), post('youtube')];
  const out = normalizeRenderablePosts(input);
  assert.deepStrictEqual(
    out.map((p) => p.platform),
    ['instagram', 'tiktok', 'facebook', 'youtube']
  );
  // Unchanged posts keep their identity (no needless copy).
  assert.strictEqual(out[0], input[0]);
});

check('conventionally cased "YouTube" is recovered, not dropped', () => {
  const out = normalizeRenderablePosts([post('YouTube')]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].platform, 'youtube');
});

check('surrounding whitespace and caps are normalized', () => {
  const out = normalizeRenderablePosts([post('  Instagram  ')]);
  assert.strictEqual(out[0].platform, 'instagram');
});

check('normalizing preserves the other fields verbatim', () => {
  const out = normalizeRenderablePosts([post('TikTok')]);
  assert.deepStrictEqual(out[0], {
    platform: 'tiktok',
    hook: 'hook for TikTok',
    caption: 'caption for TikTok',
    hashtags: ['plugai'],
  });
});

check('an unknown platform is dropped while renderable ones survive', () => {
  const out = normalizeRenderablePosts([post('instagram'), post('linkedin'), post('youtube')]);
  assert.deepStrictEqual(
    out.map((p) => p.platform),
    ['instagram', 'youtube']
  );
});

check('durationInFrames can never be undefined for a returned post', () => {
  // Every surviving platform is a PLATFORM_FRAMES key by construction, which is
  // the exact invariant the buggy path violated.
  const out = normalizeRenderablePosts([post('YouTube'), post('threads'), post('facebook')]);
  assert.deepStrictEqual(
    out.map((p) => p.platform),
    ['youtube', 'facebook']
  );
});

check('throws when no post has a supported platform', () => {
  assert.throws(
    () => normalizeRenderablePosts([post('linkedin'), post('threads')]),
    /No posts with a supported platform/
  );
});

check('empty input throws (nothing renderable to insert)', () => {
  assert.throws(() => normalizeRenderablePosts([]), /No posts with a supported platform/);
});

console.log(`\n✅ ${passed}/${passed} platform-validation tests passed`);
