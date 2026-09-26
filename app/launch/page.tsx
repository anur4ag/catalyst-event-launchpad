"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { launchSteps } from "@/lib/actions";
import { PLATFORM, PRESET_CONFIGS, SCALE, NETWORK } from "@/lib/config";
import { fmtSol, pantaGet, useLoad, useSendSteps } from "@/lib/client";
import { curvePoints, price } from "@/lib/curve";
import { metaUri } from "@/lib/launches";
import { toUnix, type Market } from "@/lib/panta";
import { PRESETS, type PresetId } from "@/lib/presets";
import { CurveChart, DataSourceNote, Odds, StepLog } from "@/components/ui";

const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function LaunchPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [category, setCategory] = useState<string>("");
  const [marketId, setMarketId] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetId>("event-horizon");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [firstBuy, setFirstBuy] = useState("0.05");
  const [pool, setPool] = useState<string | null>(null);
  const { send, log, busy } = useSendSteps();
  // ?preset=flat&config=<addr> comes from the presets page ("Launch on it").
  const [customConfig, setCustomConfig] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("preset");
    if (id && id in PRESETS) setPreset(id as PresetId);
    setCustomConfig(q.get("config"));
  }, []);

  const cats = useLoad(() => pantaGet<{ categories: string[] }>("categories/"), []);
  const list = useLoad(() => pantaGet<{ items: Market[] }>("markets/", category ? { category } : undefined), [category]);
  const market = useLoad(async () => (marketId ? pantaGet<Market>(`markets/${marketId}/`) : null), [marketId]);
  const m = market.data;
  const resolutionTime = m ? toUnix(m.resolutionTime) : undefined;

  const p = PRESETS[preset];
  const configFor = (id: PresetId) => (customConfig && id === preset ? customConfig : PRESET_CONFIGS[id]);
  const presetConfig = p.eventLinked ? undefined : configFor(preset);
  const available = (id: PresetId) => (PRESETS[id].eventLinked ? !!marketId : !!configFor(id));

  const cfg = useMemo(() => {
    try {
      return p.build({ scale: SCALE, resolutionTime: resolutionTime ?? Math.floor(Date.now() / 1000) + 30 * 86_400 });
    } catch {
      return null;
    }
  }, [p, resolutionTime]);
  const points = useMemo(() => (cfg ? curvePoints(cfg) : []), [cfg]);

  const pick = (mk: Market) => {
    setMarketId(mk.marketId);
    setPreset("event-horizon");
    if (!symbol) setSymbol(suggestSymbol(mk.title));
    if (!name) setName(mk.title.replace(/\?$/, "").slice(0, 32));
  };

  const valid = name.trim().length > 0 && name.length <= 32 && /^[A-Z0-9]{2,10}$/.test(symbol) && available(preset) && Number(firstBuy) >= 0;

  async function launch() {
    if (!wallet.publicKey) return setVisible(true);
    const r = await launchSteps(connection, {
      preset,
      presetConfig: presetConfig ? new PublicKey(presetConfig) : undefined,
      creator: wallet.publicKey,
      platform: new PublicKey(PLATFORM),
      resolutionTime,
      scale: SCALE,
      name: name.trim(),
      symbol,
      uri: metaUri(window.location.origin, { marketId: p.eventLinked ? marketId : null, name: name.trim(), symbol }),
      firstBuySol: Number(firstBuy),
    });
    await send(r.steps).catch(() => undefined);
    setPool(r.pool.toBase58());
  }

  return (
    <div style={{ padding: "40px 0" }}>
      <h1 style={{ fontSize: 34, marginBottom: 8 }}>Launch an event token</h1>
      <p className="muted" style={{ marginBottom: 28 }}>
        Pick a real-world event, pick a curve, name your token. Takes three wallet approvals or fewer.
      </p>
      <div className="split">
        <div className="stack" style={{ gap: 20 }}>
          <section className="card stack">
            <div className="section-title">1 · Pick the catalyst</div>
            <div className="chips">
              {["", ...(cats.data?.categories ?? [])].map((c) => (
                <button key={c || "all"} className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
                  {c || "all"}
                </button>
              ))}
            </div>
            {list.error && <p className="notice">Panta: {list.error}</p>}
            <div className="list">
              {list.data?.items.map((mk) => (
                <button
                  key={mk.marketId}
                  onClick={() => pick(mk)}
                  className="row between"
                  style={{ background: "none", border: 0, borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left", padding: "12px 4px", color: marketId === mk.marketId ? "var(--accent)" : undefined }}
                >
                  <span>
                    <span className="badge" style={{ marginRight: 8 }}>{mk.category}</span>
                    {mk.title}
                  </span>
                  <span className="faint small num" style={{ whiteSpace: "nowrap" }}>
                    ends {fmtDate(toUnix(mk.endTime))}
                  </span>
                </button>
              ))}
              {list.loading && <span className="muted small">Loading events…</span>}
            </div>
            <DataSourceNote mode={list.data?._mode} disclaimer={list.data?.disclaimer} />
            {marketId && (
              <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setMarketId(null)}>
                Launch without an event instead
              </button>
            )}
          </section>

          <section className="card stack">
            <div className="section-title">2 · Pick a curve</div>
            {(Object.keys(PRESETS) as PresetId[]).map((id) => (
              <label key={id} className="row" style={{ alignItems: "flex-start", cursor: available(id) ? "pointer" : "not-allowed", opacity: available(id) ? 1 : 0.5 }}>
                <input type="radio" name="preset" checked={preset === id} disabled={!available(id)} onChange={() => setPreset(id)} style={{ marginTop: 5 }} />
                <span>
                  <strong>{PRESETS[id].name}</strong>
                  {PRESETS[id].eventLinked && <span className="badge badge-accent" style={{ marginLeft: 8 }}>event-linked</span>}
                  <div className="muted small">
                    {PRESETS[id].tagline}
                    {!available(id) && (PRESETS[id].eventLinked ? " Pick an event first." : ` Not published on ${NETWORK} yet.`)}
                  </div>
                </span>
              </label>
            ))}
          </section>

          <section className="card stack">
            <div className="section-title">3 · Your token</div>
            <label className="stack" style={{ gap: 6 }}>
              <span className="label">Name (max 32)</span>
              <input className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="BTC 150K by New Year" />
            </label>
            <label className="stack" style={{ gap: 6 }}>
              <span className="label">Symbol (2–10 letters or digits)</span>
              <input className="input num" value={symbol} maxLength={10} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="BTC150K" />
            </label>
            <label className="stack" style={{ gap: 6 }}>
              <span className="label">Your first buy (SOL, optional{p.eventLinked ? "; skips the anti-sniper fee" : ""})</span>
              <input className="input num" type="number" min="0" step="0.01" value={firstBuy} onChange={(e) => setFirstBuy(e.target.value)} />
            </label>
          </section>
        </div>

        <aside className="card stack" style={{ position: "sticky", top: 84 }}>
          <div className="section-title">Summary</div>
          {m && (
            <div className="stack" style={{ gap: 8 }}>
              <strong>{m.title}</strong>
              <Odds yes={m.yesPrice ? Number(m.yesPrice) : null} />
              <span className="muted small">Resolves {fmtDate(resolutionTime!)}</span>
            </div>
          )}
          {cfg && (
            <>
              <CurveChart points={points} />
              <dl className="kv">
                <dt>Curve</dt>
                <dd>{p.name}</dd>
                <dt>Start market cap</dt>
                <dd className="num">{(price(cfg.sqrtStartPrice) * 1e9).toFixed(2)} SOL</dd>
                <dt>Graduates at</dt>
                <dd className="num">{fmtSol(Number(cfg.migrationQuoteThreshold.toString()))} SOL raised</dd>
                <dt>Then</dt>
                <dd>Meteora DAMM v2 pool</dd>
                {p.eventLinked && (
                  <>
                    <dt>Your 10% allocation</dt>
                    <dd>{resolutionTime ? `locked until ${fmtDate(resolutionTime)}, then 30-day vest` : "locked until the event resolves"}</dd>
                    <dt>Your LP</dt>
                    <dd>locked until resolution</dd>
                    <dt>Launch fee</dt>
                    <dd>50% → 1% over 15 min</dd>
                  </>
                )}
              </dl>
            </>
          )}
          {pool && log.every((s) => s.status === "done") ? (
            <Link className="btn btn-primary btn-block" href={`/t/${pool}`}>
              Open ${symbol} →
            </Link>
          ) : (
            <button className="btn btn-primary btn-block" disabled={busy || (!!wallet.publicKey && !valid)} onClick={launch}>
              {!wallet.publicKey ? "Connect wallet" : busy ? "Launching…" : `Launch $${symbol || "TOKEN"}`}
            </button>
          )}
          <StepLog log={log} />
        </aside>
      </div>
    </div>
  );
}

function suggestSymbol(title: string) {
  const words = title.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 1 && !["WILL", "THE", "ON", "IN", "BY", "BEFORE", "AT", "OF"].includes(w));
  return words.slice(0, 3).map((w, i) => (i === 0 ? w.slice(0, 4) : w.slice(0, 3))).join("").slice(0, 10);
}
