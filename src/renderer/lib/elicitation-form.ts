import type { McpElicitationResponse } from '../../shared/types.js';

/**
 * Turn an MCP elicitation's `requestedSchema` into form fields and back.
 * The MCP spec limits the schema to a flat object whose properties are
 * strings (optionally with a format), numbers, integers, booleans, single
 * choice enums (`enum` + `enumNames`, or `oneOf` of `{ const, title }`) and
 * multi-choice arrays of enum strings.
 */

export interface ElicitationOption {
  value: string;
  label: string;
}

interface FieldBase {
  key: string;
  label: string;
  description?: string;
  required: boolean;
}

export type ElicitationField =
  | FieldBase & { kind: 'text'; inputType: 'text' | 'email' | 'url' | 'date' | 'datetime-local'; minLength?: number; maxLength?: number; default?: string }
  | FieldBase & { kind: 'number'; integer: boolean; minimum?: number; maximum?: number; default?: number }
  | FieldBase & { kind: 'boolean'; default?: boolean }
  | FieldBase & { kind: 'select'; options: ElicitationOption[]; default?: string }
  | FieldBase & { kind: 'multiselect'; options: ElicitationOption[]; minItems?: number; maxItems?: number; default?: string[] };

/** What the form holds while the user types: text and number inputs stay strings. */
export type ElicitationValues = Record<string, string | boolean | string[] | undefined>;

type Content = NonNullable<McpElicitationResponse['content']>;

/** Fields for a requested schema. Properties the spec doesn't allow are
 *  listed in `unsupported` so the caller can tell the user. */
export function elicitationFields(schema: Record<string, unknown> | undefined): { fields: ElicitationField[]; unsupported: string[] } {
  const props = isObject(schema?.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((r): r is string => typeof r === 'string') : []);
  const fields: ElicitationField[] = [];
  const unsupported: string[] = [];
  for (const [key, raw] of Object.entries(props)) {
    if (!isObject(raw)) { unsupported.push(key); continue; }
    const base: FieldBase = {
      key,
      label: typeof raw.title === 'string' && raw.title ? raw.title : key,
      ...(typeof raw.description === 'string' && raw.description ? { description: raw.description } : {}),
      required: required.has(key),
    };
    const field = toField(base, raw);
    if (field) fields.push(field);
    else unsupported.push(key);
  }
  return { fields, unsupported };
}

function toField(base: FieldBase, p: Record<string, unknown>): ElicitationField | null {
  if (p.type === 'string') {
    const options = choiceOptions(p);
    if (options) return { ...base, kind: 'select', options, ...(typeof p.default === 'string' ? { default: p.default } : {}) };
    const format = p.format;
    const inputType = format === 'email' ? 'email' : format === 'uri' ? 'url' : format === 'date' ? 'date' : format === 'date-time' ? 'datetime-local' : 'text';
    return {
      ...base,
      kind: 'text',
      inputType,
      ...(typeof p.minLength === 'number' ? { minLength: p.minLength } : {}),
      ...(typeof p.maxLength === 'number' ? { maxLength: p.maxLength } : {}),
      ...(typeof p.default === 'string' ? { default: p.default } : {}),
    };
  }
  if (p.type === 'number' || p.type === 'integer') {
    return {
      ...base,
      kind: 'number',
      integer: p.type === 'integer',
      ...(typeof p.minimum === 'number' ? { minimum: p.minimum } : {}),
      ...(typeof p.maximum === 'number' ? { maximum: p.maximum } : {}),
      ...(typeof p.default === 'number' ? { default: p.default } : {}),
    };
  }
  if (p.type === 'boolean') {
    return { ...base, kind: 'boolean', ...(typeof p.default === 'boolean' ? { default: p.default } : {}) };
  }
  if (p.type === 'array' && isObject(p.items)) {
    const options = choiceOptions(p.items);
    if (!options) return null;
    return {
      ...base,
      kind: 'multiselect',
      options,
      ...(typeof p.minItems === 'number' ? { minItems: p.minItems } : {}),
      ...(typeof p.maxItems === 'number' ? { maxItems: p.maxItems } : {}),
      ...(Array.isArray(p.default) ? { default: p.default.filter((d): d is string => typeof d === 'string') } : {}),
    };
  }
  return null;
}

