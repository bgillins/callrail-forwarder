import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getCompanyConfigs } from "@/lib/config";
import { handleCall, handleTextMessage } from "@/lib/webhook-handler";
import type {
  CallRailCallEvent,
  CallRailTextEvent,
  CallRailWebhookFormFields,
  CompanyConfig,
} from "@/lib/types";
import { normalizeCallWebhook, normalizeTextWebhook } from "@/lib/types";

// Vercel paid plan — allow up to 300s for transcription pipeline
export const maxDuration = 300;

/**
 * CallRail webhook receiver.
 *
 * CallRail sends webhooks as application/x-www-form-urlencoded (not JSON).
 * We parse the form body, normalize field names to our internal types,
 * then route by event type.
 *
 * Signature verification uses HMAC-SHA1 with per-company signing keys.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("Signature");
  const bodyText = await request.text();

  if (!bodyText) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  // Parse body — try form-encoded first, fall back to JSON
  let fields: CallRailWebhookFormFields;
  const contentType = request.headers.get("content-type") || "";

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    (!contentType.includes("application/json") && bodyText.includes("=") && !bodyText.startsWith("{"))
  ) {
    // Form-encoded body
    const params = new URLSearchParams(bodyText);
    fields = Object.fromEntries(params.entries()) as unknown as CallRailWebhookFormFields;
  } else {
    // JSON body (legacy / testing)
    try {
      const json = JSON.parse(bodyText) as Record<string, unknown>;
      fields = json as unknown as CallRailWebhookFormFields;
      // If JSON uses `id` instead of `resource_id`, map it
      if (!fields.resource_id && json.id) {
        fields.resource_id = String(json.id);
      }
      // Map JSON boolean fields to strings for normalizer
      if (typeof json.voicemail === "boolean") {
        fields.voicemail = String(json.voicemail);
      }
      if (typeof json.answered === "boolean") {
        fields.answered = String(json.answered);
      }
      if (typeof json.duration === "number") {
        fields.duration = String(json.duration);
      }
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
  }

  // Find the matching company config by verifying signature against all signing keys
  const config = findMatchingCompany(bodyText, signature, fields);
  if (!config) {
    console.warn("[Webhook] No matching company config for incoming webhook");
    return NextResponse.json(
      { error: "Unknown company or invalid signature" },
      { status: 401 },
    );
  }

  console.log(`[Webhook] Received event for ${config.label}`, JSON.stringify({
    resource_id: fields.resource_id,
    voicemail: fields.voicemail,
    answered: fields.answered,
    recording: fields.recording ? "[present]" : "[absent]",
    callernum: fields.callernum,
    customer_phone_number: fields.customer_phone_number,
    callername: fields.callername,
    content: fields.content,
    source_number: fields.source_number,
  }));

  // Route by event type
  try {
    if (isCallEvent(fields)) {
      const callEvent = normalizeCallWebhook(fields);
      const result = await handleCall(callEvent, config);
      return NextResponse.json({ received: true, ...result });
    }

    if (isTextEvent(fields)) {
      const textEvent = normalizeTextWebhook(fields);
      const result = await handleTextMessage(textEvent, config);
      return NextResponse.json({ received: true, ...result });
    }

    // Unknown event type — acknowledge
    return NextResponse.json({ received: true, forwarded: false, reason: "unknown_event_type" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Webhook] Processing error for ${config.label}:`, message);
    return NextResponse.json(
      { error: "Processing failed", detail: message },
      { status: 500 },
    );
  }
}

function isCallEvent(fields: CallRailWebhookFormFields): boolean {
  return (
    fields.voicemail !== undefined ||
    fields.answered !== undefined ||
    fields.duration !== undefined
  );
}

function isTextEvent(fields: CallRailWebhookFormFields): boolean {
  return (
    !!fields.content &&
    !!fields.source_number &&
    fields.voicemail === undefined
  );
}

function findMatchingCompany(
  body: string,
  signature: string | null,
  fields: CallRailWebhookFormFields,
): CompanyConfig | undefined {
  const configs = getCompanyConfigs();

  // If no signature header, try matching by company_id in payload
  if (!signature) {
    const companyId = fields.company_id || fields.company_resource_id;
    if (companyId) {
      return configs.find((c) => c.companyId === companyId);
    }
    return undefined;
  }

  // Verify HMAC-SHA1 signature against each company's signing key
  return configs.find((c) => {
    const expected = createHmac("sha1", c.signingKey)
      .update(body)
      .digest("base64");
    return expected === signature;
  });
}
