"use client";
import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { UnsafeBurnerWalletAdapter } from "@solana/wallet-adapter-unsafe-burner";
import { BURNER, RPC_URL } from "@/lib/config";
import "@solana/wallet-adapter-react-ui/styles.css";

// Phantom, Solflare, Backpack etc. register themselves via Wallet Standard; the burner wallet is
// an opt-in for localnet demos where browser wallets can't reach 127.0.0.1.
export default function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => (BURNER ? [new UnsafeBurnerWalletAdapter()] : []), []);
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
