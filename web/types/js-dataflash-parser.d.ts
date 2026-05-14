declare module "js-dataflash-parser" {
  /** 与 UAVLogViewer 同源的 ArduPilot DataFlash 解析（支持 0xA3 0x95 新日志头） */
  export class DataflashParser {
    processData(
      data: ArrayBuffer,
      /** 若指定则只解析这些类型（减轻大文件内存与时间） */
      msgs?: string[],
    ): {
      messageTypes: string[];
      messages: Record<string, unknown>[];
      error?: string;
    };
  }
}
