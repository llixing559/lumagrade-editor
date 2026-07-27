import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LumaGrade — 在线修图与 33³ LUT 生成器",
  description:
    "用参考成片训练专属 33³ LUT，在浏览器本地载入照片与 .cube 文件并实时调色。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
