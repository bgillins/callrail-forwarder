import { NextRequest, NextResponse } from "next/server";
import {
  getQuotaAlertBucket,
  getQuotaAlertMessage,
  getTextbeltQuota,
} from "@/lib/sms";

export async function GET(request: NextRequest) {
  const simulate = request.nextUrl.searchParams.get("simulate");
  const simulatedQuotaRemaining = simulate === null ? null : Number(simulate);
  const hasSimulation =
    simulatedQuotaRemaining !== null && Number.isFinite(simulatedQuotaRemaining);

  const quota = hasSimulation
    ? null
    : await getTextbeltQuota();

  const quotaRemaining =
    hasSimulation
      ? simulatedQuotaRemaining
      : quota?.quotaRemaining;

  const alertBucket =
    typeof quotaRemaining === "number"
      ? getQuotaAlertBucket(quotaRemaining)
      : null;

  return NextResponse.json({
    success: quota?.success ?? true,
    quotaRemaining: quota?.quotaRemaining,
    simulatedQuotaRemaining: hasSimulation ? simulatedQuotaRemaining : undefined,
    lowQuotaAlert: {
      wouldSend: alertBucket !== null,
      bucket: alertBucket,
      message:
        typeof quotaRemaining === "number" && alertBucket !== null
          ? getQuotaAlertMessage(quotaRemaining)
          : undefined,
    },
    error: quota?.error,
  });
}
