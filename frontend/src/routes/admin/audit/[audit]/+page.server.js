import { error } from "@sveltejs/kit";
import {
  adminForbiddenMessage,
  buildAdminAuditDetailData,
} from "../../admin-route-model.mjs";

export async function load({ locals, fetch, params, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const fixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
  const data = await buildAdminAuditDetailData({
    audit: params.audit,
    principalUserId: locals.principalUserId,
    capabilities: locals.resolvedCapabilities,
    game: url.searchParams.get("game") ?? "midsummer",
    fetchImpl: fixtureMode && apiBaseUrl === "" ? null : fetch,
    apiBaseUrl,
  });

  if (!data.access.allowed) {
    throw error(403, adminForbiddenMessage());
  }
  if (data.audit === null) {
    throw error(404, `Admin audit item ${data.auditId} is not available.`);
  }

  return {
    ...data,
    shellOwner: "layout",
  };
}
