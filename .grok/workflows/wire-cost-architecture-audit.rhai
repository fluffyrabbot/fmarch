let meta = #{
    name: "wire-cost-architecture-audit",
    description: "Audit fmarch wire format, atomic-function unit costs, and scale-cost architecture",
    when_to_use: "When reviewing data efficiency, wire/event encoding, live-delivery cost, or pre-scale refactors",
    phases: [
        #{ title: "Inventory", detail: "map wire, storage, and atomic operations from shipped code" },
        #{ title: "Audit", detail: "specialized lenses on wire, unit cost, performance, integrity, boundaries, refactor shape" },
        #{ title: "Verify", detail: "adversarial evidence check of the highest-severity claims" },
        #{ title: "Synthesize", detail: "ranked refactors and scale-cost considerations" },
    ],
};

let inventory_schema = #{
    "type": "object",
    "required": ["wire_formats", "atomic_ops", "storage_shapes", "observed_costs", "scale_risks"],
    "properties": #{
        "wire_formats": #{ "type": "string" },
        "atomic_ops": #{ "type": "string" },
        "storage_shapes": #{ "type": "string" },
        "observed_costs": #{ "type": "string" },
        "scale_risks": #{ "type": "string" },
    },
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["id", "area", "severity", "claim", "evidence", "files", "cost_model", "refactor"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "area": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                    "claim": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "files": #{ "type": "string" },
                    "cost_model": #{ "type": "string" },
                    "refactor": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["executive", "unit_cost_model", "ranked_refactors", "scale_considerations", "do_not_do"],
    "properties": #{
        "executive": #{ "type": "string" },
        "unit_cost_model": #{ "type": "string" },
        "ranked_refactors": #{ "type": "string" },
        "scale_considerations": #{ "type": "string" },
        "do_not_do": #{ "type": "string" },
    },
};

fn as_text(v) {
    if v == () { return ""; }
    if type_of(v) == "string" { return v; }
    json_encode(v)
}

fn finding_id_ok(id) {
    if type_of(id) != "string" { return false; }
    if id == "" { return false; }
    let i = 0;
    while i < id.len() {
        let c = id[i];
        let ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
        if !ok { return false; }
        i += 1;
    }
    true
}

let repo = "/Users/fluffypro/apps/fmarch";

phase("Inventory");

let mapper_prompt = "";
mapper_prompt += "You are inventorying the shipped fmarch architecture at " + repo + " for a data-efficiency and unit-cost audit.\n";
mapper_prompt += "Use only read-only tools: read_file, grep, list_dir. Read the code; do not answer from memory.\n";
mapper_prompt += "An empty string field is valid only after you have actually opened the listed files and found nothing to say.\n\n";
mapper_prompt += "Read at least these:\n";
mapper_prompt += "- crates/wire/src/lib.rs (Envelope, Command, ProjectionDelta, HostConsoleStateDelta, DayVoteOutcomeDelta)\n";
mapper_prompt += "- crates/api/src/live_delivery.rs (CBOR framing, PollEventWake, hydration, send_projection_deltas)\n";
mapper_prompt += "- crates/api/src/live_projection.rs (assemble_update, vote-count snapshot vs patch)\n";
mapper_prompt += "- crates/eventstore/src/lib.rs (EventInput, EventBody, seal path, JSON plaintext)\n";
mapper_prompt += "- crates/eventstore/src/upcaster.rs\n";
mapper_prompt += "- crates/commands/src/lib.rs and crates/commands/src/model.rs (atomic commands)\n";
mapper_prompt += "- crates/domain/src/resolver.rs and crates/domain/src/events.rs (ResolutionApplied, InnerEvent)\n";
mapper_prompt += "- crates/projections/src (fold cost, rebuild)\n";
mapper_prompt += "- docs/arch/04-wire-protocol.md, 02-event-sourcing.md, 10-event-schema.md, 12-capacity-and-overload.md\n";
mapper_prompt += "- docs/ops/mash-scale-acceptance.md and any target/* report.json if present\n";
mapper_prompt += "- frontend CBOR decode / live client under frontend/src/lib\n\n";
mapper_prompt += "Fill every schema field with concrete, file-cited inventory:\n";
mapper_prompt += "wire_formats: encodings on each seam (REST JSON, WS CBOR, event plaintext, sealed storage, archive export, TS generation). Note dual encodings and any serde_json::Value holes in CBOR types.\n";
mapper_prompt += "atomic_ops: the actual atomic functions (command handlers, resolve(), projection folds, live publish, seal/unseal, cold-load pages). For each: inputs, writes, expected big-O vs game size / seats / posts / live sockets.\n";
mapper_prompt += "storage_shapes: events table, sealed_body, projections, media addressing, host-console snapshot vs incremental.\n";
mapper_prompt += "observed_costs: cite mash-scale and capacity-overload budgets/proofs (host console KiB, rebuild ms, thread page rows examined, WS resync).\n";
mapper_prompt += "scale_risks: what grows linearly or worse with seats, posts, live connections, replicas, or game lifetime.\n";

