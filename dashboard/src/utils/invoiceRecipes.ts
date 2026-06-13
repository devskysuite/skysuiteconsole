// Auto-learning invoice recipes.
//
// When the AI reads an invoice for a new vendor it also returns a reusable
// "recipe" (regexes for the line items + key fields). We store these in the
// `invoiceRecipes` Firestore collection and, on future imports, apply the
// matching recipe in the browser for FREE — only falling back to the paid AI
// call when no recipe matches or a recipe's output fails validation.

import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../firebase";

export interface InvoiceRecipe {
  vendorKey: string;
  detect: string;            // lowercase substring that identifies this vendor in the raw text
  lineRegex: string;
  flags: string;
  dateRegex?: string;
  invoiceRegex?: string;
  poRegex?: string;
  subtotalRegex?: string;
  taxRegex?: string;
  totalRegex?: string;
  taxLabel?: string;
  vendor?: string;
}

// Neutral parsed shape shared with the AI output.
export interface NeutralParsed {
  vendor: string;
  invoiceNumber: string;
  poNumber: string;
  date: string;
  taxLabel: string;
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
  isCreditCard?: boolean;
  lines: Array<{ partNo: string; description: string; qty: number; uom: string; unitPrice: number; total: number; taxable: boolean }>;
}

// Detect whether a document is a credit-card order. Credit-card orders are paid
// and shipped immediately, so on import we treat ordered qty as fully received.
// Runs on the raw text so it works for every parse tier (regex / recipe / AI).
export function detectCreditCard(text: string): boolean {
  const t = text.toLowerCase();
  if (/credit\s*card/.test(t)) return true;
  // A card brand named alongside payment wording.
  if (/payment/.test(t) && /\b(visa|mastercard|master\s*card|amex|american\s*express|debit)\b/.test(t)) return true;
  // A masked card number, e.g. ****1234 or xxxx-xxxx-xxxx-1234.
  if (/(\*{2,}\s*\d{4})|((?:x{4}[\s-]*){2,}\d{4})/i.test(text)) return true;
  return false;
}

let _cache: InvoiceRecipe[] | null = null;

/** Load all saved recipes (cached for the session). */
export async function loadRecipes(): Promise<InvoiceRecipe[]> {
  if (_cache) return _cache;
  try {
    const snap = await getDocs(collection(db, "invoiceRecipes"));
    _cache = snap.docs.map(d => d.data() as InvoiceRecipe).filter(r => r?.lineRegex && r?.detect);
  } catch {
    _cache = [];
  }
  return _cache;
}

/** Find a saved recipe whose `detect` string appears in the document text. */
export function matchRecipe(recipes: InvoiceRecipe[], text: string): InvoiceRecipe | null {
  const t = text.toLowerCase();
  return recipes.find(r => r.detect && t.includes(r.detect)) || null;
}

function num(s: string | undefined): number {
  if (!s) return 0;
  return parseFloat(s.replace(/[^0-9.\-]/g, "")) || 0;
}

function field(text: string, pattern?: string, flags = "i"): string {
  if (!pattern) return "";
  try {
    const m = text.match(new RegExp(pattern, flags));
    return m?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

/** Apply a recipe to the extracted text. Returns null if it compiles wrong or finds nothing. */
export function applyRecipe(recipe: InvoiceRecipe, lines: string[]): NeutralParsed | null {
  let re: RegExp;
  try {
    re = new RegExp(recipe.lineRegex, (recipe.flags || "i").replace(/[^gimsuy]/g, ""));
  } catch {
    return null;
  }

  const text = lines.join("\n");
  const out: NeutralParsed = {
    vendor: recipe.vendor || "",
    invoiceNumber: field(text, recipe.invoiceRegex),
    poNumber: field(text, recipe.poRegex),
    date: field(text, recipe.dateRegex),
    taxLabel: recipe.taxLabel || "Tax",
    subtotal: num(field(text, recipe.subtotalRegex)),
    taxAmount: num(field(text, recipe.taxRegex)),
    grandTotal: num(field(text, recipe.totalRegex)),
    lines: [],
  };

  // Run the line regex against each line (cap to avoid pathological inputs).
  for (const line of lines.slice(0, 800)) {
    let m: RegExpMatchArray | null = null;
    try { m = line.match(re); } catch { return null; }
    const g = m?.groups;
    if (!g) continue;
    const qty = num(g.qty);
    const unitPrice = num(g.unitPrice);
    const total = num(g.total);
    if (!(qty > 0) || !(total > 0)) continue;
    out.lines.push({
      partNo: (g.partNo || "").trim(),
      description: (g.description || "").trim(),
      qty, uom: (g.uom || "EA").trim() || "EA",
      unitPrice, total, taxable: true,
    });
  }

  if (out.lines.length === 0) return null;
  if (!out.grandTotal) out.grandTotal = out.subtotal + out.taxAmount;
  return out;
}

/** Validate a recipe's output before trusting it: per-line arithmetic + total reconciliation. */
export function validateParsed(p: NeutralParsed | null): boolean {
  if (!p || p.lines.length === 0) return false;
  // Every line's qty x unitPrice must be within 5% (+5¢) of its stated total.
  for (const l of p.lines) {
    if (!(l.qty > 0) || !(l.unitPrice > 0) || !(l.total > 0)) return false;
    if (Math.abs(l.qty * l.unitPrice - l.total) > l.total * 0.05 + 0.05) return false;
  }
  // If a subtotal was captured, the line totals must add up to it (within 2% / 50¢).
  const lineSum = p.lines.reduce((s, l) => s + l.total, 0);
  if (p.subtotal > 0 && Math.abs(lineSum - p.subtotal) > Math.max(0.5, p.subtotal * 0.02)) return false;
  return true;
}

/** Persist (or refresh) a recipe returned by the AI. */
export async function saveRecipe(recipe: InvoiceRecipe & { vendor?: string }): Promise<void> {
  if (!recipe?.vendorKey || !recipe?.lineRegex || !recipe?.detect) return;
  try {
    await setDoc(doc(db, "invoiceRecipes", recipe.vendorKey), {
      ...recipe,
      updatedAt: new Date().toISOString(),
      source: "ai",
    }, { merge: true });
    _cache = null; // invalidate cache so the new recipe is picked up next import
  } catch (e) {
    console.warn("[invoiceRecipes] save failed:", e);
  }
}
