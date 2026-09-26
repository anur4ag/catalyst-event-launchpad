"use client";
import { use, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getPriceFromSqrtPrice as dammPrice } from "@meteora-ag/cp-amm-sdk";
import {
  claimCreatorFeesStep,
  claimPartnerFeesStep,
  clients,
  curveQuote,
  curveTradeStep,
  dammPoolFor,
  dammTradeStep,
  graduateSteps,
} from "@/lib/actions";
import { explorer } from "@/lib/config";
import { fmtSol, friendly, pantaGet, pct, useLoad, useSendSteps } from "@/lib/client";
import { curvePoints, price } from "@/lib/curve";
import { getLaunch, short } from "@/lib/launches";
import { toUnix, type Market, type Trade } from "@/lib/panta";
import { Avatar, CurveChart, DataSourceNote, Odds, StepLog } from "@/components/ui";
import Hedge from "@/components/Hedge";

const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric" });
const DAY = 86_400;

export default function TokenPage({ params }: { params: Promise<{ pool: string }> }) {
  const { pool } = use(params);
  const { connection } = useConnection();
  const wallet = useWallet();
  const { send, log, busy } = useSendSteps();

  const chain = useLoad(async () => {
    const { dbc, damm } = clients(connection);
    const launch = await getLaunch(connection, pool);
    if (!launch) throw new Error("No Catalyst launch at this address on this network.");
    const vp = (await dbc.state.getPool(pool))!.poolState;
    const cfg = (await dbc.state.getPoolConfig(vp.config))!;
    const fees = await dbc.state.getPoolFeeBreakdown(pool);
    const dammPool = launch.migrated ? await dammPoolFor(connection, new PublicKey(pool)) : null;
    const dammState = dammPool ? await damm.fetchPoolState(dammPool) : null;
    return { launch, vp, cfg, fees, dammPool, dammState };
  }, [connection, pool, log.length && log.every((s) => s.status === "done")]);

  const marketId = chain.data?.launch.marketId;
  const market = useLoad(async () => (marketId ? pantaGet<Market>(`markets/${marketId}/`) : null), [marketId]);
  const tape = useLoad(async () => (marketId ? pantaGet<{ items: Trade[] }>(`markets/${marketId}/trades/`) : null), [marketId]);

  const points = useMemo(() => (chain.data ? curvePoints(chain.data.cfg) : []), [chain.data]);

  if (chain.error) return <p className="notice" style={{ marginTop: 40 }}>{chain.error}</p>;
  if (!chain.data) return <p className="muted" style={{ marginTop: 40 }}>Loading launch…</p>;

  const { launch: l, vp, cfg, fees, dammPool, dammState } = chain.data;
  const livePrice = dammState ? Number(dammPrice(dammState.sqrtPrice, 6, 9).toString()) : price(vp.sqrtPrice);
  const cliff = Number(cfg.lockedVestingConfig.cliffDurationFromMigrationTime.toString());
  const hasVesting = !cfg.lockedVestingConfig.amountPerPeriod.isZero();
  const me = wallet.publicKey?.toBase58();
  const status = l.migrated ? "Graduated to DAMM v2" : l.progress >= 1 ? "Curve complete: ready to graduate" : "Bonding";

  return (
    <div style={{ padding: "32px 0" }}>
      <div className="row" style={{ marginBottom: 24, flexWrap: "wrap" }}>
        <Avatar uri={l.uri} symbol={l.symbol} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ fontSize: 28 }}>
            ${l.symbol} <span className="muted" style={{ fontSize: 18, fontWeight: 500 }}>{l.name}</span>
          </h1>
          <div className="row small muted" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className={`badge ${l.migrated ? "badge-yes" : l.progress >= 1 ? "badge-warn" : "badge-accent"}`}>{status}</span>
            <span>
              creator <a href={explorer(l.creator)} target="_blank" rel="noreferrer" className="num">{short(l.creator)}</a>
            </span>
            <span>
              mint <a href={explorer(l.baseMint)} target="_blank" rel="noreferrer" className="num">{short(l.baseMint)}</a>
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="num" style={{ fontSize: 24, fontWeight: 700 }}>{(livePrice * 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL</div>
          <div className="muted small">market cap · {livePrice.toExponential(3)} SOL / token</div>
        </div>
      </div>

      <div className="split">
        <div className="stack" style={{ gap: 20 }}>
          <section className="card stack">
            <div className="row between">
              <div className="section-title" style={{ margin: 0 }}>Meteora DBC curve</div>
              <a className="faint small" href={explorer(pool)} target="_blank" rel="noreferrer">pool {short(pool)} ↗</a>
            </div>
            <CurveChart points={points} raised={l.quoteReserve / 1e9} height={180} />
            <div className="row between small">
              <span className="muted">Raised toward graduation</span>
              <span className="num">
                {fmtSol(l.quoteReserve)} / {fmtSol(l.threshold)} SOL · {pct(l.progress)}
              </span>
            </div>
            <div className="progress">
              <div style={{ width: `${l.progress * 100}%` }} />
            </div>
            {dammPool && (
              <p className="small muted">
                Liquidity now lives in Meteora DAMM v2 pool{" "}
                <a className="num" href={explorer(dammPool.toBase58())} target="_blank" rel="noreferrer">{short(dammPool.toBase58())} ↗</a>
              </p>
            )}
          </section>

          {marketId && (
            <section className="card stack">
              <div className="row between">
                <div className="section-title" style={{ margin: 0 }}>The catalyst</div>
                <a className="powered small" href="https://panta.market" target="_blank" rel="noreferrer">Powered by Panta</a>
              </div>
              {market.data ? (
                <>
                  <strong style={{ fontSize: 18 }}>{market.data.title}</strong>
                  <Odds yes={market.data.yesPrice ? Number(market.data.yesPrice) : null} />
                  <div className="row small muted" style={{ flexWrap: "wrap" }}>
                    <span>Resolves {fmtDate(toUnix(market.data.resolutionTime))}</span>
                    <span>· {market.data.volumeUsdc} USDC volume</span>
                    <span>· {market.data.phase}</span>
                  </div>
                  <div className="list small">
                    {tape.data?.items.slice(0, 6).map((t) => {
                      const yes = Number(t.yesAmount) > 0;
                      return (
                        <div key={t.id} className="row between num">
                          <span style={{ color: yes ? "var(--yes)" : "var(--no)" }}>
                            {yes ? "YES" : "NO"} {Number(yes ? t.yesAmount : t.noAmount).toFixed(2)}
                          </span>
                          <span className="faint">{short(t.wallet)}</span>
                          <span className="faint">{t.blockTime ? new Date(t.blockTime * 1000).toLocaleTimeString() : ""}</span>
                        </div>
                      );
                    })}
                    {tape.data && !tape.data.items.length && <span className="muted">No trades on this market yet.</span>}
                  </div>
                  <DataSourceNote mode={market.data._mode} disclaimer={market.data.disclaimer} />
                </>
              ) : (
                <span className="muted small">{market.error ?? "Loading market…"}</span>
              )}
            </section>
          )}

          <section className="card stack">
            <div className="section-title" style={{ margin: 0 }}>Locks and fees</div>
            <dl className="kv">
              {hasVesting && (
                <>
                  <dt>Creator allocation</dt>
                  <dd>
                    {l.migrated ? "vesting" : "locked"}: unlock starts {cliff >= DAY ? `${Math.round(cliff / DAY)} days` : "right"} after graduation
                    {marketId && market.data ? `, after the event resolves (${fmtDate(toUnix(market.data.resolutionTime)).split(",")[0]})` : ""}
                  </dd>
                </>
              )}
              {cfg.creatorLiquidityVestingInfo.vestingPercentage > 0 && (
                <>
                  <dt>Creator LP</dt>
                  <dd>{cfg.creatorLiquidityVestingInfo.vestingPercentage}% of DAMM v2 liquidity vests from the same date</dd>
                </>
              )}
              <dt>Permanently locked LP</dt>
              <dd>{cfg.partnerPermanentLockedLiquidityPercentage + cfg.creatorPermanentLockedLiquidityPercentage}%</dd>
              <dt>Creator fees earned</dt>
              <dd className="num">{fmtSol(fees.creator.totalQuoteFee.toNumber(), 4)} SOL</dd>
              <dt>Preset author fees earned</dt>
              <dd className="num">{fmtSol(fees.partner.totalQuoteFee.toNumber(), 4)} SOL</dd>
            </dl>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {me === l.creator && !fees.creator.unclaimedQuoteFee.isZero() && (
                <button className="btn btn-sm" disabled={busy} onClick={async () => send([await claimCreatorFeesStep(connection, wallet.publicKey!, new PublicKey(pool))]).catch(() => {})}>
                  Claim {fmtSol(fees.creator.unclaimedQuoteFee.toNumber(), 4)} SOL creator fees
                </button>
              )}
              {me === cfg.feeClaimer.toBase58() && !fees.partner.unclaimedQuoteFee.isZero() && (
                <button className="btn btn-sm" disabled={busy} onClick={async () => send([await claimPartnerFeesStep(connection, wallet.publicKey!, new PublicKey(pool))]).catch(() => {})}>
                  Claim {fmtSol(fees.partner.unclaimedQuoteFee.toNumber(), 4)} SOL author fees
                </button>
              )}
            </div>
          </section>
        </div>

        <aside className="stack" style={{ gap: 20 }}>
          {l.progress >= 1 && !l.migrated ? (
            <div className="card stack">
              <div className="section-title" style={{ margin: 0 }}>Graduate</div>
              <p className="small muted">
                The curve is full. Anyone can move it into a Meteora DAMM v2 pool at the price the curve discovered. This locks the creator&apos;s vesting and
                mints the LP positions.
              </p>
              <button className="btn btn-primary btn-block" disabled={busy || !wallet.publicKey} onClick={async () => send((await graduateSteps(connection, wallet.publicKey!, new PublicKey(pool))).steps).catch(() => {})}>
                {wallet.publicKey ? "Graduate to DAMM v2" : "Connect wallet to graduate"}
              </button>
            </div>
          ) : (
            <TradeCard pool={pool} baseMint={l.baseMint} dammPool={dammPool?.toBase58() ?? null} symbol={l.symbol} onTrade={send} busy={busy} />
          )}
          <StepLog log={log} />
          {market.data && <Hedge market={market.data} symbol={l.symbol} />}
        </aside>
      </div>
    </div>
  );
}