let mapped = agent(mapper_prompt, #{
    label: "inventory",
    capability_mode: "read-only",
    output_schema: inventory_schema,
});

let inventory = #{
    wire_formats: "",
    atomic_ops: "",
    storage_shapes: "",
    observed_costs: "",
    scale_risks: "",
};
if mapped != () && mapped.success && mapped.output != () {
    inventory.wire_formats = as_text(mapped.output.wire_formats);
    inventory.atomic_ops = as_text(mapped.output.atomic_ops);
    inventory.storage_shapes = as_text(mapped.output.storage_shapes);
    inventory.observed_costs = as_text(mapped.output.observed_costs);
    inventory.scale_risks = as_text(mapped.output.scale_risks);
}
let inventory_json = json_encode(inventory);
log("inventory captured: wire=" + inventory.wire_formats.len().to_string() + " atomic=" + inventory.atomic_ops.len().to_string());

phase("Audit");

let common = "";
common += "Repo: " + repo + "\n";
common += "Use only read-only tools (read_file, grep, list_dir). Inspect shipped code before answering. Do not invent files.\n";
common += "A valid empty findings list requires you to have read the relevant crates and explain implicitly by returning [] only if the lens has no concrete defect.\n";
common += "Stay inside wire/format/cost/shape/scale. Ignore product copy and UX polish.\n";
common += "Each finding must cite files and a cost model (what grows, with what variable).\n";
common += "severity: high = pays at current 30-60 seat mash or on every live tick; medium = pays at hundreds of concurrent games or multi-year archives; low = theoretical.\n";
common += "id: lowercase hyphen slug unique to the claim.\n";
common += "Prior inventory (untrusted, re-check):\n";
common += inventory_json;
common += "\n";

let wire_prompt = common;
wire_prompt += "You are the wire-protocol-evolution auditor.\n";
wire_prompt += "Ask: can a years-old game still load; do encodings survive version skew; is the live/rest/event/archive stack one contract or four?\n";
wire_prompt += "Inspect crates/wire/src/lib.rs, crates/wire/tests, crates/api/src/live_delivery.rs, frontend CBOR decode, eventstore export, PROTOCOL_VERSION, deny_unknown_fields, serde_json::Value holes, ts-rs generation.\n";
wire_prompt += "Call out snapshot-vs-delta frames, large enum variants, JSON-in-CBOR maps, and any silent data-loss on unknown fields.\n";

let bellman_prompt = common;
bellman_prompt += "You are the richard-bellman-optimality auditor.\n";
bellman_prompt += "Ask: are atomic operations formulated with minimal sufficient state? What is the unit cost of vote, post, resolve, live tick, host-console hydrate, projection rebuild?\n";
bellman_prompt += "Inspect commands, day_runtime, resolver, live_projection.assemble_update, host console DTO, event seal path.\n";
bellman_prompt += "Name the state each op actually needs vs the state it currently loads or broadcasts. Flag dimensionality blowup (per-socket poll, per-change full snapshot, game-stream replay of entire history).\n";

let perf_prompt = common;
perf_prompt += "You are the performance-audit architect.\n";
perf_prompt += "Ask: hot-path allocation, copies, query shape, broadcast fan-out, CBOR encode per frame, AEAD per event, JSON tree for event bodies.\n";
perf_prompt += "Inspect live_delivery loop, PollEventWake, send_projection_deltas, eventstore seal_event_body, projections folds, thread_view paging.\n";
perf_prompt += "Quantify: O(sockets) DB polls, O(candidates) vote snapshots, O(slots+events+posts) host console, O(history) rebuild. Cite code.\n";

