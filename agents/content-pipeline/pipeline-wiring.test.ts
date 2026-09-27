/**
 * Wiring guard — proves the sanitizers are ON THE PRODUCTION CODE PATH.
 *
 * Why this file exists
 * --------------------
 * Three fixes added an exported, well-tested pure helper:
 *
 *   enforceCaptionLimit      (caption-limit.test.ts)
 *   filterTopicHashtags      (hashtag-filter.test.ts)
 *   normalizeRenderablePosts (platform-validation.test.ts)
 *
 * Every one of those suites imports its helper directly and exercises it in
 * isolation. None of them asserts that `generateContent` / `insertContentItem`
 * actually CALL it. Measured: unhook all three call sites — leaving the helpers
 * defined, exported and unchanged — and `tsc --noEmit` is clean and the whole
 * suite still reports green. The guards cannot see the regression that matters
 * most, which is a later refactor quietly dropping the call.
 *
 * That is not hypothetical here. The original issue #3 WAS a wiring bug: the
 * `topicWords` set was computed in `generateContent` and then never used. The
 * fix rebuilt the helper but reproduced the same blind spot in its coverage.
 *
 * So these tests drive the real entrypoints through injected fakes (a stub
 * Anthropic client; a monkeypatched `createClient`) and assert on the OUTPUT.
 * They are deliberately agnostic about WHICH helper does the work — they only
 * require that the pipeline's observable contract holds end to end.
 */
import assert from 'node:assert';
import type Anthropic from '@anthropic-ai/sdk';
import { AgentInput, CAPTION_LIMITS, PlatformPost, RemotionPayload } from './types';

const results: string[] = [];
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    results.push(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    results.push(`  ✗ ${name}\n    ${(err as Error).message.split('\n').join('\n    ')}`);
  }
}

const TOPIC = 'AI literacy workshop in Harvey';

const INPUT: AgentInput = {
  topic: TOPIC,
  platforms: ['tiktok'],
  inputType: 'topic',
  brandId: 'test-brand',
};

/** Stub Anthropic client that returns exactly the posts we hand it. */
function stubClient(posts: unknown[]): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ posts }) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  } as unknown as Anthropic;
}

/**
 * Monkeypatch `@supabase/supabase-js` before `supabase-insert` is required, so
 * `insertContentItem` builds against our fake and we can capture the row it
 * would have persisted. Module format is commonjs (see tsconfig), so mutating
 * the cached module's export is enough.
 */
function captureInsertedRow(): {
  run: (posts: PlatformPost[]) => Promise<Record<string, unknown>>;
} {
  const supabaseModule = require('@supabase/supabase-js');
  const realCreateClient = supabaseModule.createClient;
  let captured: Record<string, unknown> = {};

  supabaseModule.createClient = () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        captured = row;
        return {
          select: () => ({
            single: async () => ({ data: { id: 'row-id' }, error: null }),
          }),
        };
      },
    }),
  });

  // Required AFTER the patch so the module binds to the fake.
  const { insertContentItem } = require('./supabase-insert');

  return {
    run: async (posts: PlatformPost[]) => {
      try {
        await insertContentItem(INPUT, { posts }, 'https://stub.supabase.co', 'stub-key');
        return captured;
      } finally {
        supabaseModule.createClient = realCreateClient;
      }
    },
  };
}

