import type { CompanyConfig } from "./types";

/**
 * Load company configs from COMPANY_CONFIG env var.
 *
 * Format: JSON array of CompanyConfig objects.
 * Example:
 * [
 *   {
 *     "companyId": "COM...",
 *     "label": "Acme Dental",
 *     "forwardTo": "+17025551234",
 *     "signingKey": "abc123...",
 *     "apiKey": "your-callrail-api-key",
 *     "accountId": "227799611"
 *   }
 * ]
 */
let _cache: CompanyConfig[] | null = null;

export function getCompanyConfigs(): CompanyConfig[] {
  if (_cache) return _cache;

  const raw = process.env.COMPANY_CONFIG;
  if (!raw) {
    throw new Error("COMPANY_CONFIG env var is required");
  }

  const parsed = JSON.parse(raw) as CompanyConfig[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("COMPANY_CONFIG must be a non-empty JSON array");
  }

  for (const c of parsed) {
    if (!c.companyId || !c.forwardTo || !c.signingKey || !c.apiKey || !c.accountId) {
      throw new Error(
        `Invalid config for company "${c.label || c.companyId}": ` +
          "companyId, forwardTo, signingKey, apiKey, and accountId are required",
      );
    }
  }

  _cache = parsed;
  return parsed;
}

export function findCompanyByCallRailId(
  companyId: string,
): CompanyConfig | undefined {
  return getCompanyConfigs().find((c) => c.companyId === companyId);
}

/**
 * Find company config by matching the signing key against the webhook signature.
 * Used when the webhook payload doesn't contain company_id directly.
 */
export function findCompanyBySigningKey(
  body: string,
  signature: string,
): CompanyConfig | undefined {
  // Import here to avoid circular deps — crypto is Node built-in
  const { createHmac } = require("crypto") as typeof import("crypto");

  return getCompanyConfigs().find((c) => {
    const expected = createHmac("sha1", c.signingKey)
      .update(body)
      .digest("base64");
    return expected === signature;
  });
}
