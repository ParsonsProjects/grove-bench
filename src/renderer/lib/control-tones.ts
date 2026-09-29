import type { ControlTone } from '../../shared/types.js';

/** Theme colours for the tones adapters pick per control option, so no
 *  provider ships CSS classes. Text colour first, then border. */
const TONE_CLASSES: Record<ControlTone, string> = {
  muted: 'text-muted-foreground/50 border-muted-foreground/20',
  neutral: 'text-foreground/80 border-border',
  info: 'text-blue-400 border-blue-400/40',
  warning: 'text-yellow-400 border-yellow-400/40',
  accent: 'text-purple-400 border-purple-400/50',
  'accent-soft': 'text-purple-300/70 border-purple-300/30',
  success: 'text-green-400 border-green-400/40',
  highlight: 'text-cyan-400 border-cyan-400/50',
};

export function toneClass(tone?: ControlTone): string {
  return TONE_CLASSES[tone ?? 'neutral'];
}

/** Just the text colour of a tone. */
export function toneText(tone?: ControlTone): string {
  return toneClass(tone).split(' ')[0];
}
