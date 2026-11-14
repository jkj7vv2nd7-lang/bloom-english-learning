import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bloom English | 英語が育つ毎日の学習アプリ",
  description: "物語・音声・間隔反復で、中学・高校の英単語を毎日楽しく身につける学習アプリ。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
