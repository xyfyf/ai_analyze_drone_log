# 黑匣子 AI 诊断 — Web MVP

## 本地运行

开发服务器默认端口为 **3001**（避免与本机其它 Next 项目默认 3000 冲突）。访问 **`http://localhost:3001`**。

- **开发指示器**：`next.config.ts` 中已设置 `devIndicators: false`，避免 Next 内置英文菜单（Route / Turbopack 等）与产品中文界面混排；需要时可改回官方文档中的配置。

```bash
cp .env.example .env
npm install
npm run dev
```

- **数据库**：SQLite（`prisma/dev.db`），模型见 `prisma/schema.prisma`。
- **可选 LLM**：在 `web/.env` 配置 **`DEEPSEEK_API_KEY`**（OpenAI 兼容接口，优先）或 **`OPENAI_API_KEY`**；可用 **`LLM_MODEL`** 覆盖默认（有 DeepSeek 密钥时默认为 `deepseek-chat`）。密钥勿提交 git；若曾泄露请立即在控制台作废。

## 主要路由

| 路径 | 说明 |
|------|------|
| `POST /api/analyze` | `multipart/form-data`：`file`（CSV）、`userContext`（JSON 字符串） |
| `GET /api/report/:id` | 读取已存储诊断 JSON |
| `POST /api/chat` | JSON：`{ "message": "...", "fc_stack": "betaflight" }` |

## 技术说明（MVP 边界）

- 仅对 **Betaflight CSV** 做了列名容错与启发式特征；ArduPilot / PX4 见 PRD Phase 2。
- 未接 Supabase 签名上传；大文件请本地或后续按 PRD 接入对象存储。
