import type { Metadata } from "next";
import "@/shared/brand.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "OpenScreens · Digital Signage Platform",
  description: "Open-source digital signage platform and Android TV screen management",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
