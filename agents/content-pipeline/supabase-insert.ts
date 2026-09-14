import { createClient } from '@supabase/supabase-js';
import {
  AgentInput,
  GeneratedContent,
  Platform,
  PlatformPost,
  RemotionPayload,
  PLATFORM_FRAMES,
} from './types';

// The only platforms we can actually render — those with a frame duration.
// Derived from PLATFORM_FRAMES so the guard tracks the canonical map instead of
// drifting from a second hand-maintained list.
const RENDERABLE_PLATFORMS = new Set<Platform>(
  Object.keys(PLATFORM_FRAMES) as Platform[]
);

/**
 * Normalize and validate the platform on every generated post before it is
 * persisted.
 *
 * The generator's prompt pins each post's `platform` to one of the four
 * supported values, but nothing enforced that in code. A drifted or differently
 * cased platform — the model very plausibly returns "YouTube" or "Instagram"
 * since the requested platforms are lowercased upstream — indexes
 * PLATFORM_FRAMES[...] as `undefined`, so the Remotion payload's
 * `durationInFrames` becomes undefined. Because JSON.stringify drops undefined
 * fields, that duration silently vanishes from the video_outputs row written to
 * Supabase, leaving an unrenderable record with no way to know why.
 *
 * We recover the common case by trimming and lowercasing the platform (so
 * "YouTube" -> "youtube") and only drop a post when the platform is still
 * unknown, warning as we go — mirroring the sanitize-don't-crash contract the
 * caption and hashtag clamps already use. Throws only if nothing renderable
 * remains, matching the generator's existing fail-loud handling of malformed
 * responses.
 */
export function normalizeRenderablePosts(posts: PlatformPost[]): PlatformPost[] {
  const renderable: PlatformPost[] = [];

  for (const post of posts) {
    const normalized = String(post.platform).trim().toLowerCase() as Platform;
    if (RENDERABLE_PLATFORMS.has(normalized)) {
      renderable.push(
        normalized === post.platform ? post : { ...post, platform: normalized }
      );
    } else {
      console.warn(
        `⚠️  Skipping post with unsupported platform "${post.platform}" — ` +
          `no frame duration is defined for it, so it cannot be rendered.`
      );
    }
  }

  if (renderable.length === 0) {
    throw new Error('No posts with a supported platform to insert');
  }

  return renderable;
}

function buildRemotionPayloads(
  input: AgentInput,
  content: GeneratedContent
): RemotionPayload[] {
  return content.posts.map((post) => ({
    platform: post.platform as Platform,
    title: post.hook,
    hook: post.hook,
    caption: post.caption,
    hashtags: post.hashtags,
    durationInFrames: PLATFORM_FRAMES[post.platform as Platform],
    fps: 30,
  }));
}

export async function insertContentItem(
  input: AgentInput,
  content: GeneratedContent,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<string> {
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Drop / normalize any post whose platform we cannot render before it is
  // persisted, so PLATFORM_FRAMES lookups below never yield undefined frames.
  const posts = normalizeRenderablePosts(content.posts);

  const remotionPayloads = buildRemotionPayloads(input, { posts });

  // text_outputs: keyed by platform for easy lookup
  const textOutputs: Record<string, object> = {};
  for (const post of posts) {
    textOutputs[post.platform] = {
      hook: post.hook,
      caption: post.caption,
      hashtags: post.hashtags,
    };
  }

  const { data, error } = await supabase
    .from('content_items')
    .insert({
      brand_id: input.brandId,
      input_topic: input.topic,
      input_type: input.inputType,
      text_outputs: textOutputs,
      video_outputs: remotionPayloads,
      render_status: 'pending',
      status: 'pending_approval',
      tags: input.platforms,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }

  return data.id as string;
}
