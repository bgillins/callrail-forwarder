/**
 * Send an SMS via TextBelt.
 */
export async function sendSms(
  to: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.TEXTBELT_API_KEY;
  if (!apiKey) {
    throw new Error("TEXTBELT_API_KEY env var is required");
  }

  if (process.env.NODE_ENV === "development") {
    console.log(`[DEV SMS] To: ${to}\n${message}`);
    return { success: true };
  }

  const res = await fetch("https://textbelt.com/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: to,
      message,
      key: apiKey,
    }),
  });

  if (!res.ok) {
    throw new Error(`TextBelt API error: ${res.status}`);
  }

  const data = (await res.json()) as { success: boolean; error?: string };
  if (!data.success) {
    throw new Error(`TextBelt send failed: ${data.error || "unknown"}`);
  }

  return data;
}
