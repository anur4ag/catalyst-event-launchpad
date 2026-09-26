import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { key } from "./keys";

const conn = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ["partner"]) {
  const pk = key(name).publicKey;
  try {
    const sig = await conn.requestAirdrop(pk, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  } catch (e) {
    console.error(name, "airdrop failed:", (e as Error).message);
  }
  console.log(name, pk.toBase58(), (await conn.getBalance(pk)) / LAMPORTS_PER_SOL, "SOL");
}
