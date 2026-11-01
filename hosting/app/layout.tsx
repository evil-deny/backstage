import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "福緣素食｜營運後台",
  description: "商品、庫存、訂單與銷售分析集中管理。",
  icons: {
    icon: "/logo.jpg",
    shortcut: "/logo.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
