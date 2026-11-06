export type VideoAspectRatio = '16:9' | '9:16';

export type JobStatus =
  | 'pending'
  | 'researching'
  | 'scripting'
  | 'storyboarding'
  | 'generating_characters'
  | 'generating_scenes'
  | 'generating_voice'
  | 'rendering'
  | 'quality_check'
  | 'completed'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';
