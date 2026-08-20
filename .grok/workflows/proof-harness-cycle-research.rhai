let meta = #{
    name: "proof-harness-cycle-research",
    description: "Deep research of fmarch proof harness: retire or freeze unlikely-to-regress work and shorten local proof cycle time",
    when_to_use: "When reviewing proof lanes, frozen/active tiers, test sprawl, or inner/push/sprint/full cycle cost",
    phases: [
        #{ title: "Inventory", detail: "map lanes, tiers, timings, selector, and unlisted proof sprawl" },
        #{ title: "Investigate", detail: "testing argument, selection optimality, build DAG, runner cost, industry practice, cold candidates" },
        #{ title: "Verify", detail: "adversarial evidence check of the highest-value claims" },
        #{ title: "Synthesize", detail: "ranked retire/freeze/speed plan with cycle-time model" },
    ],
};

let inventory_schema = #{
    "type": "object",
    "required": ["lane_map", "tier_map", "cost_map", "selector_model", "unlisted_sprawl", "open_work"],
    "properties": #{
        "lane_map": #{ "type": "string" },
        "tier_map": #{ "type": "string" },
        "cost_map": #{ "type": "string" },
        "selector_model": #{ "type": "string" },
        "unlisted_sprawl": #{ "type": "string" },
        "open_work": #{ "type": "string" },
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
                "required": ["id", "area", "severity", "claim", "evidence", "files", "cycle_effect", "action"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "area": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                    "claim": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "files": #{ "type": "string" },
                    "cycle_effect": #{ "type": "string" },
                    "action": #{ "type": "string" },
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
    "required": ["executive", "cycle_model", "retire_or_freeze", "speed_moves", "do_not_do"],
    "properties": #{
        "executive": #{ "type": "string" },
        "cycle_model": #{ "type": "string" },
        "retire_or_freeze": #{ "type": "string" },
        "speed_moves": #{ "type": "string" },
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

let focus = "";
if args != () && args.focus != () && type_of(args.focus) == "string" {
    focus = args.focus;
}

let repo = "/Users/fluffypro/apps/fmarch";

phase("Inventory");
log("Inventorying proof harness (focus=" + focus + ")");

let mapper_prompt = "";
mapper_prompt += "You are inventorying the shipped fmarch local proof harness at " + repo + ".\n";
mapper_prompt += "Use only read-only tools: read_file, grep, list_dir. Read the files; do not answer from memory.\n";
mapper_prompt += "An empty string field is valid only after you opened the listed files and found nothing to say.\n\n";
mapper_prompt += "Read at least these:\n";
mapper_prompt += "- docs/ops/proof-lane-manifest.json (all lanes and areas; note every frozen vs active area)\n";
mapper_prompt += "- docs/ops/proof-lane-timings.json (which lanes have measured seconds, which are missing)\n";
mapper_prompt += "- docs/ops/proof-lane-refactor-scope.md\n";
mapper_prompt += "- docs/ops/proof-product-freeze.md\n";
mapper_prompt += "- docs/ops/completion-registry.json (status=complete capabilities cited by frozen areas)\n";
mapper_prompt += "- tools/proof_lane_select.mjs and tools/proof_lane_select.test.mjs\n";
mapper_prompt += "- package.json scripts named proof:*, test:*, check:* — count npm test scripts vs manifest leaves\n";
mapper_prompt += "- Agents.md local-proof section\n";
mapper_prompt += "- Cargo.toml workspace members and any crate that is tested but not a leaf\n";
mapper_prompt += "- If present: target/proof-lanes/timings.json (ignored runtime observations)\n\n";
mapper_prompt += "Fill every schema field with concrete, file-cited inventory:\n";
mapper_prompt += "lane_map: every manifest leaf, command, after/depends, generated-artifact inputs/outputs, and any npm alias that is NOT a leaf.\n";
mapper_prompt += "tier_map: every area id, tier, lanes, also_triggers, capabilities. Count frozen vs active. Note areas whose paths are so broad they re-arm often (tools/, docs/ops/, frontend/, workspace:manifests).\n";
mapper_prompt += "cost_map: measured seconds per lane; list lanes with NO tracked timing; name the three most expensive measured leaves; estimate full-mode wall if serialized.\n";
mapper_prompt += "selector_model: inner/push/sprint/full expansion, origin/main base, reverse cargo closure, also_triggers, generated-artifact arming, sentinel set and 60s budget, execution order, stop-on-fail, --record vs observation.\n";
mapper_prompt += "unlisted_sprawl: package.json / tools/* proof scripts that are outside the manifest (admin-proof, role-proof, hosted-identity, capacity-overload, local-postgres-ci, frontend-role-proof:quick, etc.). Say whether they are still invoked by anything, deprecated, or dead.\n";
mapper_prompt += "open_work: remaining refactor-scope packages (receipts, run-scoped Postgres, resource scheduler) and whether they are still unimplemented in the selector.\n";
if focus != "" {
    mapper_prompt += "\nOptional focus steer: " + focus + "\n";
}

let mapped = agent(mapper_prompt, #{
    label: "inventory",
    capability_mode: "read-only",
    output_schema: inventory_schema,
});

