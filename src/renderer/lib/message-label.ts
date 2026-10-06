import type { ChatUserMessage } from '../stores/messages.svelte.js';
import { withAttachmentLabel } from '../../shared/prompt-text.js';

/** A user message as one line, attachment names first: "[a.ts, b.png] fix it". */
export function userMessageLabel(m: ChatUserMessage): string {
  const names = [
    ...(m.files ?? []).map((f) => f.path),
    ...(m.images ?? []).flatMap((i) => (i.name ? [i.name] : [])),
    ...(m.attachments ?? []).map((a) => a.name),
  ];
  return withAttachmentLabel(names, m.text);
}
