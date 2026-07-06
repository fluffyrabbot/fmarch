export function normalizedEvidenceObjectRowIds({ parentId, objects }) {
  return Object.freeze(
    (Array.isArray(objects) ? objects : [])
      .map((object) => String(object?.name ?? ""))
      .filter((name) => name !== "")
      .map((name) => normalizedEvidenceObjectRowId({ parentId, name })),
  );
}

export function normalizedEvidenceObjectRowIdsForProofGraph(proofGraph) {
  return normalizedEvidenceObjectRowIdsFromNodes(proofGraph?.nodes);
}

export function normalizedEvidenceObjectRowIdsFromNodes(nodes) {
  return Object.freeze(
    (Array.isArray(nodes) ? nodes : []).flatMap((node) =>
      normalizedEvidenceObjectRowIds({
        parentId: node?.id,
        objects: node?.normalizedEvidenceObjects,
      }),
    ),
  );
}

export function normalizedEvidenceObjectRowId({ parentId, name }) {
  return `evidence-object:${String(parentId ?? "")}:${String(name ?? "")}`;
}
