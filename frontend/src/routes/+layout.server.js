export function load({ locals }) {
  return {
    appSession: {
      principalUserId: locals.principalUserId ?? null,
      resolvedCapabilities: Array.isArray(locals.resolvedCapabilities)
        ? locals.resolvedCapabilities
        : [],
    },
  };
}
