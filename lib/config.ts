// Client-visible settings. DBC/DAMM run on NEXT_PUBLIC_RPC_URL (localnet or devnet); Panta is
// mainnet-only and reached through the /api/panta proxy.
import deployments from "./deployments.json";
import type { PresetId } from "./presets";

const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
/** A path such as /api/rpc (our key-hiding proxy, app/api/rpc) resolves against the page origin. */
export const RPC_URL = rpc.startsWith("/") ? `${typeof window === "undefined" ? "http://localhost:3000" : window.location.origin}${rpc}` : rpc;
export const NETWORK = process.env.NEXT_PUBLIC_NETWORK ?? "devnet";
/** Platform wallet: leftoverReceiver on every Catalyst config, which makes launches discoverable. */
export const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM ?? "JE5wJpF7DTND9p3xKz7R7vfPLyszEY7CMVnVUPBXwuoF";
/** Market-cap multiplier for presets (1 = production; small on devnet so graduation is reachable). */
export const SCALE = Number(process.env.NEXT_PUBLIC_SCALE ?? 0.01);
export const BURNER = process.env.NEXT_PUBLIC_BURNER === "1";

/** Shared on-chain configs for static presets on this network (written by scripts/seed.ts). */
export const PRESET_CONFIGS = ((deployments as Record<string, Partial<Record<PresetId, string>>>)[NETWORK] ?? {}) as Partial<Record<PresetId, string>>;

export type CustomConfig = { preset: PresetId; config: string };

/** The published config a static preset launches on. A ?config= link applies only to the preset it came with.
 * The launch page shows the summary for, and submits, exactly this address. */
export const launchConfigFor = (preset: PresetId, custom: CustomConfig | null, deployed = PRESET_CONFIGS) =>
  custom?.preset === preset ? custom.config : deployed[preset];

export const explorer = (addr: string, kind: "address" | "tx" = "address") =>
  `https://explorer.solana.com/${kind}/${addr}?cluster=${NETWORK === "localnet" ? `custom&customUrl=${encodeURIComponent(RPC_URL)}` : NETWORK}`;
