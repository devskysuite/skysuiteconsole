/**
 * parseInvoiceAI
 *
 * Callable function. Receives the raw extracted text of an invoice / packing slip
 * PDF and uses Claude to return structured line items + totals for ANY vendor
 * layout. The front-end calls this only when the free regex parsers come up empty,
 * so we only pay for documents the local parsers can't handle.
 *
 * Requires secret ANTHROPIC_API_KEY (set via: firebase functions:secrets:set ANTHROPIC_API_KEY).
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// Cheap, fast model — invoice extraction doesn't need a large model.
const MODEL = "claude-haiku-4-5-20251001";

const INVOICE_TOOL = {
  name: "submit_invoice",
  description: "Return the structured contents of the supplier invoice or packing slip.",
  input_schema: {
    type: "object",
    properties: {
      vendor: { type: "string", description: "Supplier / vendor company name." },
      invoiceNumber: { type: "string", description: "Invoice, order, or acknowledgement number. Empty string if none." },
      poNumber: { type: "string", description: "Customer purchase order reference, if shown. Empty string if none." },
      date: { type: "string", description: "Document date in ISO format YYYY-MM-DD. Empty string if none." },
      lines: {
        type: "array",
        description: "One entry per physical line item. Exclude shipping, freight, tax, and summary rows.",
        items: {
          type: "object",
          properties: {
            partNo: { type: "string", description: "Manufacturer/supplier part number or SKU. Empty string if none." },
            description: { type: "string", description: "Human-readable item description." },
            qty: { type: "number", description: "Quantity ordered/shipped." },
            uom: { type: "string", description: "Unit of measure, e.g. EA. Default EA if not shown." },
            unitPrice: { type: "number", description: "Price per unit." },
            total: { type: "number", description: "Extended line total (qty x unitPrice)." },
            taxable: { type: "boolean", description: "Whether the line is taxable. Default true." },
          },
          required: ["partNo", "description", "qty", "unitPrice", "total"],
        },
      },
      subtotal: { type: "number", description: "Sum of line items before tax." },
      taxAmount: { type: "number", description: "Total tax (HST/GST/PST). 0 if none." },
      taxLabel: { type: "string", description: "Tax label shown, e.g. HST. Empty string if none." },
      grandTotal: { type: "number", description: "Final total including tax." },
      isCreditCard: { type: "boolean", description: "True if paid by credit card — e.g. payment terms / method shows Visa, Mastercard, Amex, Debit, 'Credit Card', or a card number appears." },
      recipe: {
        type: "object",
        description:
          "A REUSABLE extraction recipe so future invoices from THIS SAME vendor can be parsed without calling you again. " +
          "Build it from this document's structure. Omit entirely only if the layout is too irregular to capture.",
        properties: {
          vendorKey: { type: "string", description: "Short normalized vendor id, lowercase, e.g. 'digikey' or 'gerrie'." },
          detect: { type: "string", description: "A short lowercase string that reliably appears in this vendor's documents, e.g. 'digi-key'." },
          lineRegex: { type: "string", description: "A JavaScript regular expression (NO slashes, NO flags) that matches ONE line-item row, using named capture groups (?<partNo>...), (?<description>...), (?<qty>...), (?<unitPrice>...), (?<total>...). qty/unitPrice/total must capture plain numbers (digits, optional decimal). Verify it matches the line-item rows in the text below." },
          flags: { type: "string", description: "Regex flags, usually 'i'." },
          dateRegex: { type: "string", description: "Regex capturing the document date in group 1. Optional." },
          invoiceRegex: { type: "string", description: "Regex capturing the invoice/order number in group 1. Optional." },
          poRegex: { type: "string", description: "Regex capturing the customer PO reference in group 1. Optional." },
          subtotalRegex: { type: "string", description: "Regex capturing the pre-tax subtotal amount in group 1. Optional." },
          taxRegex: { type: "string", description: "Regex capturing the tax amount in group 1. Optional." },
          totalRegex: { type: "string", description: "Regex capturing the grand total amount in group 1. Optional." },
          taxLabel: { type: "string", description: "Tax label, e.g. HST. Optional." },
        },
      },
    },
    required: ["vendor", "lines", "subtotal", "taxAmount", "grandTotal"],
  },
};

export const parseInvoiceAI = onCall(
  { cors: true, secrets: [ANTHROPIC_API_KEY], memory: "512MiB", timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

    const text = request.data?.text;
    if (!text || typeof text !== "string" || text.trim().length < 10) {
      throw new HttpsError("invalid-argument", "Missing document text.");
    }
    // Guard against runaway input — invoices are small; cap at ~40k chars.
    const clipped = text.slice(0, 40000);

    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY.value(),
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          tools: [INVOICE_TOOL],
          tool_choice: { type: "tool", name: "submit_invoice" },
          messages: [
            {
              role: "user",
              content:
                "Extract the line items and totals from this supplier invoice / packing slip. " +
                "Only include real product line items — skip shipping, freight, tariff, tax, and summary rows. " +
                "Use the document's own numbers; do not invent values.\n\n" +
                "ALSO build a reusable 'recipe' so future invoices from this same vendor can be parsed without you. " +
                "The recipe's lineRegex must be a JavaScript regular expression with named groups " +
                "(?<partNo>), (?<description>), (?<qty>), (?<unitPrice>), (?<total>) that matches the line-item rows " +
                "in the text below — mentally test it before returning. Include a 'detect' string that reliably appears " +
                "in this vendor's documents. If the layout is too irregular to capture reliably, omit the recipe.\n\n" +
                "DOCUMENT TEXT:\n" + clipped,
            },
          ],
        }),
      });
    } catch (e) {
      throw new HttpsError("unavailable", "Could not reach the AI service: " + (e?.message || e));
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new HttpsError("internal", json?.error?.message || `AI service error (${res.status}).`);
    }

    const toolUse = (json.content || []).find((c) => c.type === "tool_use");
    if (!toolUse?.input) throw new HttpsError("internal", "AI returned no structured data.");

    const out = toolUse.input;
    // Normalize: ensure arrays/numbers are well-formed before returning to the client.
    out.lines = Array.isArray(out.lines) ? out.lines : [];
    out.lines = out.lines.map((l) => ({
      partNo: String(l.partNo || ""),
      description: String(l.description || ""),
      qty: Number(l.qty) || 0,
      uom: String(l.uom || "EA"),
      unitPrice: Number(l.unitPrice) || 0,
      total: Number(l.total) || 0,
      taxable: l.taxable !== false,
    }));
    out.subtotal = Number(out.subtotal) || 0;
    out.taxAmount = Number(out.taxAmount) || 0;
    out.grandTotal = Number(out.grandTotal) || out.subtotal + out.taxAmount;
    out.vendor = String(out.vendor || "");
    out.invoiceNumber = String(out.invoiceNumber || "");
    out.poNumber = String(out.poNumber || "");
    out.date = String(out.date || "");
    out.taxLabel = String(out.taxLabel || "Tax");
    out.isCreditCard = out.isCreditCard === true;

    // Sanity-check the AI-generated recipe so we never store a broken one. The
    // lineRegex must compile AND contain the required named groups; otherwise drop it.
    if (out.recipe && typeof out.recipe === "object") {
      const r = out.recipe;
      let ok = false;
      try {
        if (r.lineRegex && typeof r.lineRegex === "string") {
          const re = new RegExp(r.lineRegex, typeof r.flags === "string" ? r.flags : "i");
          const src = re.source;
          ok = ["partNo", "qty", "unitPrice", "total"].every((g) => src.includes(`<${g}>`));
        }
      } catch { ok = false; }
      if (ok) {
        out.recipe = {
          vendorKey: String(r.vendorKey || out.vendor || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          detect: String(r.detect || "").toLowerCase(),
          lineRegex: String(r.lineRegex),
          flags: typeof r.flags === "string" ? r.flags : "i",
          dateRegex: r.dateRegex ? String(r.dateRegex) : "",
          invoiceRegex: r.invoiceRegex ? String(r.invoiceRegex) : "",
          poRegex: r.poRegex ? String(r.poRegex) : "",
          subtotalRegex: r.subtotalRegex ? String(r.subtotalRegex) : "",
          taxRegex: r.taxRegex ? String(r.taxRegex) : "",
          totalRegex: r.totalRegex ? String(r.totalRegex) : "",
          taxLabel: r.taxLabel ? String(r.taxLabel) : out.taxLabel,
        };
        if (!out.recipe.vendorKey || !out.recipe.detect) out.recipe = null;
      } else {
        out.recipe = null;
      }
    } else {
      out.recipe = null;
    }

    return out;
  }
);
