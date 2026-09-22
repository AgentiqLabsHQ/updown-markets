import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./accent-theme.css";
import { Providers } from "./providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Updown Markets is the customer-facing product brand; technical UPDOWN identifiers remain unchanged.
const PRODUCT_NAME = "Updown Markets";

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} · Pick a side.`,
  description: `Daily onchain Stock Token battles. Pick a side, powered by ${PRODUCT_NAME}.`,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}