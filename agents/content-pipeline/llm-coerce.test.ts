/**
 * Model JSON shape guard. Run: npx ts-node agents/content-pipeline/llm-coerce.test.ts
 * Exits non-zero on any failure.
 */
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { coercePosts, extractJson } from './coerce';
import { generateContent } from './generator';
import { AgentInput } from './types';

let failed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}

function fakeClient(text: string): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  } as unknown as Anthropic;
}

const input: AgentInput = {
  topic: 'AI literacy workshop',
  platforms: ['instagram', 'tiktok'],
  inputType: 'topic',
  brandId: 'test',
};

(async () => {
  await check('extractJson: plain, ```json, bare ``` fence, and leading prose', () => {
    for (const raw of [
      '{"posts":[]}',
      '```json\n{"posts":[]}\n```',
      '```\n{"posts":[]}\n```',
      'Here you go:\n{"posts":[]}\nHope this helps!',
    ]) {
      assert.deepEqual(extractJson(raw), { posts: [] }, raw);
    }
  });

  await check('extractJson: garbage throws a clear error', () => {
    assert.throws(() => extractJson('sorry, I cannot'), /not valid JSON/);
  });

  await check('coercePosts: missing posts array still throws', () => {
    assert.throws(() => coercePosts({}), /missing posts array/);
    assert.throws(() => coercePosts(null), /missing posts array/);
  });

  await check('coercePosts: string hashtags are split, numbers kept, junk dropped', () => {
    const [a, b, c] = coercePosts({
      posts: [
        { platform: 'instagram', hook: 'h', caption: 'c', hashtags: '#ai #community, #chicago' },
        { platform: 'tiktok', hook: 'h', caption: 'c', hashtags: ['ai', 2026, null, { x: 1 }] },
        { platform: 'facebook', hook: 'h', caption: 'c' },
      ],
    });
    assert.deepEqual(a.hashtags, ['#ai', '#community', '#chicago']);
    assert.deepEqual(b.hashtags, ['ai', '2026']);
    assert.deepEqual(c.hashtags, []);
  });

  await check('coercePosts: non-object posts dropped, missing text fields become strings', () => {
    const posts = coercePosts({ posts: [null, 'x', [], { platform: 'youtube' }] });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].caption, '');
    assert.equal(posts[0].hook, '');
  });

  // Call-site contract: these replies made generateContent throw before the fix.
  await check('generateContent survives string hashtags (was: post.hashtags.map is not a function)', async () => {
    const reply = JSON.stringify({
      posts: [
        { platform: 'instagram', hook: 'h', caption: 'c', hashtags: '#ai #literacy' },
        { platform: 'tiktok', hook: 'h', caption: 'c', hashtags: ['#workshop'] },
      ],
    });
    const out = await generateContent(input, fakeClient(reply));
    assert.equal(out.posts.length, 2);
    assert.deepEqual(out.posts[0].hashtags, ['ai', 'literacy']);
    assert.deepEqual(out.posts[1].hashtags, ['workshop']);
  });

  await check('generateContent survives a post with no hashtags and a numeric tag', async () => {
    const reply = JSON.stringify({
      posts: [
        { platform: 'instagram', hook: 'h', caption: 'c' },
        { platform: 'tiktok', hook: 'h', caption: 'c', hashtags: [2026, 'ai'] },
      ],
    });
    const out = await generateContent(input, fakeClient(reply));
    assert.deepEqual(out.posts[0].hashtags, []);
    assert.deepEqual(out.posts[1].hashtags, ['2026', 'ai']);
  });

  await check('generateContent accepts a bare ``` fence with prose around it', async () => {
    const reply = 'Sure!\n```\n' + JSON.stringify({ posts: [{ platform: 'instagram', hook: 'h', caption: 'c', hashtags: ['ai'] }] }) + '\n```';
    const out = await generateContent(input, fakeClient(reply));
    assert.equal(out.posts.length, 1);
  });

  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nall checks passed');
})();
