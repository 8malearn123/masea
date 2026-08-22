/** Replace {{variables}} in a clause template with provided values. */
export function renderClause(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function renderClauses(templates: string[], vars: Record<string, string>): string[] {
  return templates.map((t) => renderClause(t, vars));
}
