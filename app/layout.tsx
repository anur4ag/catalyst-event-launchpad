import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import Providers from "./providers";
import WalletButton from "@/components/WalletButton";
import { NETWORK } from "@/lib/config";
import { pantaLabel } from "@/lib/panta";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Catalyst — launch tokens on what happens next",
  description: "Event-linked token launches on Meteora DBC, with live odds from Panta prediction markets.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <header className="header">
            <div className="wrap">
              <Link href="/" className="brand">
                <span className="brand-dot" /> Catalyst
              </Link>
              <nav className="nav">
                <Link href="/">Launches</Link>
                <Link href="/launch">Launch</Link>
                <Link href="/presets">Presets</Link>
              </nav>
              <span className="badge">{NETWORK}</span>
              <WalletButton />
            </div>
          </header>
          <main className="wrap">{children}</main>
          <footer className="footer">
            <div className="wrap row between" style={{ flexWrap: "wrap" }}>
              <span>
                Curves and graduation by Meteora DBC + DAMM v2 on {NETWORK}.{" "}
                Prediction data: {pantaLabel()}.
              </span>
              <a className="powered" href="https://panta.market" target="_blank" rel="noreferrer">
                Powered by Panta ↗
              </a>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
