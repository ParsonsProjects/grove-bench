import type { PipelineTemplate } from '../shared/types.js';

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: 'full',
    displayName: 'Full Pipeline',
    description: 'Plan \u2192 Implement \u2192 QA \u2192 Review',
    stages: [
      { role: 'planner', gate: true },
      { role: 'engineer', gate: false },
      { role: 'qa', gate: false },
      { role: 'reviewer', gate: true },
    ],
  },
  {
    id: 'implement-review',
    displayName: 'Implement & Review',
    description: 'Implement \u2192 Review',
    stages: [
      { role: 'engineer', gate: false },
      { role: 'reviewer', gate: true },
    ],
  },
  {
    id: 'implement-qa-review',
    displayName: 'Implement, QA & Review',
    description: 'Implement \u2192 QA \u2192 Review',
    stages: [
      { role: 'engineer', gate: false },
      { role: 'qa', gate: false },
      { role: 'reviewer', gate: true },
    ],
  },
];

export function getTemplate(templateId: string): PipelineTemplate {
  const template = PIPELINE_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    throw new Error(`Unknown pipeline template: ${templateId}`);
  }
  return template;
}
