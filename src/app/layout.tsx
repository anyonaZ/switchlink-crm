/**
 * Switchlink CRM — © 2026 Anyonaz NewTech. All rights reserved.
 */
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { SecretProvider } from "@/components/ui/SecretDialog";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import SignatureBeacon from "@/components/SignatureBeacon";
import { AUTHOR, COPYRIGHT, SIGNATURE_ID } from "@/lib/signature";

export const metadata: Metadata = {
  title: { default: "Switchlink CRM", template: "%s · Switchlink CRM" },
  description: "Client and pipeline management for Switchlink Africa field teams.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Switchlink CRM" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  applicationName: "Switchlink CRM",
  authors: [{ name: AUTHOR }],
  creator: AUTHOR,
  publisher: AUTHOR,
  generator: `Switchlink CRM by ${AUTHOR}`,
  other: { copyright: COPYRIGHT, "software-signature": SIGNATURE_ID },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#24439A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <SecretProvider>{children}</SecretProvider>
        </ToastProvider>
        <RegisterServiceWorker />
        <SignatureBeacon />
      </body>
    </html>
  );
}
