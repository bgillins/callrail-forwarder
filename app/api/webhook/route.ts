import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getCompanyConfigs } from "@/lib/config";
import { handleVoicemail, handleTextMessage } from "@/lib/webhook-handler";
import type { CallRailCallEvent, CallRailTextEvent, CompanyConfig } from "@/lib/types";

// Vercel paid plan — allow up to 300s for transcription pipeline
export const maxDuration = 300;

/**
 * CallRail webhook receiver.
 *
 * CallRail sends the same call/text object shape for all event types.
 * We detect the event type by inspecting the payload fields:
 * - Has "voicemail" field → call event (post_call / call_modified)
 * - Has "content" + "source_number" → text message event
 *
 * Signature verification uses HMAC-SHA1 with per-company signing keys.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("Signature");
  const bodyText = await request.text();

  if (!bodyText) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  // Parse body
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Find the matching company config by verifying signature against all signing keys
  const config = findMatchingCompany(bodyText, signature);
  if (!config) {
    console.warn("[Webhook] No matching company config for incoming webhook");
    return NextResponse.json(
      { error: "Unknown company or invalid signature" },
      { status: 401 },
    );
  }

  console.log(`[Webhook] Received event for ${config.label}`);

  // Route by event type
  try {
    if (isCallEvent(payload)) {
      const callEvent = payload as unknown as CallRailCallEvent;

      // Only process voicemails and missed calls
      if (callEvent.voicemail || !callEvent.answered) {
        const result = await handleVoicemail(callEvent, config);
        return NextResponse.json({ received: true, ...result });
      }

      // Answered call — acknowledge but don't forward
      return NextResponse.json({ received: true, forwarded: false, reason: "answered_call" });
    }

    if (isTextEvent(payload)) {
      const textEvent = payload as unknown as CallRailTextEvent;
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

function isCallEvent(payload: Record<string, unknown>): boolean {
  return "voicemail" in payload && "customer_phone_number" in payload;
}

function isTextEvent(payload: Record<string, unknown>): boolean {
  return "content" in payload && "source_number" in payload && !("voicemail" in payload);
}

function findMatchingCompany(
  body: string,
  signature: string | null,
): CompanyConfig | undefined {
  const configs = getCompanyConfigs();

  // If no signature header, try matching by company_id in payload
  if (!signature) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const companyId =
        (parsed.company_id as string) || (parsed.company_resource_id as string);
      if (companyId) {
        return configs.find((c) => c.companyId === companyId);
      }
    } catch {
      // ignore
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
