import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "ORBIT — Multi-AI Workspace",
  description: "Nền tảng điều phối workflow đa AI dành cho công việc của anh.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
