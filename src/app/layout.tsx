import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Firefly Uptime — 服务状态页",
  description: "实时监控所有服务的运行状态",
  openGraph: {
    title: "Firefly Uptime",
    description: "实时监控所有服务的运行状态",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <head>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>✨</text></svg>" />
      </head>
      <body className="antialiased min-h-screen">
        {children}
        <footer className="text-center py-6 text-text-muted text-xs">
          <p>
            Powered by{" "}
            <a
              href="https://dashboard.uptimerobot.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Uptime Robot
            </a>{" "}
            ·{" "}
            <a
              href="https://vercel.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Vercel
            </a>
          </p>
        </footer>
      </body>
    </html>
  );
}
