export interface ModelChoice {
  value: string;
  label: string;
}

/** Select value for "no default model set". New conversations then start on
 *  the adapter's first model (see AgentSessionManager). The Select can't hold
 *  an empty string, so this stands in for `defaultModel: ''`. */
export const DEFAULT_MODEL_VALUE = '__default__';

/**
 * Options for a model picker: "Default" first, then the adapter's models.
 * "Default" names the model it stands for: `defaultId` when given (e.g. the
 * agent's background model), else the first model in the list. Pass `null`
 * when the default isn't known (the agent picks), for a plain "Default". A saved ID
 * that isn't in the list (typed in when the field was free text, or a model
 * since removed) stays selectable so it isn't silently dropped. It is only
 * added once the list has loaded, so it doesn't flash "custom" while the
 * models are still coming in.
 */
export function defaultModelChoices(
  models: ReadonlyArray<{ id: string; label: string }>,
  current: string,
  defaultId?: string | null,
): ModelChoice[] {
  const defaultLabel = defaultId === null
    ? undefined
    : defaultId
      ? (models.find((m) => m.id === defaultId)?.label ?? defaultId)
      : models[0]?.label;
  const choices: ModelChoice[] = [
    { value: DEFAULT_MODEL_VALUE, label: defaultLabel ? `Default (${defaultLabel})` : 'Default' },
    ...models.map((m) => ({ value: m.id, label: m.label })),
  ];
  if (current && models.length > 0 && !models.some((m) => m.id === current)) {
    choices.push({ value: current, label: `${current} (custom)` });
  }
  return choices;
}