let inventory = #{
    lane_map: "",
    tier_map: "",
    cost_map: "",
    selector_model: "",
    unlisted_sprawl: "",
    open_work: "",
};
if mapped != () && mapped.success && mapped.output != () {
    inventory.lane_map = as_text(mapped.output.lane_map);
    inventory.tier_map = as_text(mapped.output.tier_map);
    inventory.cost_map = as_text(mapped.output.cost_map);
    inventory.selector_model = as_text(mapped.output.selector_model);
    inventory.unlisted_sprawl = as_text(mapped.output.unlisted_sprawl);
    inventory.open_work = as_text(mapped.output.open_work);
}
let inventory_json = json_encode(inventory);
log("inventory captured: lanes=" + inventory.lane_map.len().to_string() + " sprawl=" + inventory.unlisted_sprawl.len().to_string());

phase("Investigate");

let common = "";
common += "Repo: " + repo + "\n";
common += "Use read-only tools (read_file, grep, list_dir). Inspect shipped code before answering. Do not invent files.\n";
common += "A valid empty findings list requires you to have read the relevant files and found no concrete defect for this lens.\n";
common += "Goal: retire or make COLD any proof that is unlikely to have regressed, and SHORTEN local proof cycle time (inner/push first, then sprint, then full).\n";
common += "In this repo, 'cold' means: frozen-tier (sprint-excluded, still re-armed by touch), full-only, or deleted/deprecated. Do not weaken full-mode coverage unless a leaf is truly redundant.\n";
common += "Greenfield stance: no compatibility branch. Do not move proof authority to GitHub or fluffycachy.\n";
common += "severity: high = pays on ordinary push or every inner loop; medium = pays on sprint; low = full-only or theoretical.\n";
common += "id: lowercase hyphen slug unique to the claim.\n";
common += "cycle_effect: seconds or selection-frequency saved, and which mode (inner/push/sprint/full).\n";
common += "action: one of retire | freeze | full-only | split-leaf | isolate-resource | measure | keep.\n";
common += "Prior inventory (untrusted, re-check):\n";
common += inventory_json;
common += "\n";
if focus != "" {
    common += "Optional focus steer: " + focus + "\n";
}

let testing_prompt = common;
testing_prompt += "You are the testing-architecture auditor.\n";
testing_prompt += "Ask: does each expensive leaf constitute an argument for correctness, or does it merely exercise paths? Where do suites overlap so one can go cold?\n";
testing_prompt += "Inspect crates/commands tests (unit vs pipeline vs runtime_cancellation vs semantic_audit), cargo:api vs mash-scale vs live-stack, frontend role/visual/csp/contract lanes, operator_proof minimizer vs commands-audit.\n";
testing_prompt += "Inspect tools/dev_test_game* admin-proof sprawl vs proof-product-freeze.md ban list.\n";
testing_prompt += "Name concrete tests or lanes that can be retired, frozen, or made full-only without losing a unique correctness claim. Cite files.\n";

let bellman_prompt = common;
bellman_prompt += "You are the richard-bellman-optimality auditor.\n";
bellman_prompt += "Ask: is proof selection formulated with minimal sufficient state? What is the cost-to-go of a typical inner/push/sprint/full run?\n";
bellman_prompt += "Inspect tools/proof_lane_select.mjs: reverse cargo closure, also_triggers, longest-prefix areas, workspace:manifests, tools/, docs/ops/, clippy-workspace on every crate, crate:api also_triggers frontend:identity, crate:wire also_triggers frontend:game + tools:proof-infra.\n";
bellman_prompt += "Flag dimensionality blowup: touching Cargo.lock or package.json, touching tools/, touching a frozen crate that reverse-closes many dependents.\n";
bellman_prompt += "Each finding should name the over-selected work and the smaller sufficient set.\n";

