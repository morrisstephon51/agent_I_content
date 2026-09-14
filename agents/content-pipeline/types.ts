export type Platform = 'instagram' | 'tiktok' | 'facebook' | 'youtube';
export type InputType = 'topic' | 'event' | 'url' | 'document';

export interface PlatformPost {
  platform: Platform;
  hook: string;
  caption: string;
  hashtags: string[];
}

export interface RemotionPayload {
  platform: Platform;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  durationInFrames: number;
  fps: 30;
}

export interface AgentInput {
  topic: string;
  platforms: Platform[];
  inputType: InputType;
  brandId: string;
}

export interface GeneratedContent {
  posts: PlatformPost[];
}

// Maps each platform to its Remotion frame duration at 30fps
export const PLATFORM_FRAMES: Record<Platform, number> = {
  instagram: 150,  // 5s
  tiktok: 180,     // 6s
  facebook: 150,   // 5s
  youtube: 270,    // 9s
};

// Character limits per platform (enforced in the prompt AND in code via enforceCaptionLimit)
export const CAPTION_LIMITS: Record<Platform, number> = {
  instagram: 2200,
  tiktok: 150,
  facebook: 500,
  youtube: 200,
};