async function main(): Promise<void> {
  const { generateContent } = require('./generator');

  // --- generateContent: caption clamp is wired ------------------------------
  await test('generateContent clamps an over-limit caption (enforceCaptionLimit is wired)', async () => {
    const longCaption = 'we teach AI literacy in Harvey every saturday '.repeat(12);
    assert.ok(longCaption.length > CAPTION_LIMITS.tiktok, 'fixture must exceed the limit');

    const out = await generateContent(
      INPUT,
      stubClient([
        { platform: 'tiktok', hook: 'h', caption: longCaption, hashtags: ['ailiteracy'] },
      ])
    );

    assert.ok(
      out.posts[0].caption.length <= CAPTION_LIMITS.tiktok,
      `caption reached the pipeline output at ${out.posts[0].caption.length} chars, ` +
        `over the ${CAPTION_LIMITS.tiktok}-char tiktok limit — the caption clamp is ` +
        `defined but not called by generateContent`
    );
  });

  // --- generateContent: topic hashtag filter is wired -----------------------
  await test('generateContent drops non-topical reach tags (filterTopicHashtags is wired)', async () => {
    const out = await generateContent(
      INPUT,
      stubClient([
        {
          platform: 'tiktok',
          hook: 'h',
          caption: 'short',
          hashtags: ['fyp', 'viral', 'trending', 'ailiteracy', 'harvey'],
        },
      ])
    );

    const tags: string[] = out.posts[0].hashtags;
    for (const noise of ['fyp', 'viral', 'trending']) {
      assert.ok(
        !tags.includes(noise),
        `non-topical tag "${noise}" survived into the pipeline output (${JSON.stringify(tags)}) — ` +
          `STRICT RULE #1 is enforced in the helper but not called by generateContent`
      );
    }
    assert.ok(tags.includes('ailiteracy'), 'topical tags must be kept');
  });

  // --- insertContentItem: platform validation is wired ----------------------
  await test('insertContentItem normalizes platform casing before persisting', async () => {
    const row = await captureInsertedRow().run([
      { platform: 'YouTube' as PlatformPost['platform'], hook: 'h', caption: 'c', hashtags: [] },
    ]);

    const payloads = row.video_outputs as RemotionPayload[];
    assert.equal(payloads.length, 1);
    assert.equal(
      payloads[0].platform,
      'youtube',
      'conventionally cased "YouTube" must be recovered, not persisted as-is'
    );
  });

  await test('insertContentItem drops an unrenderable platform before persisting', async () => {
    const row = await captureInsertedRow().run([
      { platform: 'linkedin' as PlatformPost['platform'], hook: 'h', caption: 'c', hashtags: [] },
      { platform: 'instagram', hook: 'h', caption: 'c', hashtags: [] },
    ]);

    const payloads = row.video_outputs as RemotionPayload[];
    assert.deepEqual(
      payloads.map((p) => p.platform),
      ['instagram'],
      'a platform with no frame duration must not reach video_outputs'
    );
    assert.deepEqual(
      Object.keys(row.text_outputs as Record<string, unknown>),
      ['instagram'],
      'text_outputs must be filtered in step with video_outputs'
    );
  });

  // The exact mechanism of issue #5: an undefined durationInFrames is not a
  // visible null in the persisted row — JSON.stringify deletes the key outright,
  // so the row looks structurally fine and is simply unrenderable.
  await test('durationInFrames survives JSON serialization for every persisted payload', async () => {
    const row = await captureInsertedRow().run([
      { platform: 'YouTube' as PlatformPost['platform'], hook: 'h', caption: 'c', hashtags: [] },
      { platform: 'instagram', hook: 'h', caption: 'c', hashtags: [] },
    ]);

    const serialized = JSON.parse(JSON.stringify(row.video_outputs)) as RemotionPayload[];
    serialized.forEach((payload, i) => {
      assert.equal(
        typeof payload.durationInFrames,
        'number',
        `video_outputs[${i}] (platform "${payload.platform}") lost durationInFrames on ` +
          `serialization — PLATFORM_FRAMES was indexed with an unvalidated platform`
      );
    });
  });

  await test('insertContentItem still fails loud when nothing is renderable', async () => {
    await assert.rejects(
      () =>
        captureInsertedRow().run([
          { platform: 'linkedin' as PlatformPost['platform'], hook: 'h', caption: 'c', hashtags: [] },
        ]),
      /supported platform/i,
      'an all-unrenderable batch must throw, not persist an empty row'
    );
  });

  console.log(results.join('\n'));
  if (failed > 0) {
    console.error(`\n❌ ${failed}/${results.length} pipeline-wiring tests failed`);
    process.exit(1);
  }
  console.log(`\n✅ ${results.length}/${results.length} pipeline-wiring tests passed`);
}

main();
