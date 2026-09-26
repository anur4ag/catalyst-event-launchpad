// Throwaway devnet keypairs, stored in gitignored .keys/. Never used on mainnet.
import { Keypair } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

export function key(name: string): Keypair {
  const path = `.keys/${name}.json`;
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  mkdirSync(".keys", { recursive: true });
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify([...kp.secretKey]));
  return kp;
}
