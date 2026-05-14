/**
 * 将 Betaflight Blackbox CSV 列名规范化为小写、去空格，便于模糊匹配 gyroADC[0] 等变体。
 */
export function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "");
}
