"use client";
// Panta primary-buy flow inside a token page: quote -> build -> (sign on mainnet) -> submit -> verify.
// In mock mode and with a pk_test_ key Panta returns no instructions, so nothing is signed or sent.
import { useState } from "react";
import { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { friendly, pantaGet, pantaPost, useLoad, type PantaResult } from "@/lib/client";
import { positionValue, type BuyBuild, type BuyQuote, type Market, type Position, type Side } from "@/lib/panta";

const PANTA_RPC = process.env.NEXT_PUBLIC_PANTA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export default function Hedge({ market, symbol }: { market: PantaResult<Market>; symbol: string }) {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [side, setSide] = useState<Side>("no");
  const [amount, setAmount] = useState("10");
  const [quote, setQuote] = useState<PantaResult<BuyQuote> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = wallet.publicKey?.toBase58();
  const positions = useLoad(
    async () => (owner ? (await pantaGet<{ positions: Position[] }>("positions/", { wallet: owner })).positions.filter((p) => p.marketId === market.marketId) : []),
    [owner, market.marketId, status],
  );

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const getQuote = run(async () => {
    if (!owner) return setVisible(true);
    setStatus(null);
    setQuote(await pantaPost<BuyQuote>("primaryorderquote/", { wallet: owner, marketId: market.marketId, side, amountUsdc: Number(amount).toFixed(2) }));
  });

  const confirm = run(async () => {
    if (!quote || !owner) return;
    const build = await pantaPost<BuyBuild>("primaryorderbuild/", { quoteId: quote.quoteId, wallet: owner, maxSlippageBps: 100 });
    let signature: string;
    if (!build.instructions.length) {
      signature = "sandbox"; // mock / pk_test_ sandbox: Panta returns nothing to sign
    } else {
      const conn = new Connection(PANTA_RPC, "confirmed");
      const instructions = build.instructions.map(
        (ix) =>
          new TransactionInstruction({
            programId: new PublicKey(ix.programId),
            data: Buffer.from(ix.data, "base64"),
            keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
          }),
      );
      const msg = new TransactionMessage({ payerKey: wallet.publicKey!, recentBlockhash: build.recentBlockhash, instructions }).compileToV0Message();
      signature = await wallet.sendTransaction(new VersionedTransaction(msg), conn);
    }
    await pantaPost("primaryordersubmit/", { orderId: build.orderId, signature, wallet: owner });
    const v = await pantaPost<{ status: string }>("primaryorderverify/", { orderId: build.orderId, signature, wallet: owner });
    setStatus(build.instructions.length ? `Order ${v.status}` : `Order ${v.status} (${quote._mode === "mock" ? "demo" : "sandbox"}: nothing was signed or sent)`);
    setQuote(null);
  });

  return (
    <div className="card stack">
      <div className="row between">
        <div className="section-title" style={{ margin: 0 }}>
          Hedge on the event
        </div>
        <a className="powered small" href="https://panta.market" target="_blank" rel="noreferrer">
          Powered by Panta
        </a>
      </div>
      <p className="muted small">
        Holding ${symbol} is a bet on attention. Buy the outcome you&apos;re worried about and one of the two positions pays if the event goes against
        you.
      </p>
      {market.phase !== "primary" ? (
        <p className="notice small">
          This market is past its primary sale, so new positions trade on{" "}
          <a href="https://panta.market" target="_blank" rel="noreferrer">
            panta.market ↗
          </a>
          . Live odds above.
        </p>
      ) : (
        <>
      <div className="tabs" role="group" aria-label="Outcome">
        <button aria-pressed={side === "yes"} onClick={() => (setSide("yes"), setQuote(null))}>
          YES {market.yesPrice ? `· ${Number(market.yesPrice).toFixed(2)}` : ""}
        </button>
        <button aria-pressed={side === "no"} onClick={() => (setSide("no"), setQuote(null))}>
          NO {market.noPrice ? `· ${Number(market.noPrice).toFixed(2)}` : ""}
        </button>
      </div>
      <label className="stack" style={{ gap: 6 }}>
        <span className="label">Amount (USDC)</span>
        <input className="input num" type="number" min="1" step="1" value={amount} onChange={(e) => (setAmount(e.target.value), setQuote(null))} />
      </label>
      {quote && (
        <dl className="kv">
          <dt>Shares</dt>
          <dd className="num">{quote.shares}</dd>
          <dt>Avg price</dt>
          {/* the pk_test_ sandbox omits avgPrice; derive it */}
          <dd className="num">{Number(quote.avgPrice ?? Number(quote.amountUsdc) / Number(quote.shares)).toFixed(4)}</dd>
          <dt>Fee</dt>
          <dd className="num">{quote.feeUsdc} USDC</dd>
          <dt>Pays if {side.toUpperCase()}</dt>
          <dd className="num">{Number(quote.shares).toFixed(2)} USDC</dd>
        </dl>
      )}
      {quote && !quote._trade ? (
        <p className="notice small">Live quote from Panta. Buying is switched off in this build.</p>
      ) : quote ? (
        <button className={`btn btn-block ${side === "yes" ? "btn-yes" : "btn-no"}`} disabled={busy} onClick={confirm}>
          {busy ? "Confirming…" : `Buy ${side.toUpperCase()} for ${quote.amountUsdc} USDC`}
        </button>
      ) : (
        <button className="btn btn-block" disabled={busy || !(Number(amount) >= 1)} onClick={getQuote}>
          {!owner ? "Connect wallet" : busy ? "Quoting…" : "Get quote"}
        </button>
      )}
        </>
      )}
      {status && <p className="small" style={{ color: "var(--yes)" }}>{status}</p>}
      {error && <p className="small" style={{ color: "var(--no)" }}>{error}</p>}
      {!!positions.data?.length && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Your positions</span>
          {positions.data.map((p) => {
            const v = positionValue(p, market);
            return (
              <div key={p.side} className="row between small num">
                <span style={{ color: p.side === "yes" ? "var(--yes)" : "var(--no)" }}>
                  {p.side.toUpperCase()} · {p.shares} shares
                </span>
                <span>{v === null ? "—" : `≈ ${v.toFixed(2)} USDC`}</span>
              </div>
            );
          })}
        </div>
      )}
      <p className="faint small">
        {quote?.disclaimer ?? market.disclaimer ?? (market._mode === "mock" ? "Demo data: no Panta key configured." : "Panta markets settle in USDC on Solana mainnet.")}
      </p>
    </div>
  );
}
