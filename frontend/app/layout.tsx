import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { UnitsProvider } from "@/lib/units";
import ConsoleFilter from "@/components/ConsoleFilter";
import TabNav from "@/components/field/TabNav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "ET Irrigation Dashboard",
  description: "Root-zone depletion, irrigation decision, and forecast for one field, one season.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <ConsoleFilter />
        <UnitsProvider>
          <TabNav />
          {children}
        </UnitsProvider>
      </body>
    </html>
  );
}
