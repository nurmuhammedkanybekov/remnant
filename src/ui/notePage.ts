/**
 * A note as the thing it is. Records (a log entry, a protocol, a roster: a
 * note that opens with a heading in capitals) are typed on a form, with the
 * heading in a ruled box; letters (signed "— Mara") and scrawls are written
 * by hand on lined paper, the signature set off on its own line. Every page
 * gets its own small differences, seeded from its text so they're the same
 * every time you read it: a tilt, where it was folded, a stain.
 */

export type PageKind = "typed" | "letter" | "scrawl";

export interface NotePage {
  kind: PageKind;
  /** A typed record's heading ("ARKADIN, LOG 151 (1990)."), without the body. */
  heading: string | null;
  body: string;
  /** A letter's signature, without the dash ("Mara"). */
  signature: string | null;
  /** Small seeded differences: degrees of tilt, the fold (0..1 down the page), a stain (x, y in 0..1, or none). */
  tilt: number;
  fold: number;
  stain: { x: number; y: number; size: number } | null;
}

/**
 * A heading: capitals, digits and the punctuation of a record, then a full
 * stop or colon, then the text. "DAY 4." counts; "Scratched into the duct:"
 * doesn't (it isn't in capitals).
 */
const HEADING = /^([A-Z0-9][A-Z0-9 ,'’()\-—–./&#]*?[A-Z0-9)][.:])\s+(?=\S)/;
/** A signature: a dash and a short name at the very end. */
const SIGNATURE = /\s+[—–-]\s*([A-Z][\w.() ]{0,22}|\(no name\))$/;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function notePage(text: string): NotePage {
  const t = text.trim();
  let r = hash(t);
  const next = () => {
    r = Math.imul(r ^ (r >>> 15), 2246822507) >>> 0;
    r = (r ^ (r >>> 13)) >>> 0;
    return (r % 10000) / 10000;
  };
  const tilt = (next() - 0.5) * 3.2;
  const fold = 0.36 + next() * 0.28;
  const stain = next() < 0.45 ? { x: 0.15 + next() * 0.7, y: 0.15 + next() * 0.7, size: 0.18 + next() * 0.16 } : null;

  const heading = HEADING.exec(t);
  // At least three capital letters, or it's a sentence that happens to start with one ("I.").
  if (heading && (heading[1].match(/[A-Z]/g) ?? []).length >= 3) {
    return { kind: "typed", heading: heading[1], body: t.slice(heading[0].length), signature: null, tilt, fold, stain };
  }
  const sig = SIGNATURE.exec(t);
  if (sig) return { kind: "letter", heading: null, body: t.slice(0, sig.index), signature: sig[1], tilt, fold, stain };
  return { kind: "scrawl", heading: null, body: t, signature: null, tilt, fold, stain };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The page's inner HTML and the inline style for its container (tilt, fold, stain). */
export function notePageHtml(text: string, place: string | null = null): { html: string; className: string; style: string } {
  const p = notePage(text);
  const parts: string[] = [];
  if (place) parts.push(`<div class="where">${esc(place.toUpperCase())}</div>`);
  if (p.heading) parts.push(`<div class="head">${esc(p.heading)}</div>`);
  parts.push(`<p>${esc(p.body)}</p>`);
  if (p.signature) parts.push(`<div class="sig">— ${esc(p.signature)}</div>`);
  const style = [
    `--tilt:${p.tilt.toFixed(2)}deg`,
    `--fold:${(p.fold * 100).toFixed(1)}%`,
    p.stain
      ? `--stain-x:${(p.stain.x * 100).toFixed(1)}%;--stain-y:${(p.stain.y * 100).toFixed(1)}%;--stain-r:${(p.stain.size * 100).toFixed(1)}%`
      : "--stain-r:0%",
  ].join(";");
  return { html: parts.join(""), className: `page ${p.kind}`, style };
}
