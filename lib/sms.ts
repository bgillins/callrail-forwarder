/**
 * Send an SMS via TextBelt to one or more recipients.
 */
export async function sendSms(
  to: string | string[],
  message: string,
): Promise<{ success: boolean; errors?: string[] }> {
  const apiKey = process.env.TEXTBELT_API_KEY;
  if (!apiKey) {
    throw new Error("TEXTBELT_API_KEY env var is required");
  }

  const recipients = Array.isArray(to) ? to : [to];

  if (process.env.NODE_ENV === "development") {
    console.log(`[DEV SMS] To: ${recipients.join(", ")}\n${message}`);
    return { success: true };
  }

  const errors: string[] = [];

  await Promise.all(
    recipients.map(async (phone) => {
      try {
        const res = await fetch("https://textbelt.com/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, message, key: apiKey }),
        });

        if (!res.ok) {
          errors.push(`${phone}: HTTP ${res.status}`);
          return;
        }

        const data = (await res.json()) as { success: boolean; error?: string };
        if (!data.success) {
          errors.push(`${phone}: ${data.error || "unknown"}`);
        }
      } catch (err) {
        errors.push(`${phone}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );

  if (errors.length === recipients.length) {
    throw new Error(`All SMS sends failed: ${errors.join("; ")}`);
  }

  return { success: true, errors: errors.length > 0 ? errors : undefined };
}
