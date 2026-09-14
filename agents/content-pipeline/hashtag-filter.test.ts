import assert from 'node:assert';
import { filterTopicHashtags } from './generator';

/**
 * Regression tests for filterTopicHashtags — STRICT RULE #1 enforcement.
 *
 * The generator's prompt tells the model that hashtags "MUST be semantically
 * derived from the topic text only. Do not invent trending tags you cannot
 * verify from the topic." The code even built a `topicWords` set to enforce it —
 * but never used it, so off-topic "reach" tags (#fyp, #viral, #trending) passed
 * straight through the ≤30-char / ≤5-count clamps into Supabase text_outputs and
 * the Remotion payload. This locks the token-based noise filter (and its
 * never-empty safety net) that closes the gap.
 *
 * Dependency-free — run directly with ts-node (see `npm test`).
 */
let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const TOPIC = 'AI literacy workshop this Saturday in Harvey, IL';

check('keeps a tag that contains a topic word (concatenated)', () => {
  // "ailiteracy" contains the topic word "literacy"
  assert.deepStrictEqual(filterTopicHashtags(['ailiteracy'], TOPIC), ['ailiteracy']);
});

check('keeps a tag equal to a topic word', () => {
  assert.deepStrictEqual(filterTopicHashtags(['workshop'], TOPIC), ['workshop']);
});

check('keeps a tag that is a substring of a topic word', () => {
  // "instruct" is contained by the topic word "instructional"
  assert.deepStrictEqual(
    filterTopicHashtags(['instruct'], 'Instructional design tips'),
    ['instruct']
  );
});

check('keeps brand handles regardless of topic', () => {
  assert.deepStrictEqual(
    filterTopicHashtags(['ThePlugAI', 'plugai'], TOPIC),
    ['ThePlugAI', 'plugai']
  );
});

check('drops pure-noise reach tags when topical tags are present', () => {
  const out = filterTopicHashtags(
    ['AILiteracy', 'fyp', 'viral', 'Harvey', 'trending'],
    TOPIC
  );
  assert.deepStrictEqual(out, ['AILiteracy', 'Harvey']);
});

check('never empties a non-empty set — falls back to model tags if none verify', () => {
  const noise = ['fyp', 'viral', 'trending'];
  assert.deepStrictEqual(filterTopicHashtags(noise, TOPIC), noise);
});

check('empty input returns empty output', () => {
  assert.deepStrictEqual(filterTopicHashtags([], TOPIC), []);
});

check('matching is case- and punctuation-insensitive', () => {
  assert.deepStrictEqual(filterTopicHashtags(['HARVEY'], TOPIC), ['HARVEY']);
});

check('two-letter topic tokens (ai, il) do not whitelist unrelated tags', () => {
  // "email" would falsely match if 2-letter tokens like "il"/"ai" counted;
  // they are excluded (length > 2), and no other topic word matches -> the lone
  // tag survives only via the never-empty fallback, unchanged.
  assert.deepStrictEqual(filterTopicHashtags(['email'], TOPIC), ['email']);
  // ...but alongside a real topic tag, the off-topic one is dropped.
  assert.deepStrictEqual(filterTopicHashtags(['email', 'workshop'], TOPIC), ['workshop']);
});

console.log(`\n✅ ${passed}/${passed} hashtag-filter tests passed`);
