import type { ParsedBlackbox } from "@/lib/blackbox/parse-csv";
import { parseBlackboxCsv } from "@/lib/blackbox/parse-csv";
import { parseArduPilotBin } from "@/lib/blackbox/parse-ardupilot-bin";
import { parsePx4Ulog } from "@/lib/blackbox/parse-px4-ulog";

/**
 * 按扩展名选择解析器：`.csv` 文本（Betaflight / 各栈导出表）、`.bin`（ArduPilot DataFlash）、`.ulg`（PX4 ULog）。
 */
export async function parseFlightLog(bytes: Uint8Array, fileName: string): Promise<ParsedBlackbox> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".ulg")) return parsePx4Ulog(bytes);
  if (lower.endsWith(".bin")) return parseArduPilotBin(bytes);
  const text = new TextDecoder("utf-8").decode(bytes);
  return parseBlackboxCsv(text);
}
