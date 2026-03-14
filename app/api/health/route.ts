import { NextResponse } from "next/server";
import { getCompanyConfigs } from "@/lib/config";

export async function GET() {
  try {
    const configs = getCompanyConfigs();

    return NextResponse.json({
      status: "ok",
      companies: configs.map((c) => ({
        label: c.label,
        companyId: c.companyId,
        forwardTo: c.forwardTo,
        hasApiKey: !!c.apiKey,
        hasSigningKey: !!c.signingKey,
      })),
      env: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "MISSING",
        TEXTBELT_API_KEY: process.env.TEXTBELT_API_KEY ? "set" : "MISSING",
        COMPANY_CONFIG: process.env.COMPANY_CONFIG ? "set" : "MISSING",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
