import { error, fail, redirect } from "@sveltejs/kit";
import { serverApiBaseUrl } from "../../../lib/server/api-base.mjs";
import { accessTokenForRequest } from "../../../lib/server/session-capabilities.mjs";

export async function load({ cookies, fetch, locals, url }) {
  if (workosEnabled(process.env)) throw redirect(303, "/admin");
  if (typeof locals.principalUserId !== "string" || locals.principalUserId.trim() === "") {
    throw redirect(303, `/auth/login?returnTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  }
  const capabilities = capabilityKinds(locals.resolvedCapabilities);
  if (!capabilities.has("GlobalAdmin") && !capabilities.has("GlobalMod")) {
    throw error(403, "Auth delivery operations require GlobalAdmin or GlobalMod capability.");
  }
  const sessionToken = accessTokenForRequest({ locals, cookies });
  if (!sessionToken) throw redirect(303, "/auth/login?returnTo=%2Fadmin%2Fdeliveries");
  const response = await fetch(`${serverApiBaseUrl()}/admin/auth-deliveries?limit=200`, {
    headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
  });
  const body = await response.json();
  if (!response.ok) throw error(response.status, body?.message ?? "Delivery queue unavailable");
  return {
    deliveries: Array.isArray(body?.deliveries) ? body.deliveries : [],
    canRetry: capabilities.has("GlobalAdmin"),
  };
}

export const actions = {
  retry: async ({ cookies, fetch, locals, request }) => {
    if (workosEnabled(process.env)) {
      return fail(404, { state: "reject", message: "WorkOS owns production identity delivery" });
    }
    const capabilities = capabilityKinds(locals.resolvedCapabilities);
    if (!capabilities.has("GlobalAdmin")) {
      return fail(403, { state: "reject", message: "Delivery retries require GlobalAdmin" });
    }
    const formData = await request.formData();
    const deliveryId = formData.get("deliveryId");
    if (typeof deliveryId !== "string" || !UUID_PATTERN.test(deliveryId)) {
      return fail(400, { state: "reject", message: "A valid delivery id is required" });
    }
    const sessionToken = accessTokenForRequest({ locals, cookies });
    if (!sessionToken) {
      return fail(401, { state: "reject", message: "Missing authenticated admin session" });
    }
    const response = await fetch(
      `${serverApiBaseUrl()}/auth/delivery-intents/${encodeURIComponent(deliveryId)}/retry`,
      {
        method: "POST",
        headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
      },
    );
    const body = await response.json();
    if (!response.ok) {
      return fail(response.status, {
        state: "reject",
        deliveryId,
        message: body?.message ?? "Delivery retry rejected",
      });
    }
    return {
      state: body.status === "delivered" ? "ack" : "pending",
      deliveryId,
      message: `Delivery ${body.status.replaceAll("_", " ")} after attempt ${body.attempt_count}`,
    };
  },
};

function workosEnabled(env) {
  return typeof env?.WORKOS_CLIENT_ID === "string" && env.WORKOS_CLIENT_ID.trim() !== "";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function capabilityKinds(capabilities) {
  return new Set(
    (Array.isArray(capabilities) ? capabilities : [])
      .map((capability) => capability?.kind)
      .filter((kind) => typeof kind === "string"),
  );
}
