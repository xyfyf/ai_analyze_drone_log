import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export type LlmProvider = "anthropic" | "deepseek" | "openai";

/**
 * 统一抽象：所有调用方只用 `chatJson()`，不直接接触各家 SDK，
 * 切换 provider（DeepSeek / Anthropic Claude / OpenAI）时业务代码无感。
 */
export interface LlmChatClient {
  provider: LlmProvider;
  modelName: string;
  /**
   * 单轮对话，期望模型返回严格 JSON。
   * - OpenAI / DeepSeek：用 `response_format: json_object`
   * - Anthropic：通过 prefill `{` 与系统提示约束
   * 返回值是模型给出的 JSON 字符串（已尽量去除 markdown 代码围栏），
   * 调用方自行 JSON.parse。失败返回 null。
   */
  chatJson(args: {
    system: string;
    user: string;
    maxTokens: number;
    temperature?: number;
  }): Promise<string | null>;
}

function pickProvider(): LlmProvider | null {
  const force = process.env.LLM_PROVIDER?.trim().toLowerCase() as LlmProvider | "" | undefined;
  if (force === "anthropic") return process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
  if (force === "deepseek") return process.env.DEEPSEEK_API_KEY ? "deepseek" : null;
  if (force === "openai") return process.env.OPENAI_API_KEY ? "openai" : null;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

function defaultModel(p: LlmProvider): string {
  if (process.env.LLM_MODEL?.trim()) return process.env.LLM_MODEL.trim();
  if (p === "anthropic") return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-5";
  if (p === "deepseek") return process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

/** 去掉 ```json ... ``` 代码围栏；Claude 偶尔在 JSON 外包一层 fences。 */
function stripMarkdownJsonFences(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (m && m[1]) return m[1];
  return s;
}

function makeAnthropicClient(modelName: string): LlmChatClient {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL?.trim() || undefined,
  });
  return {
    provider: "anthropic",
    modelName,
    async chatJson({ system, user, maxTokens, temperature }) {
      try {
        const res = await client.messages.create({
          model: modelName,
          max_tokens: maxTokens,
          temperature: temperature ?? 0.25,
          system,
          messages: [
            { role: "user", content: user },
            { role: "assistant", content: "{" },
          ],
        });
        const block = res.content.find((b) => b.type === "text");
        if (!block || block.type !== "text") return null;
        return stripMarkdownJsonFences("{" + block.text);
      } catch (err) {
        console.warn(`[llm] anthropic chatJson failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
  };
}

function makeOpenAiCompatClient(provider: "deepseek" | "openai", modelName: string): LlmChatClient {
  const apiKey = provider === "deepseek" ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY;
  const baseURL =
    provider === "deepseek"
      ? process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com"
      : process.env.OPENAI_BASE_URL?.trim() || undefined;
  const oai = new OpenAI({ apiKey, baseURL });
  return {
    provider,
    modelName,
    async chatJson({ system, user, maxTokens, temperature }) {
      try {
        const c = await oai.chat.completions.create({
          model: modelName,
          temperature: temperature ?? 0.25,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        });
        const raw = c.choices[0]?.message?.content;
        return raw ? stripMarkdownJsonFences(raw) : null;
      } catch (err) {
        console.warn(`[llm] ${provider} chatJson failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
  };
}

/**
 * 创建统一 LLM 客户端：
 * - `LLM_PROVIDER=anthropic|deepseek|openai` 强制选 provider；不设则按 ANTHROPIC > DEEPSEEK > OPENAI 自动挑
 * - 模型名优先级：`LLM_MODEL` > `ANTHROPIC_MODEL`/`DEEPSEEK_MODEL`/`OPENAI_MODEL` > 内置默认
 * - 任一 key 都没有则返回 null（流水线会跳过 LLM 步骤，仍出规则引擎结果）
 */
export function createLlmClient(): LlmChatClient | null {
  const p = pickProvider();
  if (!p) return null;
  const modelName = defaultModel(p);
  if (p === "anthropic") return makeAnthropicClient(modelName);
  return makeOpenAiCompatClient(p, modelName);
}

/** 仅用于日志/错误展示；实际请求里读 client.modelName。 */
export function getLlmModel(): string {
  const p = pickProvider();
  return p ? defaultModel(p) : "(no llm configured)";
}

export function hasLlmCredentials(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
  );
}
