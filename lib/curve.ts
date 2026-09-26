// Turns a DBC curve (start sqrt price + up to 16 segments) into chartable points:
// x = SOL raised so far, y = token price in SOL. Works on builder output and on-chain configs.
import type BN from "bn.js";
import { getDeltaAmountQuoteUnsigned, getPriceFromSqrtPrice, Rounding } from "@meteora-ag/dynamic-bonding-curve-sdk";

type CurveLike = { sqrtStartPrice: BN; curve: { sqrtPrice: BN; liquidity: BN }[]; migrationQuoteThreshold: BN };

export type CurvePoint = { raised: number; price: number };

const SUPPLY = 1e9;

export function curvePoints(c: CurveLike, stepsPerSegment = 6): CurvePoint[] {
  const threshold = Number(c.migrationQuoteThreshold.toString()) / 1e9;
  const pts: CurvePoint[] = [{ raised: 0, price: price(c.sqrtStartPrice) }];
  let lower = c.sqrtStartPrice;
  let raised = 0;
  for (const seg of c.curve) {
    if (seg.liquidity.isZero()) break;
    // Sample inside the segment so constant-product curvature shows.
    for (let k = 1; k <= stepsPerSegment; k++) {
      const upper = lower.add(seg.sqrtPrice.sub(lower).muln(k).divn(stepsPerSegment));
      const dq = Number(getDeltaAmountQuoteUnsigned(lower, upper, seg.liquidity, Rounding.Up).toString()) / 1e9;
      if (raised + dq >= threshold) {
        pts.push({ raised: threshold, price: price(upper) });
        return pts;
      }
      if (k === stepsPerSegment) {
        raised += dq;
        pts.push({ raised, price: price(upper) });
      } else pts.push({ raised: raised + dq, price: price(upper) });
    }
    lower = seg.sqrtPrice;
  }
  return pts;
}

export const price = (sqrtPrice: BN) => Number(getPriceFromSqrtPrice(sqrtPrice, 6, 9).toString());
export const mcapSol = (sqrtPrice: BN) => price(sqrtPrice) * SUPPLY;
