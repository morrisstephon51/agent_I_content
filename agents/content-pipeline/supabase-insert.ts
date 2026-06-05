import { createClient } from '@supabase/supabase-js';
import {
  AgentInput,
  GeneratedContent,
  Platform,
  RemotionPayload,
  PLATFORM_FRAMES,
} from './types';

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

  const remotionPayloads = buildRemotionPayloads(input, content);

  // text_outputs: keyed by platform for easy lookup
  const textOutputs: Record<string, object> = {};
  for (const post of content.posts) {
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