let build_prompt = common;
build_prompt += "You are the build-architecture auditor.\n";
build_prompt += "Ask: how the crate DAG and cargo invocation shape proof velocity. clippy --workspace --all-targets, per-crate cargo test process startup, missing nextest, serial --test-threads=1, RUST_MIN_STACK on audit.\n";
build_prompt += "Inspect Cargo.toml workspace, crates/*/Cargo.toml dependency edges that make reverse-closure huge, rust-toolchain.toml, scripts/check-build-posture.sh, check:wire-types / check:command-goldens.\n";
build_prompt += "Quantify compile-vs-test where evidence exists. Propose leaf splits or invocation changes that cut wall-clock without dropping unique tests.\n";

let perf_prompt = common;
perf_prompt += "You are the performance-audit architect.\n";
perf_prompt += "Ask: what dominates wall-clock on this Darwin checkout, and what isolation/scheduling leftover still serializes independent work.\n";
perf_prompt += "Inspect proof-lane-timings.json, proof-lane-refactor-scope.md packages 5-6, tools/dev_postgres.mjs, cargo:api 192s, cargo:commands-pg 130s, cargo:commands-audit 552s, test:auth-invite-role-proof 72s.\n";
perf_prompt += "Note missing timings (clippy-workspace, most frontend browser lanes, event-key-rotation, csp, visual-regression).\n";
perf_prompt += "Propose concrete speed moves: nextest, lane-scoped DBs, parallel hermetic leaves, timeouts, stop measuring cold work on push.\n";

let industry_prompt = common;
industry_prompt += "You are an industry-practice researcher for local test selection and making suites cold.\n";
industry_prompt += "Use web_search and open_page. Cite URLs. Mark Confirmed / Plausible / Speculative.\n";
industry_prompt += "Compare this repo's frozen-tier + reverse-crate-closure + also_triggers + push sentinels to:\n";
industry_prompt += "Google TAP / change-based testing, Bazel/Buck target determinators, cargo-nextest, cargo-mutants, sccache, GitHub merge-queue required checks, flake quarantine, test-impact analysis.\n";
industry_prompt += "Only keep findings that transfer to a one-developer Darwin local-proof repo that must NOT move authority to GitHub CI.\n";
industry_prompt += "Each finding: what practice, why it fits fmarch evidence, action, cycle_effect.\n";

let cold_prompt = common;
cold_prompt += "You are a cold-candidate mapper. Produce the explicit retire/freeze/full-only list.\n";
cold_prompt += "Walk every manifest area and every expensive leaf. For each candidate, say WHY it is unlikely to regress unless its owned inputs change, and what still re-arms it today (path prefix, crate reverse closure, also_triggers, workspace:manifests, sprint-active).\n";
cold_prompt += "Prioritize: cargo:commands-audit (already full-ish?), cargo:api, auth-invite, visual-regression, clippy-workspace, unlisted admin-proof scripts, railway/production/workos contract lanes on inner/push, crate:server's huge lane bag, frontend:game already frozen but re-armed by wire.\n";
cold_prompt += "Also name active-tier areas that should be re-declared frozen at the next sprint boundary, citing completion-registry capabilities.\n";
cold_prompt += "Do not recommend freezing something whose owned inputs still change weekly without evidence.\n";

let investigate_jobs = [
    #{
        prompt: testing_prompt,
        label: "lens:testing",
        capability_mode: "read-only",
        agent_type: "testing-architecture-auditor",
        output_schema: findings_schema,
    },
    #{
        prompt: bellman_prompt,
        label: "lens:selection",
        capability_mode: "read-only",
        agent_type: "richard-bellman-optimality-auditor",
        output_schema: findings_schema,
    },
    #{
        prompt: build_prompt,
        label: "lens:build",
        capability_mode: "read-only",
        agent_type: "build-architecture-auditor",
        output_schema: findings_schema,
    },
    #{
        prompt: perf_prompt,
        label: "lens:perf",
        capability_mode: "read-only",
        agent_type: "performance-audit-architect",
        output_schema: findings_schema,
    },
    #{
        prompt: industry_prompt,
        label: "lens:industry",
        capability_mode: "all",
        output_schema: findings_schema,
    },
    #{
        prompt: cold_prompt,
        label: "lens:cold",
        capability_mode: "read-only",
        output_schema: findings_schema,
    },
];

