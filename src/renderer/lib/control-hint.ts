import { CONTROL_IDS, type ControlDescriptor, type ControlOption } from '../../shared/types.js';

/**
 * The line an agent-settings popover shows under its columns: the option
 * under the pointer or keyboard focus, else the current mode. Option
 * descriptions used to be tooltips only, so nobody could tell what a mode
 * did without hovering it.
 */
export function controlHint(
  controls: readonly ControlDescriptor[],
  valueOf: (controlId: string) => string | undefined,
  hovered: ControlOption | null,
): { label: string; description: string } | null {
  if (hovered?.description) return { label: hovered.label, description: hovered.description };
  const mode = controls.find((c) => c.id === CONTROL_IDS.permissionMode);
  if (!mode) return null;
  const value = valueOf(mode.id) ?? mode.default;
  const current = mode.options.find((o) => o.value === value);
  return current?.description ? { label: current.label, description: current.description } : null;
}

export interface ControlSummaryItem {
  id: string;
  label: string;
  tone?: ControlOption['tone'];
}

/**
 * What the Agent settings button shows besides the model: the mode always
 * (with its tone, since it governs what the agent may do), and every other
 * control only when it is off its default. The popover has the full set.
 */
export function controlSummary(
  controls: readonly ControlDescriptor[],
  valueOf: (controlId: string) => string | undefined,
): { mode?: ControlSummaryItem; details: ControlSummaryItem[] } {
  let mode: ControlSummaryItem | undefined;
  const details: ControlSummaryItem[] = [];
  for (const ctl of controls) {
    const value = valueOf(ctl.id) ?? ctl.default;
    const option = ctl.options.find((o) => o.value === value);
    const label = option?.label ?? value;
    if (ctl.id === CONTROL_IDS.permissionMode) mode = { id: ctl.id, label, tone: option?.tone };
    else if (value !== ctl.default) details.push({ id: ctl.id, label });
  }
  return { mode, details };
}
