export function load({ locals }) {
  return {
    appSession: {
      principalId: locals.principalId ?? null,
      viewerProfile: locals.viewerProfile ?? null,
      resolvedCapabilities: Array.isArray(locals.resolvedCapabilities)
        ? locals.resolvedCapabilities
        : [],
    },
  };
}
