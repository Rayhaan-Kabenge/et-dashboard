import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { UnitsProvider } from "@/lib/units";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "ET Irrigation Dashboard",
  description: "Root-zone depletion, irrigation decision, and forecast for one field, one season.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">
        <UnitsProvider>{children}</UnitsProvider>
      </body>
    </html>
  );
}
