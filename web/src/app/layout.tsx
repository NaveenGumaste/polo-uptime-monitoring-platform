import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polo | Uptime Monitoring and Incident Alerting Platform",
  description: "A clear view of your services. Monitor uptime, response times, SSL certificates, and incidents in one place.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* Browser extensions can inject body attributes before React hydrates. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
