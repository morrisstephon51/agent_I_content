#!/usr/bin/env ts-node
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { AgentInput, Platform, InputType } from './types';
import { generateContent } from './generator';
import { insertContentItem } from './supabase-insert';

const ALL_PLATFORMS: Platform[] = ['instagram', 'tiktok', 'facebook', 'youtube'];

function parseArgs(): AgentInput {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Usage:
  npx ts-node agents/content-pipeline/index.ts "<topic>" [platforms] [input_type]

Arguments:
  topic        Required. 1–3 sentence description of the topic or event.
  platforms    Optional. Comma-separated: instagram,tiktok,facebook,youtube (default: all)
  input_type   Optional. One of: topic, event, url, document (default: topic)

Examples:
  npx ts-node agents/content-pipeline/index.ts "AI literacy workshop this Saturday in Harvey, IL"
  npx ts-node agents/content-pipeline/index.ts "ChatGPT basics for job seekers" "instagram,tiktok" topic
  npx ts-node agents/content-pipeline/index.ts "South Suburban AI Summit 2026" "all" event
`);
    process.exit(0);
  }

  const topic = args[0];
  if (!topic || topic.trim().length === 0) {
    console.error('Error: topic is required as the first argument.');
    process.exit(1);
  }

  const rawPlatforms = args[1] ?? 'all';
  let platforms: Platform[];
  if (rawPlatforms === 'all' || !rawPlatforms) {
    platforms = ALL_PLATFORMS;
  } else {
    platforms = rawPlatforms.split(',').map((p) => p.trim().toLowerCase()) as Platform[];
    const invalid = platforms.filter((p) => !ALL_PLATFORMS.includes(p));
    if (invalid.length > 0) {
      console.error(`Error: Invalid platforms: ${invalid.join(', ')}. Must be one of: ${ALL_PLATFORMS.join(', ')}`);
      process.exit(1);
    }
  }

  const rawInputType = (args[2] ?? 'topic').toLowerCase();
  const validInputTypes: InputType[] = ['topic', 'event', 'url', 'document'];
  if (!validInputTypes.includes(rawInputType as InputType)) {
    console.error(`Error: Invalid input_type "${rawInputType}". Must be one of: ${validInputTypes.join(', ')}`);
    process.exit(1);
  }

  const brandId = process.env.BRAND_ID ?? 'e47a6396-8a4e-4dcf-a511-b9f3878ef398';

  return {
    topic: topic.trim(),
    platforms,
    inputType: rawInputType as InputType,
    brandId,
  };
}

function checkEnv(): { supabaseUrl: string; serviceRoleKey: string; anthropicKey: string } {
  const missing: string[] = [];
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';

  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!anthropicKey) missing.push('ANTHROPIC_API_KEY');

  if (missing.length > 0) {
    console.error(`\n❌ Missing required environment variables:\n  ${missing.join('\n  ')}`);
    console.error('\nCopy .env.example → .env and fill in your keys.');
    process.exit(1);
  }

  return { supabaseUrl, serviceRoleKey, anthropicKey };
}

function printPreview(input: AgentInput, content: { posts: { platform: string; hook: string; caption: string; hashtags: string[] }[] }, recordId: string): void {
  const divider = '─'.repeat(60);

  console.log(`\n✅ Content generated and queued`);
  console.log(`   Record ID : ${recordId}`);
  console.log(`   Topic     : ${input.topic}`);
  console.log(`   Type      : ${input.inputType}`);
  console.log(`   Platforms : ${input.platforms.join(', ')}`);
  console.log(`   Status    : pending_approval\n`);

  for (const post of content.posts) {
    console.log(divider);
    console.log(`📱 ${post.platform.toUpperCase()}`);
    console.log(`\nHOOK:\n${post.hook}`);
    console.log(`\nCAPTION:\n${post.caption}`);
    console.log(`\nHASHTAGS: ${post.hashtags.map((h) => `#${h}`).join(' ')}`);
  }

  console.log(`\n${divider}`);
  console.log(`\n🎬 Remotion payloads saved to video_outputs in content_items.`);
  console.log(`   View in Supabase: https://supabase.com/dashboard/project/fqdrvhpdntflfkqxlvkq/editor\n`);
}

async function main(): Promise<void> {
  const input = parseArgs();
  const env = checkEnv();

  console.log(`\n🔄 Generating content for: "${input.topic}"`);
  console.log(`   Platforms: ${input.platforms.join(', ')}`);

  const client = new Anthropic({ apiKey: env.anthropicKey });

  const content = await generateContent(input, client);

  console.log(`\n💾 Inserting into Supabase content_items...`);
  const recordId = await insertContentItem(
    input,
    content,
    env.supabaseUrl,
    env.serviceRoleKey
  );

  printPreview(input, content, recordId);
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
