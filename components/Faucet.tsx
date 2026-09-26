"use client";
// Test-SOL button for localnet/devnet wallets that are running low. Hidden on mainnet.
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { NETWORK } from "@/lib/config";
import { friendly, useLoad } from "@/lib/client";

export default function Faucet() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [state, setState] = useState<string | null>(null);
  const bal = useLoad(async () => (publicKey ? connection.getBalance(publicKey) : null), [publicKey?.toBase58(), state]);
  if (NETWORK === "mainnet" || !publicKey || bal.data === undefined || bal.data === null || bal.data >= 0.5e9) return null;

  async function drop() {
    setState("…");
    try {
      await connection.confirmTransaction(await connection.requestAirdrop(publicKey!, 2e9), "confirmed");
      setState("done");
    } catch (e) {
      setState(friendly(e));
      alert(`${NETWORK} faucet: ${friendly(e)}. Try faucet.solana.com.`);
    }
  }
  return (
    <button className="btn btn-sm" onClick={drop} disabled={state === "…"} title={`Request 2 test SOL from the ${NETWORK} faucet`}>
      {state === "…" ? "Requesting…" : "Get test SOL"}
    </button>
  );
}
