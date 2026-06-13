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

    return out;
  }
);
