import OpenAI from "openai";

/**
 * 创建兼容 OpenAI SDK 的客户端：优先 DeepSeek，其次 OpenAI；均未配置时返回 null。
 * 密钥只应放在 .env（勿提交 git）。
 */
export function createLlmClient(): OpenAI | null {
  if (process.env.DEEPSEEK_API_KEY) {
    return new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    });
  }
  if (process.env.OPENAI_API_KEY) {
    return new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    });
  }
  return null;
}

/** 默认模型：DeepSeek 用 deepseek-chat，OpenAI 用 gpt-4o-mini，均可被 LLM_MODEL 覆盖。 */
export function getLlmModel(): string {
  if (process.env.LLM_MODEL?.trim()) return process.env.LLM_MODEL.trim();
  if (process.env.DEEPSEEK_API_KEY) return "deepseek-chat";
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

/** 是否已配置任一 LLM 密钥 */
export function hasLlmCredentials(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY);
}
