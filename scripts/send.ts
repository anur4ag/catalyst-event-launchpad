// Send devnet SOL from the platform wallet, e.g. to the wallet that records the demo.
//   RPC_URL=... bun scripts/send.ts <address> <sol>
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { key } from "./keys";
import { conn, LOCAL } from "./util";

const [to, sol] = [new PublicKey(process.argv[2]), Number(process.argv[3])];
if (!(sol > 0 && sol <= 2)) throw new Error("amount must be in (0, 2] SOL");
if (!LOCAL && !/devnet/.test(conn.rpcEndpoint)) throw new Error("devnet or localnet only");
const platform = key("partner");
const ix = SystemProgram.transfer({ fromPubkey: platform.publicKey, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) });
const sig = await conn.sendTransaction(new Transaction().add(ix), [platform]);
await conn.confirmTransaction(sig, "confirmed");
console.log(`sent ${sol} SOL to ${to.toBase58()}; platform has ${(await conn.getBalance(platform.publicKey)) / LAMPORTS_PER_SOL} SOL left`);
