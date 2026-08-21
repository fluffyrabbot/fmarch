export function load({ locals }) {
  return {
    appSession: {
      principalUserId: locals.principalUserId ?? null,
      viewerProfile: locals.viewerProfile ?? null,
      resolvedCapabilities: Array.isArray(locals.resolvedCapabilities)
        ? locals.resolvedCapabilities
        : [],
    },
  };
}
