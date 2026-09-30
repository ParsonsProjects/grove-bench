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
