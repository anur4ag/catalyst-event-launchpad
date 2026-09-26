// Builds pitch/Catalyst-pitch.pptx. Speaker notes are the exact narration from VIDEO_SCRIPTS.md, section A.
//   NODE_PATH=~/money/.cache/pitch/node_modules node pitch/build-deck.cjs
const fs = require("node:fs");
const path = require("node:path");
const pptxgen = require("pptxgenjs");

const DIR = __dirname;
const shot = (f) => path.join(DIR, "screenshots", f);
const C = { bg: "0A0B0D", card: "15171B", line: "2A2E35", text: "ECEEF1", muted: "8A9099", accent: "D4FF3F", ink: "141A00" };
const FONT = "Arial";
const W = 13.333;
const H = 7.5;
const M = 0.6; // side margin

// Narration + timing per slide, straight from the script so the notes can't drift from it.
const script = fs.readFileSync(path.join(DIR, "..", "VIDEO_SCRIPTS.md"), "utf8");
const pitch = script.slice(script.indexOf("## A."), script.indexOf("## B."));
const rows = pitch.split("\n").filter((l) => /^\| [1-8] \|/.test(l)).map((l) => l.split("|").map((c) => c.trim()));
if (rows.length !== 8) throw new Error(`expected 8 pitch rows in VIDEO_SCRIPTS.md, found ${rows.length}`);
const notes = rows.map(([, n, time, , said]) => `Slide ${n} · ${time}\n\n${said.replace(/^"|"$/g, "")}`);

const pngSize = (f) => {
  const b = fs.readFileSync(f);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.title = "Catalyst: pitch";
pres.author = "Anurag Sharma";

function base(n, kicker) {
  const s = pres.addSlide();
  s.background = { color: C.bg };
  if (kicker) {
    s.addShape(pres.shapes.OVAL, { x: M, y: 0.62, w: 0.16, h: 0.16, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText(kicker.toUpperCase(), { x: M + 0.28, y: 0.5, w: 8, h: 0.4, margin: 0, fontFace: FONT, fontSize: 14, bold: true, color: C.muted, charSpacing: 3, isTextBox: true });
  }
  s.addText("catalyst-event-launchpad.vercel.app   ·   x.com/anur7ag", { x: M, y: H - 0.55, w: 8, h: 0.3, margin: 0, fontFace: FONT, fontSize: 11, color: C.muted, isTextBox: true });
  s.addText(`${n} / 8`, { x: W - M - 1.5, y: H - 0.55, w: 1.5, h: 0.3, margin: 0, fontFace: FONT, fontSize: 11, color: C.muted, align: "right", isTextBox: true });
  s.addNotes(notes[n - 1]);
  return s;
}

const title = (s, text, opts = {}) =>
  s.addText(text, { x: M, y: 1.0, w: opts.w ?? W - 2 * M, h: 1.0, margin: 0, fontFace: FONT, fontSize: 44, bold: true, color: C.text, valign: "top", isTextBox: true });

// An image placed inside a box, keeping its aspect ratio, with a thin frame.
function image(s, file, box, caption) {
  const { w: pw, h: ph } = pngSize(file);
  const scale = Math.min(box.w / pw, box.h / ph);
  const w = pw * scale;
  const h = ph * scale;
  const x = box.x + (box.w - w) / 2;
  const y = box.y;
  s.addImage({ path: file, x, y, w, h, altText: caption ?? path.basename(file) });
  s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: C.bg, transparency: 100 }, line: { color: C.line, width: 1 } });
  if (caption) s.addText(caption, { x, y: y + h + 0.1, w, h: 0.3, margin: 0, fontFace: FONT, fontSize: 11, color: C.muted, isTextBox: true });
  return { x, y, w, h };
}

// Numbered rows: a lime dot with the number, then one short line.
function steps(s, items, x, y, w, gap = 1.05) {
  items.forEach((t, i) => {
    s.addShape(pres.shapes.OVAL, { x, y: y + i * gap, w: 0.56, h: 0.56, fill: { color: C.accent }, line: { color: C.accent } });
    s.addText(String(i + 1), { x, y: y + i * gap, w: 0.56, h: 0.56, margin: 0, fontFace: FONT, fontSize: 20, bold: true, color: C.ink, align: "center", valign: "middle", isTextBox: true });
    s.addText(t, { x: x + 0.8, y: y + i * gap - 0.07, w: w - 0.8, h: 0.7, margin: 0, fontFace: FONT, fontSize: 24, color: C.text, valign: "middle", isTextBox: true });
  });
}

