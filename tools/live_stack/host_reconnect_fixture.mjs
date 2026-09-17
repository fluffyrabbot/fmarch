export function explicitHostReconnectFixture({ attempt = 0 } = {}) {
  const game = "host-reconnect-game";
  const endpoint = `/live/tickets?game=${game}`;
  const historical = { kind: "reconnect", state: "recovered", attempt: 1 };
  const projection = [{ target: "slot_1", count: 1 }];
  const before = { endpoint, events: [historical], eventCount: 1, projection };
  const after = { endpoint, events: [historical,
    { kind: "reconnecting", reason: "browser_proof", attempt: 1 },
    { kind: "reconnect", state: "recovered", attempt },
  ], eventCount: 3, projection, health: { state: "recovered" } };
  const requests = [
    { id: 0, kind: "ticket", pathname: "/live/tickets", method: "POST" },
    { id: 1, kind: "projection", pathname: `/api/gameplay/games/${game}/host-console-state`, method: "GET" },
    { id: 2, kind: "projection", pathname: `/api/gameplay/games/${game}/votecount`, method: "GET" },
  ];
  return structuredClone({ game, expectedCount: 1, eventStart: 1, before, after,
    triggerSnapshot: { votecount: projection }, requests,
    responses: requests.map((request) => ({ ...request, status: 200 })),
    sockets: [{ pathname: "/ws", closed: false, errors: [] }],
  });
}
