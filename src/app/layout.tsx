import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "团队项目进度后台",
  description: "运营、产品、技术项目需求同步后台",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10231f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" style={{ backgroundColor: "#eef2f7", color: "#1d1d1f" }}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          color: "#1d1d1f",
          background:
            "radial-gradient(circle at 50% -12%, rgba(255,255,255,0.94), transparent 34%), radial-gradient(circle at 88% 14%, rgba(214,226,246,0.58), transparent 24%), linear-gradient(180deg, #f7f9fc 0%, #eef2f7 52%, #e7edf5 100%)",
        }}
      >
        {children}
      </body>
    </html>
  );
}
