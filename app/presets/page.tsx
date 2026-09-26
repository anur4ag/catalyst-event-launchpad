"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { clients, publishPresetStep } from "@/lib/actions";
import { explorer, NETWORK, PLATFORM, PRESET_CONFIGS, SCALE } from "@/lib/config";
import { fmtSol, useLoad, useSendSteps } from "@/lib/client";
import { curvePoints, price } from "@/lib/curve";
import { short } from "@/lib/launches";
import { PRESETS, type Preset, type PresetId } from "@/lib/presets";
import { CurveChart, StepLog } from "@/components/ui";

export default function PresetsPage() {
  return (
    <div style={{ padding: "40px 0" }}>
      <h1 style={{ fontSize: 34, marginBottom: 8 }}>Curve presets</h1>
      <p className="muted" style={{ maxWidth: "68ch", marginBottom: 28 }}>
        A preset is a Meteora DBC config: curve shape, fee schedule, locks, and how the pool graduates into DAMM v2. Each one is published on-chain. Its
        author is the config&apos;s fee claimer, so they earn a share of trading fees plus the creation fee on every launch that uses it. Launchpads can
        reuse any preset without writing curve math.
      </p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
        {(Object.values(PRESETS) as Preset[]).map((p) => (
          <PresetCard key={p.id} p={p} />
        ))}
      </div>
      <Publish />
    </div>
  );
}

function PresetCard({ p }: { p: Preset }) {
  const { connection } = useConnection();
  const address = PRESET_CONFIGS[p.id];
  const cfg = useMemo(() => p.build({ scale: SCALE, resolutionTime: Math.floor(Date.now() / 1000) + 30 * 86_400 }), [p]);
  const points = useMemo(() => curvePoints(cfg), [cfg]);
  const stats = useLoad(async () => {
    const { dbc } = clients(connection);
    // Event Horizon builds one config per launch, all with the platform as leftover receiver.
    const addrs = p.eventLinked
      ? (await dbc.state.getPoolConfigsByOwner(PLATFORM)).filter((c) => !Object.values(PRESET_CONFIGS).includes(c.publicKey.toBase58())).map((c) => c.publicKey)
      : address
        ? [new PublicKey(address)]
        : [];
    const fees = (await Promise.all(addrs.map((a) => dbc.state.getPoolsFeesByConfig(a)))).flat();
    return { launches: fees.length, authorFees: fees.reduce((a, f) => a + f.partnerQuoteFee.toNumber(), 0) };
  }, [connection, address]);

  return (
    <div className="card stack">
      <div className="row between">
        <h3 style={{ fontSize: 20 }}>{p.name}</h3>
        {p.eventLinked ? <span className="badge badge-accent">event-linked</span> : address ? <span className="badge badge-yes">published</span> : <span className="badge">not on {NETWORK}</span>}
      </div>
      <p className="muted small">{p.tagline}</p>
      <CurveChart points={points} height={120} />
      <div className="row between small num">
        <span>mcap {+(price(cfg.sqrtStartPrice) * 1e9).toPrecision(3)} → {+(p.migrationMcap * SCALE).toPrecision(3)} SOL</span>
        <span>graduates after {fmtSol(Number(cfg.migrationQuoteThreshold.toString()))} SOL raised</span>
      </div>
      <ul className="small" style={{ margin: 0, paddingLeft: 18, color: "var(--muted)" }}>
        {p.facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <dl className="kv small">
        <dt>Launches</dt>
        <dd className="num">{stats.data?.launches ?? "…"}</dd>
        <dt>Author fees (unclaimed)</dt>
        <dd className="num">{stats.data ? `${fmtSol(stats.data.authorFees, 4)} SOL` : "…"}</dd>
        {address && (
          <>
            <dt>Config</dt>
            <dd>
              <a className="num" href={explorer(address)} target="_blank" rel="noreferrer">{short(address)} ↗</a>
            </dd>
          </>
        )}
      </dl>
      <Link className="btn btn-sm" href={p.eventLinked ? "/launch" : `/launch?preset=${p.id}`}>
        Launch with {p.name}
      </Link>
    </div>
  );
}

function Publish() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [preset, setPreset] = useState<Exclude<PresetId, "event-horizon">>("flat");
  const [fee, setFee] = useState("0.05");
  const [published, setPublished] = useState<string | null>(null);
  const { send, log, busy } = useSendSteps();

  async function publish() {
    if (!wallet.publicKey) return setVisible(true);
    const r = await publishPresetStep(connection, preset, wallet.publicKey, new PublicKey(PLATFORM), { scale: SCALE, creationFeeSol: Number(fee) });
    await send([r.step]).then(() => setPublished(r.config.toBase58()), () => undefined);
  }

  return (
    <section className="card stack" style={{ marginTop: 28, maxWidth: 560 }}>
      <div className="section-title" style={{ margin: 0 }}>Publish your own copy</div>
      <p className="muted small">
        Deploy a preset as your own DBC config. You become its fee claimer: every launch on it pays you the creation fee below plus half of its trading fees.
      </p>
      <div className="row">
        <select className="input" value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}>
          <option value="flat">Flat</option>
          <option value="long">Long Curve</option>
          <option value="parabolic">Parabolic</option>
        </select>
        <input className="input num" type="number" min="0.001" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} aria-label="Creation fee in SOL" />
        <span className="muted small">SOL / launch</span>
      </div>
      <button className="btn btn-primary" disabled={busy || !(Number(fee) >= 0.001)} onClick={publish}>
        {wallet.publicKey ? (busy ? "Publishing…" : "Publish config") : "Connect wallet"}
      </button>
      <StepLog log={log} />
      {published && (
        <p className="small">
          Published <a className="num" href={explorer(published)} target="_blank" rel="noreferrer">{short(published)} ↗</a>.{" "}
          <Link style={{ color: "var(--accent)" }} href={`/launch?preset=${preset}&config=${published}`}>
            Launch on it →
          </Link>
        </p>
      )}
    </section>
  );
}