// 1. Title
{
  const s = base(1);
  s.addImage({ path: path.join(DIR, "..", "submission", "logo.png"), x: W - M - 3.6, y: 1.55, w: 3.6, h: 3.6, altText: "Catalyst logo" });
  s.addText("Catalyst", { x: M, y: 1.7, w: 8, h: 1.5, margin: 0, fontFace: FONT, fontSize: 96, bold: true, color: C.text, isTextBox: true });
  s.addText("Launch tokens on what happens next.", { x: M, y: 3.25, w: 8, h: 0.8, margin: 0, fontFace: FONT, fontSize: 32, color: C.accent, isTextBox: true });
  s.addText("Built on Meteora DBC, DAMM v2, DLMM  ·  Event data from Panta", { x: M, y: 4.35, w: 8, h: 0.5, margin: 0, fontFace: FONT, fontSize: 18, color: C.muted, isTextBox: true });
}

// 2. The problem
{
  const s = base(2, "The problem");
  title(s, "Launchpads ignore the moment");
  const items = ["Launches ride on real-world moments", "Creators can dump when the hype peaks", "Every launchpad rebuilds the same curve math"];
  const cw = (W - 2 * M - 2 * 0.4) / 3;
  items.forEach((t, i) => {
    const x = M + i * (cw + 0.4);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.5, w: cw, h: 3.6, rectRadius: 0.15, fill: { color: C.card }, line: { color: C.line, width: 1 } });
    s.addText(`0${i + 1}`, { x: x + 0.4, y: 2.85, w: cw - 0.8, h: 0.9, margin: 0, fontFace: FONT, fontSize: 48, bold: true, color: C.accent, isTextBox: true });
    s.addText(t, { x: x + 0.4, y: 3.95, w: cw - 0.8, h: 1.9, margin: 0, fontFace: FONT, fontSize: 26, color: C.text, valign: "top", isTextBox: true });
  });
}

// 3. How Catalyst works
{
  const s = base(3, "Catalyst");
  title(s, "How it works", { w: 5 });
  steps(s, ["Pick a real event", "Pick a curve preset", "Launch in one or two approvals"], M, 2.45, 5.0, 1.15);
  image(s, shot("launch-crop.png"), { x: 5.75, y: 1.0, w: W - M - 5.75, h: 5.35 }, "Live app: /launch with a Panta event selected (Solana devnet)");
}

// 4. After the curve fills: DBC -> DAMM v2 -> DLMM
{
  const s = base(4, "After the curve fills");
  title(s, "Graduation, then real liquidity");
  const boxes = [
    ["DBC curve", "Meteora bonding curve"],
    ["DAMM v2 pool", "Anyone can graduate it"],
    ["DLMM range", "Optional, beside the pool"],
  ];
  const bw = 3.35;
  const gap = (W - 2 * M - 3 * bw) / 2;
  boxes.forEach(([h, sub], i) => {
    const x = M + i * (bw + gap);
    const hot = i === 1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.2, w: bw, h: 1.25, rectRadius: 0.12, fill: { color: hot ? C.accent : C.card }, line: { color: hot ? C.accent : C.line, width: 1 } });
    s.addText(h, { x: x + 0.25, y: 2.33, w: bw - 0.5, h: 0.55, margin: 0, fontFace: FONT, fontSize: 24, bold: true, color: hot ? C.ink : C.text, isTextBox: true });
    s.addText(sub, { x: x + 0.25, y: 2.88, w: bw - 0.5, h: 0.4, margin: 0, fontFace: FONT, fontSize: 15, color: hot ? C.ink : C.muted, isTextBox: true });
    if (i < 2) s.addShape(pres.shapes.LINE, { x: x + bw + 0.12, y: 2.825, w: gap - 0.24, h: 0, line: { color: C.accent, width: 2.5, endArrowType: "triangle" } });
  });
  image(s, shot("damm-liquidity.png"), { x: M, y: 3.7, w: 4.6, h: 2.65 }, "Live: a graduated token's DAMM v2 positions");
  s.addText(
    [
      { text: "Event Horizon: creator LP locked, still earning fees", options: { bullet: true, breakLine: true } },
      { text: "Trades go to whichever pool pays more", options: { bullet: true } },
    ],
    { x: 5.95, y: 4.05, w: W - M - 5.95, h: 1.9, margin: 0, fontFace: FONT, fontSize: 24, color: C.text, paraSpaceAfter: 14, valign: "top", isTextBox: true },
  );
}

