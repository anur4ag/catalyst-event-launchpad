// Script plumbing: RPC connection, keypair-signed step runner, localnet funding.
import { Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from "@solana/web3.js";
import type { Step } from "../lib/actions";

export const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
export const conn = new Connection(RPC, "confirmed");

export async function run(step: Step, payer: Keypair) {
  step.tx.feePayer = payer.publicKey;
  const sig = await sendAndConfirmTransaction(conn, step.tx, [payer, ...step.signers], { commitment: "confirmed" });
  console.log(`  ✓ ${step.label} ${sig.slice(0, 12)}…`);
  return sig;
}

/** Tops up from the faucet (works on localnet; devnet's faucet is rate-limited). */
export async function fund(kp: Keypair, sol: number) {
  if ((await conn.getBalance(kp.publicKey)) >= sol * LAMPORTS_PER_SOL) return;
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL), "confirmed");
}
