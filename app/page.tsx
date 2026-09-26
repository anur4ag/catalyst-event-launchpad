"use client";
import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
import { listLaunches, type Launch } from "@/lib/launches";
import { PLATFORM, PRESET_CONFIGS } from "@/lib/config";
import { fmtSol, pantaGet, pct, useLoad } from "@/lib/client";
import type { Market } from "@/lib/panta";
import { Avatar, Odds } from "@/components/ui";

export default function Home() {
  const { connection } = useConnection();
  const launches = useLoad(() => listLaunches(connection, [PLATFORM], Object.values(PRESET_CONFIGS)), [connection]);
  const ids = [...new Set((launches.data ?? []).map((l) => l.marketId).filter(Boolean))] as string[];
  const markets = useLoad(
    async () => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await pantaGet<Market>(`markets/${id}/`).catch(() => null)] as const))),
    [ids.join()],
  );

  return (
    <>
      <section className="hero">
        <h1>
          Launch tokens on <em>what happens next.</em>
        </h1>
        <p>
          Every event token on Catalyst is tied to a live prediction market. Traders see the crowd&apos;s odds next to the price, and the creator&apos;s
          tokens stay locked until the event resolves. Curves and graduation run on Meteora DBC and DAMM v2.
        </p>
        <div className="row" style={{ marginTop: 28, flexWrap: "wrap" }}>
          <Link className="btn btn-primary" href="/launch">
            Launch an event token
          </Link>
          <Link className="btn" href="/presets">
            Browse curve presets
          </Link>
        </div>
      </section>

      <div className="row between" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 22 }}>Live launches</h2>
        <button className="btn btn-sm" onClick={launches.reload} disabled={launches.loading}>
          {launches.loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {launches.error && <p className="notice">Could not read launches from the chain: {launches.error}</p>}
      {!launches.loading && !launches.error && !launches.data?.length && (
        <div className="card muted">
          No launches yet on this network. <Link href="/launch" style={{ color: "var(--accent)" }}>Be the first →</Link>
        </div>
      )}

      <div className="grid cols-3">
        {launches.data?.map((l) => <LaunchCard key={l.pool} l={l} market={l.marketId ? markets.data?.[l.marketId] : null} />)}
      </div>
    </>
  );
}

function LaunchCard({ l, market }: { l: Launch; market?: Market | null }) {
  const status = l.migrated ? ["On DAMM v2", "badge-yes"] : l.progress >= 1 ? ["Ready to graduate", "badge-warn"] : ["Bonding", "badge-accent"];
  return (
    <Link href={`/t/${l.pool}`} className="card card-link stack" style={{ gap: 14 }}>
      <div className="row">
        <Avatar uri={l.uri} symbol={l.symbol} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row between">
            <strong>${l.symbol}</strong>
            <span className={`badge ${status[1]}`}>{status[0]}</span>
          </div>
          <div className="muted small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {l.name}
          </div>
        </div>
      </div>
      {l.marketId && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="small">{market?.title ?? "Linked event"}</div>
          <Odds yes={market?.yesPrice ? Number(market.yesPrice) : null} />
        </div>
      )}
      <div className="stack" style={{ gap: 6 }}>
        <div className="row between small">
          <span className="muted">To graduation</span>
          <span className="num">
            {fmtSol(l.quoteReserve)} / {fmtSol(l.threshold)} SOL · {pct(l.progress)}
          </span>
        </div>
        <div className="progress">
          <div style={{ width: `${l.progress * 100}%` }} />
        </div>
      </div>
    </Link>
  );
}