/** Choices from `enum` (+ `enumNames`) or `oneOf`/`anyOf` of `{ const, title }`. */
function choiceOptions(p: Record<string, unknown>): ElicitationOption[] | null {
  if (Array.isArray(p.enum)) {
    const names = Array.isArray(p.enumNames) ? p.enumNames : [];
    return p.enum.filter((v): v is string => typeof v === 'string')
      .map((value, i) => ({ value, label: typeof names[i] === 'string' ? names[i] : value }));
  }
  const list = Array.isArray(p.oneOf) ? p.oneOf : Array.isArray(p.anyOf) ? p.anyOf : null;
  if (!list) return null;
  const options = list.filter(isObject).filter((o) => typeof o.const === 'string')
    .map((o) => ({ value: o.const as string, label: typeof o.title === 'string' && o.title ? o.title : (o.const as string) }));
  return options.length > 0 ? options : null;
}

/** Starting values: each field's default, else empty. */
export function initialElicitationValues(fields: ElicitationField[]): ElicitationValues {
  const values: ElicitationValues = {};
  for (const f of fields) {
    if (f.kind === 'boolean') values[f.key] = f.default ?? false;
    else if (f.kind === 'multiselect') values[f.key] = f.default ?? [];
    else if (f.kind === 'number') values[f.key] = f.default !== undefined ? String(f.default) : '';
    else values[f.key] = f.default ?? '';
  }
  return values;
}

/** Validate the form and build the response content. Empty optional fields
 *  are left out. Returns per-field errors when anything is invalid. */
export function elicitationContent(fields: ElicitationField[], values: ElicitationValues): { content: Content } | { errors: Record<string, string> } {
  const content: Content = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.kind === 'boolean') {
      content[f.key] = v === true;
      continue;
    }
    if (f.kind === 'multiselect') {
      const picked = Array.isArray(v) ? v : [];
      if (f.required && picked.length === 0) errors[f.key] = 'Pick at least one';
      else if (f.minItems !== undefined && picked.length > 0 && picked.length < f.minItems) errors[f.key] = `Pick at least ${f.minItems}`;
      else if (f.maxItems !== undefined && picked.length > f.maxItems) errors[f.key] = `Pick at most ${f.maxItems}`;
      else if (picked.length > 0) content[f.key] = picked;
      continue;
    }
    const text = typeof v === 'string' ? v.trim() : '';
    if (!text) {
      if (f.required) errors[f.key] = 'Required';
      continue;
    }
    if (f.kind === 'number') {
      const n = Number(text);
      if (!Number.isFinite(n)) errors[f.key] = 'Enter a number';
      else if (f.integer && !Number.isInteger(n)) errors[f.key] = 'Enter a whole number';
      else if (f.minimum !== undefined && n < f.minimum) errors[f.key] = `Must be at least ${f.minimum}`;
      else if (f.maximum !== undefined && n > f.maximum) errors[f.key] = `Must be at most ${f.maximum}`;
      else content[f.key] = n;
      continue;
    }
    if (f.kind === 'select') {
      if (!f.options.some((o) => o.value === text)) errors[f.key] = 'Pick one of the options';
      else content[f.key] = text;
      continue;
    }
    if (f.minLength !== undefined && text.length < f.minLength) errors[f.key] = `At least ${f.minLength} characters`;
    else if (f.maxLength !== undefined && text.length > f.maxLength) errors[f.key] = `At most ${f.maxLength} characters`;
    else content[f.key] = text;
  }
  return Object.keys(errors).length > 0 ? { errors } : { content };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
