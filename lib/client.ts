"use client";
// Browser-side helpers: Panta proxy calls and wallet signing of lib/actions steps.
import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { Step } from "./actions";

export type PantaResult<T> = T & { disclaimer?: string; _mode: "live" | "mock"; _trade: boolean };

async function pantaFetch<T>(path: string, init?: RequestInit): Promise<PantaResult<T>> {
  const res = await fetch(`/api/panta/${path}`, init);
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.message ?? res.statusText), { code: json.code });
  return { ...json, _mode: res.headers.get("x-panta-mode") ?? "mock", _trade: res.headers.get("x-panta-trade") === "1" };
}

export const pantaGet = <T,>(path: string, query?: Record<string, string>) =>
  pantaFetch<T>(`${path}${query ? `?${new URLSearchParams(query)}` : ""}`);

export const pantaPost = <T,>(path: string, body: unknown) =>
  pantaFetch<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Load-on-mount with manual reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => live && setState({ data, loading: false }),
      (e) => live && setState({ error: (e as Error).message, loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** Sign + send a list of steps in order with the connected wallet. */
export function useSendSteps() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [log, setLog] = useState<{ label: string; status: "pending" | "done" | "error"; sig?: string; error?: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const send = useCallback(
    async (steps: Step[]) => {
      if (!wallet.publicKey) throw new Error("Connect a wallet first");
      setBusy(true);
      setLog(steps.map((s) => ({ label: s.label, status: "pending" as const })));
      try {
        const sigs: string[] = [];
        for (const [i, s] of steps.entries()) {
          s.tx.feePayer = wallet.publicKey;
          const latest = await connection.getLatestBlockhash("confirmed");
          s.tx.recentBlockhash = latest.blockhash;
          try {
            const sig = await wallet.sendTransaction(s.tx, connection, { signers: s.signers });
            await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
            sigs.push(sig);
            setLog((l) => l.map((x, j) => (j === i ? { ...x, status: "done", sig } : x)));
          } catch (e) {
            setLog((l) => l.map((x, j) => (j === i ? { ...x, status: "error", error: friendly(e) } : x)));
            throw e;
          }
        }
        return sigs;
      } finally {
        setBusy(false);
      }
    },
    [connection, wallet],
  );
  return { send, log, busy, reset: () => setLog([]) };
}

export function friendly(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/User rejected|rejected the request/i.test(m)) return "Cancelled in wallet";
  if (/insufficient lamports|0x1\b|insufficient funds|no record of a prior credit/i.test(m)) return "Not enough SOL";
  if (/0x1772|ExceededSlippage/i.test(m)) return "Price moved; try again";
  return m.length > 140 ? `${m.slice(0, 140)}…` : m;
}

export const fmtSol = (lamports: number, digits = 3) => (lamports / 1e9).toLocaleString(undefined, { maximumFractionDigits: digits });
// Floors so a 99.7%-full curve never reads "100%" before it has actually completed.
export const pct = (x: number) => {
  const d = x < 0.1 && x > 0 ? 1 : 0;
  return `${(Math.floor(x * 100 * 10 ** d) / 10 ** d).toFixed(d)}%`;
};
