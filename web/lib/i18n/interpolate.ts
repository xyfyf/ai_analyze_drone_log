/** 将 `meta` 类模板中的 `{key}` 替换为 vars[key] */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}
