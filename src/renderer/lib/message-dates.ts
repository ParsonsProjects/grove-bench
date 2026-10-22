/**
 * When the user's prompts were sent, as the thread shows it: a time on each
 * prompt, and a divider ("Today", "Yesterday", "21 Oct 2026") where the day
 * changes. Prompts from older history have no time and show neither.
 */
import type { ChatMessage } from '../stores/messages.svelte.js';

/** The local midnight that starts the day `at` (epoch ms) falls on. */
export function dayStart(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A prompt's send time as a clock time in the user's locale ("14:32", "2:32 PM"). */
export function formatSentTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** The divider label for the day `at` falls on, `today` being the start of
 *  the current day (dayStart). */
export function dayLabel(at: number, today: number): string {
  const day = dayStart(at);
  if (day === today) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return 'Yesterday';
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The prompts a day divider goes above, by message id, each with its label:
 * the first prompt with a time, and each one after it sent on another day
 * than the one before. Prompts with no time are passed over.
 */
export function dayDividers(msgs: readonly ChatMessage[], today: number): Map<string, string> {
  const dividers = new Map<string, string>();
  let lastDay: number | undefined;
  for (const msg of msgs) {
    if (msg.kind !== 'user' || msg.sentAt === undefined) continue;
    const day = dayStart(msg.sentAt);
    if (day !== lastDay) dividers.set(msg.id, dayLabel(msg.sentAt, today));
    lastDay = day;
  }
  return dividers;
}
