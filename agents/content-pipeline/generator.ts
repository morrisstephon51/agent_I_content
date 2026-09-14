import Anthropic from '@anthropic-ai/sdk';
import {
  AgentInput,
  GeneratedContent,
  Platform,
  PlatformPost,
  CAPTION_LIMITS,
} from './types';

const BRAND_VOICE = `
Brand: The Plug AI
Mission: Close the gap between who has access to AI and who needs it most — equipping everyday people, community leaders, and underserved organizations in Chicago's south suburbs with AI tools, skills, and confidence.
Tone: Community-first, Gen Z energy, direct and empowering. No corporate speak. Short sentences. Use "we" and "you." Make AI feel approachable, not intimidating.
Audience: Black and brown youth, community organizers, parents, and educators in underserved south suburban Chicago communities aged 16–35.
`.trim();

const PLATFORM_GUIDELINES: Record<Platform, string> = {
  instagram: 'Hook must be a bold 1-liner that stops the scroll. Caption uses line breaks, 3–5 bullets max, strong CTA. 3–5 hashtags only.',
  tiktok: 'Hook must be the first spoken line — curiosity-gap or bold claim under 10 words. Caption is ultra-short (under 150 chars). 3–5 hashtags.',
  facebook: 'Hook is a question or surprising stat. Caption reads like a community post — warm, conversational, invites comments. 2–3 hashtags.',
  youtube: 'Hook is the video title styled as a promise ("How to..." or "Why..."). Caption is a short description under 200 chars. 3 hashtags.',
};

/**
 * Enforce a platform caption character limit in code.
 *
 * The prompt asks the model to respect CAPTION_LIMITS, but LLMs routinely
 * overshoot the tighter limits (TikTok 150, YouTube 200). An over-length
 * caption would otherwise flow straight into Supabase text_outputs and the
 * Remotion video payload, breaking the video layout or getting rejected by
 * the platform at publish time — so we clamp it here, the same way hashtags
 * are already clamped below.
 *
 * Truncates at a word boundary where possible and appends an ellipsis, and
 * always returns a string whose length is <= `limit`.
 */
export function enforceCaptionLimit(caption: string, limit: number): string {
  const trimmed = caption.trim();
  if (trimmed.length <= limit) return trimmed;

  const ELLIPSIS = '\u2026'; // single UTF-16 code unit, so length 1
  const budget = limit - ELLIPSIS.length;
  if (budget <= 0) {
    // Pathologically small limit - hard-truncate to fit.
    return trimmed.slice(0, limit);
  }

  const slice = trimmed.slice(0, budget);
  // Prefer cutting at the last space so we don't split a word mid-way.
  const lastSpace = slice.lastIndexOf(' ');
  const body = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${body.trimEnd()}${ELLIPSIS}`;
}

function buildPrompt(input: AgentInput): string {
  const platformList = input.platforms
    .map((p) => `- ${p.toUpperCase()}: ${PLATFORM_GUIDELINES[p]}`)
    .join('\n');

  const captionLimits = input.platforms
    .map((p) => `${p}: ${CAPTION_LIMITS[p]} chars max`)
    .join(', ');

  return `You are a social media content strategist for The Plug AI.

BRAND VOICE:
${BRAND_VOICE}

TASK:
Generate platform-specific social media content for the following topic.

TOPIC: ${input.topic}
INPUT TYPE: ${input.inputType}

PLATFORM REQUIREMENTS:
${platformList}

CAPTION LIMITS: ${captionLimits}

STRICT RULES:
1. Hashtags MUST be semantically derived from the topic text only. Do not invent trending tags you cannot verify from the topic.
2. No hashtags longer than 30 characters.
3. No more than 5 hashtags per platform.
4. Hooks must be platform-native — not generic.
5. Never use corporate jargon. Write like a trusted community member.

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences, no extra text:
{
  "posts": [
    {
      "platform": "instagram",
      "hook": "...",
      "caption": "...",
      "hashtags": ["...", "..."]
    }
  ]
}

Generate one object per platform in this order: ${input.platforms.join(', ')}.`;
}

export async function generateContent(
  input: AgentInput,
  client: Anthropic
): Promise<GeneratedContent> {
  const prompt = buildPrompt(input);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = (response.content[0] as { type: string; text: string }).text.trim();

  let parsed: { posts: PlatformPost[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Strip any accidental markdown fences if model adds them
    const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    parsed = JSON.parse(cleaned);
  }

  if (!parsed.posts || !Array.isArray(parsed.posts)) {
    throw new Error('Claude response missing posts array');
  }

  // Validate hashtags contain no banned patterns (non-topic noise)
  const topicWords = new Set(
    input.topic
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ''))
      .filter((w) => w.length > 2)
  );

  parsed.posts = parsed.posts.map((post) => {
    const limit = CAPTION_LIMITS[post.platform];
    const caption = enforceCaptionLimit(post.caption, limit);
    if (caption.length < post.caption.trim().length) {
      console.warn(
        `\u26a0\ufe0f  ${post.platform} caption exceeded ${limit} chars ` +
          `(model returned ${post.caption.trim().length}) \u2014 truncated to fit.`
      );
    }

    return {
      ...post,
      caption,
      hashtags: post.hashtags
        .map((h) => h.replace(/^#/, '').replace(/\s+/g, ''))
        .filter((h) => h.length <= 30)
        .slice(0, 5),
    };
  });

  // Log token usage for cost awareness
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const estimatedCost =
    (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0;
  console.log(
    `\n📊 Token usage: ${inputTokens} in / ${outputTokens} out — est. $${estimatedCost.toFixed(4)}`
  );

  return { posts: parsed.posts };
}