// 5. Why Meteora + Panta
{
  const s = base(5, "Why Meteora + Panta");
  title(s, "No custom contract", { w: 7.0 });
  const card = (y, head, lines) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: M, y, w: 6.6, h: lines.length > 1 ? 1.95 : 1.4, rectRadius: 0.12, fill: { color: C.card }, line: { color: C.line, width: 1 } });
    s.addText(head, { x: M + 0.35, y: y + 0.22, w: 6, h: 0.5, margin: 0, fontFace: FONT, fontSize: 24, bold: true, color: C.accent, isTextBox: true });
    s.addText(
      lines.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < lines.length - 1 } })),
      { x: M + 0.35, y: y + 0.78, w: 6, h: lines.length * 0.5, margin: 0, fontFace: FONT, fontSize: 22, color: C.text, paraSpaceAfter: 6, isTextBox: true },
    );
  };
  card(2.35, "Meteora", ["Curve, fees and locks live on-chain", "Graduation and DLMM built in"]);
  card(4.6, "Panta", ["Live events and dates, used as data"]);
  image(s, shot("token-page-crop.png"), { x: 7.65, y: 1.0, w: W - M - 7.65, h: 5.35 }, "Live token page: Meteora curve + Panta event data");
}

// 6. Built and working today
{
  const s = base(6, "Built and working today");
  title(s, "Live on Solana devnet");
  const stats = [
    ["4", "curve presets"],
    ["30+", "automated tests"],
    ["8", "steps in the full\non-chain test"],
  ];
  const cw = (W - 2 * M - 2 * 0.4) / 3;
  stats.forEach(([big, label], i) => {
    const x = M + i * (cw + 0.4);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.35, w: cw, h: 2.6, rectRadius: 0.15, fill: { color: C.card }, line: { color: C.line, width: 1 } });
    s.addText(big, { x: x + 0.4, y: 2.6, w: cw - 0.8, h: 1.3, margin: 0, fontFace: FONT, fontSize: 72, bold: true, color: C.accent, isTextBox: true });
    s.addText(label, { x: x + 0.4, y: 3.95, w: cw - 0.8, h: 0.8, margin: 0, fontFace: FONT, fontSize: 22, color: C.text, valign: "top", isTextBox: true });
  });
  s.addText(
    [
      { text: "Launch, trading, graduation, locks, DLMM, presets all work.  ", options: { color: C.text } },
      { text: "No users yet. That's next.", options: { color: C.accent, bold: true } },
    ],
    { x: M, y: 5.35, w: W - 2 * M, h: 0.6, margin: 0, fontFace: FONT, fontSize: 22, isTextBox: true },
  );
}

// 7. Go to market: India first
{
  const s = base(7, "Go to market");
  title(s, "India first", { w: 5.2 });
  steps(s, ["Community builders launch on shared presets", "Preset authors earn fees on every launch", "Start with Superteam India and hackathon groups"], M, 2.35, 5.3, 1.3);
  image(s, shot("presets-crop.png"), { x: 6.2, y: 1.0, w: W - M - 6.2, h: 5.35 }, "Live app: the preset marketplace (/presets)");
}

// 8. Team + ask
{
  const s = base(8, "Team");
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: M, y: 1.2, w: 3.3, h: 3.3, rectRadius: 0.2, fill: { color: C.card }, line: { color: C.accent, width: 2, dashType: "dash" } });
  s.addText("Your photo here", { x: M, y: 1.2, w: 3.3, h: 3.3, margin: 0, fontFace: FONT, fontSize: 18, color: C.muted, align: "center", valign: "middle", isTextBox: true });
  s.addText("Anurag Sharma", { x: M, y: 4.75, w: 5, h: 0.6, margin: 0, fontFace: FONT, fontSize: 30, bold: true, color: C.text, isTextBox: true });
  s.addText("Solo builder · India", { x: M, y: 5.35, w: 5, h: 0.45, margin: 0, fontFace: FONT, fontSize: 20, color: C.muted, isTextBox: true });
  s.addText("The ask", { x: 5.4, y: 1.0, w: 7, h: 1.0, margin: 0, fontFace: FONT, fontSize: 44, bold: true, color: C.text, isTextBox: true });
  steps(s, ["Try Catalyst on devnet", "Tell me which curves you'd use", "Help take it to mainnet"], 5.4, 2.35, W - M - 5.4, 1.15);
  s.addText("catalyst-event-launchpad.vercel.app", { x: 5.4, y: 5.85, w: W - M - 5.4, h: 0.5, margin: 0, fontFace: FONT, fontSize: 22, bold: true, color: C.accent, isTextBox: true });
}

pres.writeFile({ fileName: path.join(DIR, "Catalyst-pitch.pptx") }).then((f) => console.log(`✓ ${f}`));
