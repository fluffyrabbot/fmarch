import { error, fail, redirect } from "@sveltejs/kit";
import { serverApiBaseUrl } from "../../../lib/server/api-base.mjs";
import { accessTokenForRequest } from "../../../lib/server/session-capabilities.mjs";

export async function load({ cookies, fetch, locals, url }) {
  if (typeof locals.principalId !== "string" || locals.principalId.trim() === "") {
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
    deliveryConfigured: body?.delivery_configured === true,
    deliveryBound: body?.delivery_bound === true,
    deliveryOperable: body?.delivery_operable === true,
    configuredGeneration:
      typeof body?.configured_generation === "string" ? body.configured_generation : null,
    activeGeneration: typeof body?.active_generation === "string" ? body.active_generation : null,
    suspensionCode: typeof body?.suspension_code === "string" ? body.suspension_code : null,
    probeInFlight: body?.probe_in_flight === true,
    circuitVersion:
      Number.isSafeInteger(body?.circuit_version) && body.circuit_version >= 0
        ? body.circuit_version
        : null,
    canRetry: capabilities.has("GlobalAdmin"),
    canProbe: capabilities.has("GlobalAdmin"),
  };
}

export const actions = {
  retry: async ({ cookies, fetch, locals, request }) => {
    const capabilities = capabilityKinds(locals.resolvedCapabilities);
    if (!capabilities.has("GlobalAdmin")) {
      return fail(403, { state: "reject", message: "Delivery retries require GlobalAdmin" });
    }
    const formData = await request.formData();
    const deliveryId = formData.get("deliveryId");
    if (typeof deliveryId !== "string" || !UUID_PATTERN.test(deliveryId)) {
      return fail(400, { state: "reject", message: "A valid delivery id is required" });
    }
    const expectedAttemptCount = parseExpectedAttemptCount(formData.get("expectedAttemptCount"));
    if (expectedAttemptCount === null) {
      return fail(400, {
        state: "reject",
        deliveryId,
        message: "A valid expected attempt count is required",
      });
    }
    const sessionToken = accessTokenForRequest({ locals, cookies });
    if (!sessionToken) {
      return fail(401, { state: "reject", message: "Missing authenticated admin session" });
    }
    const response = await fetch(
      `${serverApiBaseUrl()}/auth/delivery-intents/${encodeURIComponent(deliveryId)}/retry`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ expected_attempt_count: expectedAttemptCount }),
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
  probe: async ({ cookies, fetch, locals }) => {
    const capabilities = capabilityKinds(locals.resolvedCapabilities);
    if (!capabilities.has("GlobalAdmin")) {
      return fail(403, { state: "reject", message: "Provider probes require GlobalAdmin" });
    }
    const sessionToken = accessTokenForRequest({ locals, cookies });
    if (!sessionToken) {
      return fail(401, { state: "reject", message: "Missing authenticated admin session" });
    }
    const response = await fetch(`${serverApiBaseUrl()}/admin/auth-delivery-provider/probe`, {
      method: "POST",
      headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
    });
    const body = await response.json();
    if (!response.ok) {
      return fail(response.status, {
        state: "reject",
        message: body?.message ?? "Provider probe rejected",
      });
    }
    return {
      state: body.provider_operable === true ? "ack" : "reject",
      message:
        body.provider_operable === true
          ? `Provider generation ${body.provider_generation} is operable at circuit version ${body.circuit_version}`
          : `Provider generation ${body.provider_generation} remains unavailable`,
    };
  },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_ATTEMPT_COUNT = 2_147_483_647;

function parseExpectedAttemptCount(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
  const attemptCount = Number(value);
  return Number.isSafeInteger(attemptCount) && attemptCount <= MAX_ATTEMPT_COUNT
    ? attemptCount
    : null;
}

function capabilityKinds(capabilities) {
  return new Set(
    (Array.isArray(capabilities) ? capabilities : [])
      .map((capability) => capability?.kind)
      .filter((kind) => typeof kind === "string"),
  );
}