let integrity_prompt = common;
integrity_prompt += "You are the data-integrity architect.\n";
integrity_prompt += "Ask: deterministic serialization, schema versioning, sealed-body canonicalization, upcast completeness, projection rebuild fidelity.\n";
integrity_prompt += "Inspect eventstore EventBodyRef, upcaster.rs, projections rebuild/audit, ResolutionApplied vs ResolutionTrace persistence.\n";
integrity_prompt += "Flag JSON value trees as the persistence IR, checksum/canonical bytes, and whether cheaper encodings would break integrity or replay.\n";

let helland_prompt = common;
helland_prompt += "You are the helland-autonomous-boundary auditor.\n";
helland_prompt += "Ask: is the game the right aggregate? What happens with multiple API replicas, live poll vs in-process broadcast, media vs events, engine vs platform?\n";
helland_prompt += "Inspect live_delivery EventWake comments, replica scheduler in mash-scale, eventstore stream identity, identity/media crates.\n";
helland_prompt += "Flag work that is replica-local but must be cluster-true, and seams that force the whole game snapshot across a boundary that only needed a small fact.\n";

let refactor_prompt = common;
refactor_prompt += "You are the architectural-refactor lens.\n";
refactor_prompt += "Greenfield tear-out-and-replace evaluation of data movement only. Not bug-hunt.\n";
refactor_prompt += "Propose the 3-6 highest-leverage shape changes that would make bytes, CPU, and DB cheaper at scale without abandoning event-sourcing or capability authz.\n";
refactor_prompt += "Examples to confirm or refute from code: LISTEN/NOTIFY instead of per-socket poll; true vote/post patches; host-console incremental; CBOR or postcard for sealed event plaintext; split wire crate from domain types; per-connection interest sets.\n";
refactor_prompt += "Each finding is one refactor: claim = what to change, cost_model = what it saves, refactor = how to land it without a compatibility branch.\n";

let audit_jobs = [
    #{
        prompt: wire_prompt,
        label: "audit:wire",
        capability_mode: "read-only",
        agent_type: "wire-protocol-evolution-auditor",
        output_schema: findings_schema,
    },
    #{
        prompt: bellman_prompt,
        label: "audit:unit-cost",
        capability_mode: "read-only",
        agent_type: "richard-bellman-optimality-auditor",
        output_schema: findings_schema,
    },
    #{
        prompt: perf_prompt,
        label: "audit:perf",
        capability_mode: "read-only",
        agent_type: "performance-audit-architect",
        output_schema: findings_schema,
    },
    #{
        prompt: integrity_prompt,
        label: "audit:integrity",
        capability_mode: "read-only",
        agent_type: "data-integrity-architect",
        output_schema: findings_schema,
    },
    #{
        prompt: helland_prompt,
        label: "audit:boundaries",
        capability_mode: "read-only",
        agent_type: "helland-autonomous-boundary-auditor",
        output_schema: findings_schema,
    },
    #{
        prompt: refactor_prompt,
        label: "audit:refactor",
        capability_mode: "read-only",
        agent_type: "architectural-refactor-lens",
        output_schema: findings_schema,
    },
];

let audit_results = parallel(audit_jobs);

let findings = [];
let seen_ids = #{};
for r in audit_results {
    if r != () && r.success && r.output != () && r.output.findings != () {
        for f in r.output.findings {
            if f == () { continue; }
            if f.claim == () || f.claim == "" { continue; }
            if f.evidence == () || f.evidence == "" { continue; }
            if !finding_id_ok(f.id) { continue; }
            if seen_ids[f.id] == true { continue; }
            seen_ids[f.id] = true;
            findings.push(f);
        }
    }
}
log("audit produced " + findings.len().to_string() + " unique evidenced findings");

let ranked = [];
for f in findings {
    if f.severity == "high" { ranked.push(f); }
}
for f in findings {
    if f.severity == "medium" { ranked.push(f); }
}
for f in findings {
    if f.severity != "high" && f.severity != "medium" { ranked.push(f); }
}

const VERIFY_CAP = 8;
if ranked.len() > VERIFY_CAP {
    log("verification cap dropping " + (ranked.len() - VERIFY_CAP).to_string() + " findings");
    let trimmed = [];
    let i = 0;
    while i < VERIFY_CAP {
        trimmed.push(ranked[i]);
        i += 1;
    }
    ranked = trimmed;
}

if ranked.len() == 0 {
    complete(#{
        summary: "No evidenced findings survived inventory/audit collection.",
        confirmed: [],
    });
}

