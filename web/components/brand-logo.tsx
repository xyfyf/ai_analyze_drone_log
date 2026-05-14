"use client";

import { useId } from "react";

type BrandLogoProps = {
  /** Tailwind 尺寸类，默认与顶栏原「LS」方块一致 */
  className?: string;
};

/**
 * ai_analyze_drone_log 品牌矢量标：四旋翼顶视图 + 中心「日志波形」暗示；渐变偏 Z 世代数码感。
 * 仅作品牌识别，与 Betaflight / ArduPilot / PX4 官方商标无关。
 */
export function BrandLogo({ className = "h-9 w-9" }: BrandLogoProps) {
  const uid = useId().replace(/:/g, "");
  const grad = `brand-bg-${uid}`;
  const glow = `brand-glow-${uid}`;

  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={grad} x1="4" y1="6" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" />
          <stop offset="0.45" stopColor="#6366f1" />
          <stop offset="1" stopColor="#e879f9" />
        </linearGradient>
        <filter id={glow} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="1.5" y="1.5" width="37" height="37" rx="11" fill={`url(#${grad})`} />
      <g filter={`url(#${glow})`} opacity="0.95">
        {/* 机臂：十字 + 斜向加强，多旋翼顶视常见构图 */}
        <path
          d="M20 11 L20 29 M11 20 L29 20 M14 14 L26 26 M26 14 L14 26"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        {/* 四电机 */}
        <circle cx="20" cy="10" r="3.6" fill="white" />
        <circle cx="30" cy="20" r="3.6" fill="white" />
        <circle cx="20" cy="30" r="3.6" fill="white" />
        <circle cx="10" cy="20" r="3.6" fill="white" />
        {/* 中心飞控 + 微型波形 = 日志 / 信号 */}
        <circle cx="20" cy="20" r="4.2" fill="#0f172a" fillOpacity="0.22" />
        <path
          d="M15.5 20.5 L17 18.5 L18.5 21.5 L20 19 L21.5 22 L23 19.5 L24.5 21"
          stroke="white"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
