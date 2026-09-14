import assert from 'node:assert';
import { enforceCaptionLimit } from './generator';
import { CAPTION_LIMITS } from './types';

/**
 * Lightweight assertion runner — this repo has no test framework, so we lean
 * on node:assert and run the file directly with ts-node (see `npm test`).
 */
let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check('short caption is returned unchanged (aside from trim)', () => {
  const s = 'Come learn AI with us this Saturday.';
  assert.strictEqual(enforceCaptionLimit(s, CAPTION_LIMITS.tiktok), s);
});

check('surrounding whitespace is trimmed', () => {
  assert.strictEqual(enforceCaptionLimit('  hello  ', CAPTION_LIMITS.tiktok), 'hello');
});

check('caption exactly at the limit is unchanged', () => {
  const s = 'x'.repeat(CAPTION_LIMITS.tiktok);
  assert.strictEqual(enforceCaptionLimit(s, CAPTION_LIMITS.tiktok), s);
});

check('over-limit caption is truncated to within the limit', () => {
  const s = 'word '.repeat(100); // 500 chars, well over TikTok's 150
  const out = enforceCaptionLimit(s, CAPTION_LIMITS.tiktok);
  assert.ok(
    out.length <= CAPTION_LIMITS.tiktok,
    `expected <= ${CAPTION_LIMITS.tiktok}, got ${out.length}`
  );
  assert.ok(out.endsWith('…'), 'truncated caption should end with an ellipsis');
});

check('truncation happens at a word boundary and stays a prefix', () => {
  const s =
    'The Plug AI is coming to Harvey Illinois this Saturday for a free hands on AI workshop';
  const out = enforceCaptionLimit(s, 40);
  assert.ok(out.length <= 40, `expected <= 40, got ${out.length}`);
  const body = out.slice(0, -1); // drop ellipsis
  assert.ok(!body.endsWith(' '), 'body should not end in a dangling space');
  assert.ok(s.startsWith(body), 'truncated body should be a prefix of the original');
});

check('a single giant word is hard-truncated but still fits', () => {
  const s = 'a'.repeat(300);
  const out = enforceCaptionLimit(s, CAPTION_LIMITS.youtube);
  assert.ok(
    out.length <= CAPTION_LIMITS.youtube,
    `expected <= ${CAPTION_LIMITS.youtube}, got ${out.length}`
  );
  assert.ok(out.endsWith('…'));
});

check('every platform limit clamps a long caption', () => {
  const long = 'Learn AI today. '.repeat(300);
  for (const platform of Object.keys(CAPTION_LIMITS) as (keyof typeof CAPTION_LIMITS)[]) {
    const limit = CAPTION_LIMITS[platform];
    const out = enforceCaptionLimit(long, limit);
    assert.ok(out.length <= limit, `${platform}: ${out.length} > ${limit}`);
  }
});

console.log(`\n✅ ${passed}/${passed} caption-limit tests passed`);
