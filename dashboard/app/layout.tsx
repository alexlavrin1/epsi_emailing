import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "EpsiFlow", template: "%s · EpsiFlow" },
  description: "Secure CRM and automation operations for EpsiFlow.",
  robots: { index: false, follow: false },
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
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        {children}
      </body>
    </html>
  );
}
