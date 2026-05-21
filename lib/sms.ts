const TEXTBELT_TEXT_URL = "https://textbelt.com/text";
const TEXTBELT_QUOTA_URL = "https://textbelt.com/quota";
const DEFAULT_QUOTA_ALERT_TO = "+14357737295";
const DEFAULT_QUOTA_ALERT_THRESHOLD = 100;
const DEFAULT_QUOTA_ALERT_INTERVAL = 10;

type TextbeltSendResponse = {
  success: boolean;
  error?: string;
  textId?: string;
  quotaRemaining?: number;
};

type TextbeltQuotaResponse = {
  success: boolean;
  quotaRemaining?: number;
  error?: string;
};

type DeliveryResult = {
  phone: string;
  success: boolean;
  error?: string;
  textId?: string;
  quotaRemaining?: number;
};

type QuotaAlertResult = {
  sent: boolean;
  reason?: string;
  quotaRemaining?: number;
  bucket?: number;
  message?: string;
  error?: string;
};

type SendSmsOptions = {
  skipQuotaAlert?: boolean;
};

const warnedQuotaBuckets = new Set<number>();

function getTextbeltApiKey(): string {
  const apiKey = process.env.TEXTBELT_API_KEY;
  if (!apiKey) {
    throw new Error("TEXTBELT_API_KEY env var is required");
  }

  return apiKey;
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function quotaAlertTo(): string {
  return process.env.TEXTBELT_QUOTA_ALERT_TO || DEFAULT_QUOTA_ALERT_TO;
}

function quotaAlertThreshold(): number {
  return numberEnv("TEXTBELT_QUOTA_ALERT_THRESHOLD", DEFAULT_QUOTA_ALERT_THRESHOLD);
}

function quotaAlertInterval(): number {
  return numberEnv("TEXTBELT_QUOTA_ALERT_INTERVAL", DEFAULT_QUOTA_ALERT_INTERVAL);
}

export function getQuotaAlertBucket(
  quotaRemaining: number,
  threshold = quotaAlertThreshold(),
  interval = quotaAlertInterval(),
): number | null {
  if (!Number.isFinite(quotaRemaining) || quotaRemaining >= threshold) {
    return null;
  }

  return Math.floor(quotaRemaining / interval);
}

export function getQuotaAlertMessage(quotaRemaining: number): string {
  return `Text message quota is low. You only have ${quotaRemaining} messages left.`;
}

export async function getTextbeltQuota(
  apiKey = getTextbeltApiKey(),
): Promise<TextbeltQuotaResponse> {
  const res = await fetch(`${TEXTBELT_QUOTA_URL}/${encodeURIComponent(apiKey)}`);
  if (!res.ok) {
    return { success: false, error: `HTTP ${res.status}` };
  }

  return (await res.json()) as TextbeltQuotaResponse;
}

async function sendSingleSms(
  phone: string,
  message: string,
  apiKey: string,
): Promise<DeliveryResult> {
  try {
    const res = await fetch(TEXTBELT_TEXT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, message, key: apiKey }),
    });

    if (!res.ok) {
      return { phone, success: false, error: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as TextbeltSendResponse;
    if (!data.success) {
      return {
        phone,
        success: false,
        error: data.error || "unknown",
        quotaRemaining: data.quotaRemaining,
      };
    }

    return {
      phone,
      success: true,
      textId: data.textId,
      quotaRemaining: data.quotaRemaining,
    };
  } catch (err) {
    return {
      phone,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function maybeSendQuotaAlert(apiKey: string): Promise<QuotaAlertResult> {
  const quota = await getTextbeltQuota(apiKey);
  if (!quota.success || typeof quota.quotaRemaining !== "number") {
    return {
      sent: false,
      reason: "quota_check_failed",
      error: quota.error || "unknown",
    };
  }

  const bucket = getQuotaAlertBucket(quota.quotaRemaining);
  if (bucket === null) {
    return {
      sent: false,
      reason: "quota_above_threshold",
      quotaRemaining: quota.quotaRemaining,
    };
  }

  if (warnedQuotaBuckets.has(bucket)) {
    return {
      sent: false,
      reason: "quota_bucket_already_alerted",
      quotaRemaining: quota.quotaRemaining,
      bucket,
    };
  }

  warnedQuotaBuckets.add(bucket);

  const message = getQuotaAlertMessage(quota.quotaRemaining);
  const result = await sendSingleSms(quotaAlertTo(), message, apiKey);
  if (!result.success) {
    warnedQuotaBuckets.delete(bucket);
    return {
      sent: false,
      reason: "quota_alert_send_failed",
      quotaRemaining: quota.quotaRemaining,
      bucket,
      message,
      error: result.error,
    };
  }

  console.warn(`[SMS Quota] Sent low quota alert: ${quota.quotaRemaining} messages left`);
  return {
    sent: true,
    quotaRemaining: quota.quotaRemaining,
    bucket,
    message,
  };
}

/**
 * Send an SMS via TextBelt to one or more recipients.
 */
export async function sendSms(
  to: string | string[],
  message: string,
  options: SendSmsOptions = {},
): Promise<{
  success: boolean;
  errors?: string[];
  deliveries?: DeliveryResult[];
  quotaRemaining?: number;
  quotaAlert?: QuotaAlertResult;
}> {
  const apiKey = getTextbeltApiKey();
  const recipients = Array.isArray(to) ? to : [to];

  if (process.env.NODE_ENV === "development") {
    console.log(`[DEV SMS] To: ${recipients.join(", ")}\n${message}`);
    return { success: true };
  }

  const errors: string[] = [];

  const deliveries = await Promise.all(
    recipients.map((phone) => sendSingleSms(phone, message, apiKey)),
  );

  for (const delivery of deliveries) {
    if (!delivery.success) {
      errors.push(`${delivery.phone}: ${delivery.error || "unknown"}`);
    }
  }

  if (errors.length === recipients.length) {
    throw new Error(`All SMS sends failed: ${errors.join("; ")}`);
  }

  if (errors.length > 0) {
    console.warn(`[SMS] Partial send failure: ${errors.join("; ")}`);
  }

  const quotaRemaining = deliveries.find(
    (delivery) => typeof delivery.quotaRemaining === "number",
  )?.quotaRemaining;

  let quotaAlert: QuotaAlertResult | undefined;
  if (!options.skipQuotaAlert) {
    quotaAlert = await maybeSendQuotaAlert(apiKey);
    if (quotaAlert.error) {
      console.warn(`[SMS Quota] ${quotaAlert.reason}: ${quotaAlert.error}`);
    }
  }

  return {
    success: true,
    errors: errors.length > 0 ? errors : undefined,
    deliveries,
    quotaRemaining,
    quotaAlert,
  };
}
