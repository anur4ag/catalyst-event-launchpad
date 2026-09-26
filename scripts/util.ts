// Script plumbing: RPC connection, keypair-signed step runner, localnet funding.
import { Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction, SystemProgram, Transaction } from "@solana/web3.js";
import type { Step } from "../lib/actions";

export const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
export const conn = new Connection(RPC, "confirmed");

export async function run(step: Step, payer: Keypair) {
  step.tx.feePayer = payer.publicKey;
  const sig = await sendAndConfirmTransaction(conn, step.tx, [payer, ...step.signers], { commitment: "confirmed" });
  console.log(`  ✓ ${step.label} ${sig.slice(0, 12)}…`);
  return sig;
}

export const LOCAL = /127\.0\.0\.1|localhost/.test(RPC);

/** Tops `kp` up to `sol`: faucet on localnet, otherwise a transfer from `payer` (devnet's faucet is rate-limited). */
export async function fund(kp: Keypair, sol: number, payer?: Keypair) {
  const short = Math.ceil(sol * LAMPORTS_PER_SOL - (await conn.getBalance(kp.publicKey)));
  if (short <= 0) return;
  if (LOCAL) return void (await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL), "confirmed"));
  if (!payer) throw new Error(`${kp.publicKey.toBase58()} needs ${short / LAMPORTS_PER_SOL} more SOL on ${RPC}`);
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports: short }));
  await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
}
