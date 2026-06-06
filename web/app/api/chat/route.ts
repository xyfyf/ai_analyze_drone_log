import { NextResponse } from "next/server";
import { z } from "zod";
import { createLlmClient, hasLlmCredentials } from "@/lib/llm/create-client";

export const runtime = "nodejs";

/** PRD §1.8：无向量库时的「静态官方摘录」，强制模型仅在此范围内引用链接。 */
const STATIC_CITATIONS = [
  {
    title: "Betaflight PID Tuning Guide",
    url: "https://betaflight.com/docs/wiki/guides/current/PID-Tuning-Guide",
    excerpt: "PID 用于角速率控制；P/I/D 过高可能振荡，过低可能迟钝。应小步调整并在实飞中验证。",
  },
  {
    title: "Betaflight PID Tuning Tab",
    url: "https://betaflight.com/docs/wiki/app/pid-tuning-tab",
    excerpt: "在 Configurator 的 PID 页面可调整各轴 PID 与相关滤波选项。",
  },
];

const BodySchema = z.object({
  message: z.string().min(2).max(2000),
  fc_stack: z.enum(["betaflight", "ardupilot", "px4"]).default("betaflight"),
});

/**
 * 对话式调参（MVP）：将固定官网摘录注入 system prompt；
 * 支持 Anthropic Claude / DeepSeek / OpenAI（按 .env 自动选）。
 */
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "请求体无效", details: parsed.error.flatten() }, { status: 400 });
  }

  if (!hasLlmCredentials()) {
    return NextResponse.json({
      reply:
        "当前实例未配置 ANTHROPIC_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY 任一。以下为内置官方参考摘录，请在 Configurator 中小步修改并实飞验证。",
      citations: STATIC_CITATIONS,
      model: null,
    });
  }

  const client = createLlmClient();
  if (!client) {
    return NextResponse.json({
      reply: "无法创建 LLM 客户端。",
      citations: STATIC_CITATIONS,
      model: null,
    });
  }

  const system = `你是 Betaflight 调参助手（MVP）。用户飞控栈：${parsed.data.fc_stack}。
你只能依据下列「官方摘录」回答问题；不得发明不存在的参数名或 CLI。若用户问的内容与摘录无关，请回答无法在已给官方摘录中找到依据，并建议用户查阅完整文档链接。
输出 JSON 格式：{"reply":"...","citations_used":[{"title":"","url":"","quote_snippet":""}]}
官方摘录：
${JSON.stringify(STATIC_CITATIONS, null, 2)}`;

  const raw = await client.chatJson({
    system,
    user: parsed.data.message,
    maxTokens: 1_500,
    temperature: 0.3,
  });

  if (!raw) {
    return NextResponse.json({
      reply: "大模型请求失败，以下为内置官方参考摘录。",
      citations: STATIC_CITATIONS,
      model: client.modelName,
    });
  }

  let payload: { reply?: string; citations_used?: unknown };
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { reply: raw, citations_used: [] };
  }

  return NextResponse.json({
    reply: payload.reply ?? "",
    citations: payload.citations_used ?? STATIC_CITATIONS,
    model: client.modelName,
  });
}
