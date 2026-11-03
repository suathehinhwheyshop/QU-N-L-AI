import type { Metadata } from "next";
import "./globals.css";
import { headers } from "next/headers";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "ORBIT — Multi-AI Workspace",
  description: "Nền tảng điều phối workflow đa AI dành cho công việc của anh.",
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  await headers();
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
