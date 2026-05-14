import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 开发模式下左下角「Route / Dynamic / Bundler / Turbopack」等为 Next.js 内置界面，仅有英文，
   * 无法与项目 Cookie 语言同步。关闭后本地预览与中文产品 UI 更一致；需要路由信息时可改回对象配置或查阅终端 `next build` 输出。
   * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/devIndicators
   */
  devIndicators: false,
};

export default nextConfig;