function TradeCard(props: { pool: string; baseMint: string; dammPool: string | null; symbol: string; onTrade: ReturnType<typeof useSendSteps>["send"]; busy: boolean }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.1");
  const [error, setError] = useState<string | null>(null);
  const owner = wallet.publicKey;
  const n = Number(amount);

  const balance = useLoad(async () => {
    if (!owner) return null;
    const sol = await connection.getBalance(owner);
    const ata = getAssociatedTokenAddressSync(new PublicKey(props.baseMint), owner);
    const tok = await connection.getTokenAccountBalance(ata).then((r) => r.value.uiAmount ?? 0, () => 0);
    return { sol, tok };
  }, [owner?.toBase58(), props.busy]);

  const quote = useLoad(async () => {
    if (!(n > 0) || props.dammPool) return null;
    const { quote } = await curveQuote(connection, new PublicKey(props.pool), side, n);
    return quote;
  }, [side, amount, props.dammPool]);

  async function trade() {
    if (!owner) return setVisible(true);
    setError(null);
    try {
      const step = props.dammPool
        ? await dammTradeStep(connection, owner, new PublicKey(props.dammPool), side, n)
        : await curveTradeStep(connection, owner, new PublicKey(props.pool), side, n);
      await props.onTrade([step]);
    } catch (e) {
      setError(friendly(e));
    }
  }

  const out = quote.data ? Number(quote.data.outputAmount.toString()) / (side === "buy" ? 1e6 : 1e9) : null;
  // All Catalyst presets collect fees in the quote token (SOL), on the way in for buys and out for sells.
  const fee = quote.data ? Number(quote.data.tradingFee.add(quote.data.protocolFee).toString()) / 1e9 : null;

  return (
    <div className="card stack">
      <div className="row between">
        <div className="section-title" style={{ margin: 0 }}>Trade ${props.symbol}</div>
        <span className="badge">{props.dammPool ? "DAMM v2" : "DBC curve"}</span>
      </div>
      <div className="tabs" role="group" aria-label="Side">
        <button aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Buy</button>
        <button aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell</button>
      </div>
      <label className="stack" style={{ gap: 6 }}>
        <span className="label row between">
          <span>{side === "buy" ? "Pay (SOL)" : `Sell (${props.symbol})`}</span>
          {balance.data && (
            <button
              className="faint small"
              style={{ background: "none", border: 0, cursor: "pointer" }}
              onClick={() => setAmount(side === "buy" ? String(Math.max(0, balance.data!.sol / 1e9 - 0.01).toFixed(3)) : String(balance.data!.tok))}
            >
              balance {side === "buy" ? `${fmtSol(balance.data.sol)} SOL` : balance.data.tok.toLocaleString()}
            </button>
          )}
        </span>
        <input className="input num" type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {out !== null && (
        <dl className="kv">
          <dt>You get about</dt>
          <dd className="num">{side === "buy" ? `${out.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${props.symbol}` : `${out.toFixed(4)} SOL`}</dd>
          <dt>Fee</dt>
          <dd className="num">{fee!.toFixed(4)} SOL</dd>
          {side === "buy" && !quote.data!.amountLeft.isZero() && (
            <>
              <dt>Unfilled (curve completes)</dt>
              <dd className="num">{fmtSol(Number(quote.data!.amountLeft.toString()), 4)} SOL refunded</dd>
            </>
          )}
        </dl>
      )}
      <button className={`btn btn-block ${side === "buy" ? "btn-primary" : ""}`} disabled={props.busy || !(n > 0)} onClick={trade}>
        {!owner ? "Connect wallet" : props.busy ? "Confirming…" : `${side === "buy" ? "Buy" : "Sell"} $${props.symbol}`}
      </button>
      {error && <p className="small" style={{ color: "var(--no)" }}>{error}</p>}
    </div>
  );
}
