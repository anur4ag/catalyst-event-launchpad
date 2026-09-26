"use client";
import dynamic from "next/dynamic";

// The wallet button reads window state; render it client-only to avoid hydration mismatch.
export default dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), { ssr: false });