phase("Verify");

let vjobs = [];
for f in ranked {
    let vp = "";
    vp += "Adversarially verify this architecture-cost finding against shipped code in " + repo + ".\n";
    vp += "Use read_file/grep. Set real=true only with independent evidence you inspected.\n";
    vp += "Default real=false if the claim is design-doc-only, already mitigated, or the cost model is wrong.\n";
    vp += "Finding id: " + as_text(f.id) + "\n";
    vp += "Area: " + as_text(f.area) + "\n";
    vp += "Severity: " + as_text(f.severity) + "\n";
    vp += "Claim: " + as_text(f.claim) + "\n";
    vp += "Cited files: " + as_text(f.files) + "\n";
    vp += "Claimed evidence: " + json_encode(as_text(f.evidence)) + "\n";
    vp += "Claimed cost model: " + json_encode(as_text(f.cost_model)) + "\n";
    vp += "Claimed refactor: " + json_encode(as_text(f.refactor)) + "\n";
    vjobs.push(#{
        prompt: vp,
        label: "verify:" + as_text(f.id),
        capability_mode: "read-only",
        output_schema: verdict_schema,
    });
}
let verdicts = parallel(vjobs);

let confirmed = [];
let i = 0;
for v in verdicts {
    if v != () && v.success && v.output != () && v.output.real == true
        && v.output.evidence != () && v.output.evidence != "" {
        confirmed.push(ranked[i]);
    }
    i += 1;
}
log(confirmed.len().to_string() + "/" + ranked.len().to_string() + " findings survived verification");

phase("Synthesize");

let synth = "";
synth += "Write the architecture-cost report for fmarch at " + repo + ".\n";
synth += "You may re-read a few key files if needed. Prefer the verified findings below over unverified ones.\n";
synth += "Audience: the solo BDFL who asked for wire format, atomic-function unit costs, architectural shape, highest-value data-efficiency refactors, and scale-cost considerations.\n";
synth += "Do not propose a compatibility branch. Greenfield stance: change the superior shape.\n\n";
synth += "Verified findings JSON:\n";
synth += json_encode(confirmed);
synth += "\nUnverified-but-ranked (do not treat as fact):\n";
synth += json_encode(ranked);
synth += "\nInventory:\n";
synth += inventory_json;
synth += "\nFill:\n";
synth += "executive: 1 short paragraph on the actual shape (event-sourced game aggregate, REST JSON commands, CBOR live snapshots, JSON-sealed events).\n";
synth += "unit_cost_model: the real atomic functions and what each costs today (vote, post, resolve, live tick, host hydrate, rebuild, seal).\n";
synth += "ranked_refactors: highest-value first, each with save, risk, and when to do it (now vs when N games/sockets).\n";
synth += "scale_considerations: how to keep Railway/Postgres/bandwidth cheap if this ever leaves one-operator scale.\n";
synth += "do_not_do: attractive cost cuts that would violate event-source truth, capability authz, or replay.\n";

let synthesized = agent(synth, #{
    label: "synthesize",
    capability_mode: "read-only",
    output_schema: report_schema,
});

let report_body = "";
if synthesized != () && synthesized.success && synthesized.output != () {
    report_body += "# Wire and unit-cost architecture audit\n\n";
    report_body += "## Executive\n\n";
    report_body += as_text(synthesized.output.executive);
    report_body += "\n\n## Unit-cost model\n\n";
    report_body += as_text(synthesized.output.unit_cost_model);
    report_body += "\n\n## Ranked refactors\n\n";
    report_body += as_text(synthesized.output.ranked_refactors);
    report_body += "\n\n## Scale considerations\n\n";
    report_body += as_text(synthesized.output.scale_considerations);
    report_body += "\n\n## Do not do\n\n";
    report_body += as_text(synthesized.output.do_not_do);
    report_body += "\n\n## Verified findings\n\n";
    report_body += json_encode(confirmed);
    report_body += "\n";
} else {
    report_body += "# Wire and unit-cost architecture audit\n\nSynthesis agent failed. Verified findings:\n\n";
    report_body += json_encode(confirmed);
    report_body += "\n";
}

let report_path = write_scratch_file("wire-cost-architecture-audit.md", report_body);
complete(#{
    path: report_path,
    summary: confirmed.len().to_string() + " verified findings",
    confirmed_count: confirmed.len(),
    ranked_count: ranked.len(),
    report: report_body,
});