let investigate_results = parallel(investigate_jobs);

let findings = [];
let seen_ids = #{};
for r in investigate_results {
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
log("investigate produced " + findings.len().to_string() + " unique evidenced findings");

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
        summary: "No evidenced findings survived inventory/investigate collection.",
        confirmed: [],
    });
}

phase("Verify");

let vjobs = [];
for f in ranked {
    let vp = "";
    vp += "Adversarially verify this proof-harness finding against shipped code in " + repo + ".\n";
    vp += "Use read_file/grep. Set real=true only with independent evidence you inspected.\n";
    vp += "Default real=false if the claim is already mitigated, the cost model is wrong, or the proposed cold/retire would drop a unique correctness argument.\n";
    vp += "Finding id: " + as_text(f.id) + "\n";
    vp += "Area: " + as_text(f.area) + "\n";
    vp += "Severity: " + as_text(f.severity) + "\n";
    vp += "Claim: " + as_text(f.claim) + "\n";
    vp += "Cited files: " + as_text(f.files) + "\n";
    vp += "Claimed evidence: " + json_encode(as_text(f.evidence)) + "\n";
    vp += "Claimed cycle effect: " + json_encode(as_text(f.cycle_effect)) + "\n";
    vp += "Claimed action: " + json_encode(as_text(f.action)) + "\n";
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
synth += "Write the proof-harness cycle-time research report for fmarch at " + repo + ".\n";
synth += "You may re-read a few key files if needed. Prefer verified findings over unverified ones.\n";
synth += "Audience: the solo BDFL who wants to retire or freeze proof that is unlikely to have regressed, and shorten inner/push/sprint cycle time. Full mode must stay honest.\n";
synth += "Do not propose GitHub CI as the source of truth. Do not move canonical --run off the Darwin checkout.\n\n";
synth += "Verified findings JSON:\n";
synth += json_encode(confirmed);
synth += "\nUnverified-but-ranked (do not treat as fact):\n";
synth += json_encode(ranked);
synth += "\nInventory:\n";
synth += inventory_json;
synth += "\nFill:\n";
synth += "executive: 1 short paragraph on the actual harness (manifest v3, frozen/active, reverse crate closure, incomplete timings, unlisted admin-proof sprawl) and the biggest cycle-time lie.\n";
synth += "cycle_model: inner vs push vs sprint vs full — what each currently costs when known, what over-selects, what is still serial because of shared DATABASE_URL.\n";
synth += "retire_or_freeze: ranked list of leaves/areas/scripts to retire, freeze, or make full-only, each with the unique claim that remains elsewhere (or why none is needed).\n";
synth += "speed_moves: ranked implementation order for shortening the loop (measure missing timings, isolate Postgres, parallel hermetic, clippy scope, sentinel honesty, nextest, receipts). Each with expected save.\n";
synth += "do_not_do: attractive cuts that would make full mode dishonest, hide blast radius (wire->frontend), or productize local proof metadata.\n";

let synthesized = agent(synth, #{
    label: "synthesize",
    capability_mode: "read-only",
    output_schema: report_schema,
});

let report_body = "";
if synthesized != () && synthesized.success && synthesized.output != () {
    report_body += "# Proof harness cycle research\n\n";
    report_body += "## Executive\n\n";
    report_body += as_text(synthesized.output.executive);
    report_body += "\n\n## Cycle model\n\n";
    report_body += as_text(synthesized.output.cycle_model);
    report_body += "\n\n## Retire or freeze\n\n";
    report_body += as_text(synthesized.output.retire_or_freeze);
    report_body += "\n\n## Speed moves\n\n";
    report_body += as_text(synthesized.output.speed_moves);
    report_body += "\n\n## Do not do\n\n";
    report_body += as_text(synthesized.output.do_not_do);
    report_body += "\n\n## Verified findings\n\n";
    report_body += json_encode(confirmed);
    report_body += "\n";
} else {
    report_body += "# Proof harness cycle research\n\nSynthesis agent failed. Verified findings:\n\n";
    report_body += json_encode(confirmed);
    report_body += "\n";
}

let report_path = write_scratch_file("proof-harness-cycle-research.md", report_body);
complete(#{
    path: report_path,
    summary: confirmed.len().to_string() + " verified findings",
    confirmed_count: confirmed.len(),
    ranked_count: ranked.len(),
    report: report_body,
});
