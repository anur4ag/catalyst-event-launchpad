"use client";
// Small shared UI pieces.
import type { CurvePoint } from "@/lib/curve";
import { explorer } from "@/lib/config";
import { pct } from "@/lib/client";

export function CurveChart({ points, raised, height = 160 }: { points: CurvePoint[]; raised?: number; height?: number }) {
  if (points.length < 2) return null;
  const W = 600;
  const H = height;
  const maxX = points.at(-1)!.raised || 1;
  const maxY = points.at(-1)!.price;
  const minY = points[0].price;
  const x = (v: number) => (v / maxX) * W;
  const y = (v: number) => H - 8 - ((v - minY) / (maxY - minY || 1)) * (H - 24);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.raised).toFixed(1)},${y(p.price).toFixed(1)}`).join("");
  const at = raised === undefined ? null : points.find((p) => p.raised >= raised) ?? points.at(-1)!;
  const filled = raised === undefined ? "" : points.filter((p) => p.raised <= raised);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Bonding curve: price against SOL raised">
      <path d={`${line}L${W},${H}L0,${H}Z`} fill="color-mix(in srgb, var(--accent) 7%, transparent)" />
      {filled && filled.length > 1 && (
        <path
          d={`${filled.map((p, i) => `${i ? "L" : "M"}${x(p.raised)},${y(p.price)}`).join("")}L${x(filled.at(-1)!.raised)},${H}L0,${H}Z`}
          fill="color-mix(in srgb, var(--accent) 22%, transparent)"
        />
      )}
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {at && <circle cx={x(Math.min(raised!, maxX))} cy={y(at.price)} r="5" fill="var(--accent)" stroke="var(--bg)" strokeWidth="2" />}
    </svg>
  );
}

export function Odds({ yes }: { yes: number | null }) {
  if (yes === null || !Number.isFinite(yes)) return <span className="muted small">No live price</span>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row between small num">
        <span style={{ color: "var(--yes)" }}>YES {pct(yes)}</span>
        <span style={{ color: "var(--no)" }}>NO {pct(1 - yes)}</span>
      </div>
      <div className="odds" aria-hidden>
        <div className="y" style={{ width: `${yes * 100}%` }} />
        <div className="n" style={{ width: `${(1 - yes) * 100}%` }} />
      </div>
    </div>
  );
}

export function StepLog({ log }: { log: { label: string; status: string; sig?: string; error?: string }[] }) {
  if (!log.length) return null;
  return (
    <div className="steps">
      {log.map((s, i) => (
        <div key={i} className={s.status}>
          {s.status === "done" ? "✓" : s.status === "error" ? "✕" : "…"} {s.label}
          {s.sig && (
            <a className="faint" href={explorer(s.sig, "tx")} target="_blank" rel="noreferrer">
              {" "}
              view ↗
            </a>
          )}
          {s.error && <div className="small">{s.error}</div>}
        </div>
      ))}
    </div>
  );
}

export function Avatar({ uri, symbol }: { uri?: string; symbol: string }) {
  let src = `/api/meta/-?s=${encodeURIComponent(symbol)}&img=1`;
  try {
    if (uri) {
      const u = new URL(uri);
      u.searchParams.set("img", "1");
      src = `${u.pathname}${u.search}`; // same app serves it, whatever origin the uri was minted on
    }
  } catch {}
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="avatar" src={src} alt="" />;
}

export function DataSourceNote({ mode, disclaimer }: { mode?: string; disclaimer?: string }) {
  if (disclaimer) return <p className="faint small">{disclaimer}</p>;
  if (mode === "mock") return <p className="faint small">Demo data: no Panta key configured. Nothing here is live.</p>;
  return null;
}
