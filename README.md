# ai_analyze_drone_log

PRD 见仓库根目录 [`DEVELOPMENT_TODO.md`](./DEVELOPMENT_TODO.md)。

## MVP 应用（Next.js）

代码位于 **`web/`**：

```bash
cd web
cp .env.example .env   # 已含 DATABASE_URL；可选填 DEEPSEEK_API_KEY 或 OPENAI_API_KEY
npm install
npx prisma migrate dev   # 首次或改 schema 时
npm run dev
```

浏览器打开 **`http://localhost:3001`**（本仓库与默认 `3000` 错开，避免与例如 ZeroPrompt Studio 等其它 Next 项目同时开发时抢端口）。
