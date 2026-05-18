/**
 * enricher.js — Rewrite a rough prompt as a senior engineer would write it.
 *
 * Anti-hallucination design principles baked into every output:
 *  1. Explicit scope boundary  — "implement only what is listed"
 *  2. Assumption declaration   — AI must state assumptions before writing code
 *  3. Uncertainty marking      — [UNCERTAIN: ...] instead of inventing details
 *  4. No invention rule        — no APIs/libs the AI is not certain exist
 *  5. Clarification invitation — ask rather than guess on ambiguous requirements
 *  6. Structured output format — numbered sections prevent free-form rambling
 */

// ── Concept expansions ────────────────────────────────────────────────────────

const PF_CONCEPT_EXPANSIONS = {
  auth: [
    "Validate the token signature and algorithm. Pin the expected algorithm explicitly — never accept 'none'.",
    "Check the `exp` claim and return a distinct error for expired tokens vs invalid/malformed tokens.",
    "Attach the decoded identity (user_id, roles, email) to the request context — never to a global.",
    "Never expose signing keys, algorithm details, or internal errors in HTTP responses.",
  ],
  jwt: [
    "Pin the signing algorithm (e.g. HS256 or RS256). Reject tokens signed with any other algorithm.",
    "Validate `exp`, `iat`, and `iss` claims. Return distinct HTTP codes: 401 expired, 400 malformed, 401 invalid signature.",
    "Never decode without verifying the signature first.",
  ],
  oauth: [
    "Implement PKCE for the authorization code flow.",
    "Validate the `state` parameter on every callback to prevent CSRF.",
    "Rotate refresh tokens on every use — revoke the previous token immediately.",
    "Store tokens server-side or in HttpOnly cookies. Never in localStorage.",
  ],
  password: [
    "Hash with bcrypt (cost ≥ 12) or argon2id. Never MD5, SHA-1, or unsalted hashes.",
    "Enforce a minimum length of 12 characters.",
    "Rate-limit login attempts per IP and per account with separate counters.",
    "Never log, return, or echo the password at any point in the request cycle.",
  ],
  database: [
    "Use a connection pool — never open a new connection per request.",
    "Wrap multi-step writes in a transaction. Roll back the entire unit on any failure.",
    "Use parameterised queries or a trusted ORM. Zero string interpolation of user input.",
    "Index every column used in WHERE, JOIN, or ORDER BY clauses.",
  ],
  sql: [
    "Use parameterised queries exclusively — zero string interpolation of user input.",
    "Keep transactions as short as possible to minimise lock contention.",
    "Verify index usage with EXPLAIN ANALYZE before considering the query production-ready.",
  ],
  migration: [
    "The migration must be idempotent — safe to re-run on a database it has already modified.",
    "Provide a reversible `down` migration.",
    "Test the migration against a copy of production data before merging.",
  ],
  api: [
    "Version the endpoint from day one (e.g. `/v1/`).",
    "Return a consistent error shape: `{ error: string, code: string, details?: object }`.",
    "Validate and reject unknown/unexpected input fields.",
    "Document the full contract (request schema, response schema, error codes) inline.",
  ],
  rest: [
    "Use correct HTTP verbs and status codes (201 for creation, 204 for no-body success, 409 for conflict).",
    "Implement idempotency keys for POST operations that create resources.",
    "Paginate list endpoints — never return an unbounded result set.",
  ],
  webhook: [
    "Verify the HMAC signature on every incoming payload before processing.",
    "Respond 200 immediately and process the payload asynchronously.",
    "Make the handler idempotent — deduplicate by delivery ID to prevent double-processing.",
    "Implement exponential backoff on outbound retries with a dead-letter queue after N failures.",
  ],
  cache: [
    "Define the cache key scheme explicitly — include every dimension that affects the result.",
    "Set a TTL on every key. No key should live indefinitely.",
    "Handle cache miss, stale data, and cache stampede (probabilistic refresh or a mutex).",
    "State whether this is cache-aside, read-through, or write-through and justify the choice.",
  ],
  redis: [
    "Use pipelining for batch operations to reduce round-trip overhead.",
    "Set a TTL on every key. Avoid using Redis as a permanent data store unless explicitly intended.",
    "Set an appropriate `maxmemory-policy` (LRU vs LFU vs noeviction) for this use case.",
  ],
  queue: [
    "Consumers must be idempotent — the same message may arrive more than once.",
    "Implement a dead-letter queue for messages that fail repeatedly.",
    "Log the message ID at every processing step for end-to-end traceability.",
  ],
  async: [
    "Never fire-and-forget — always handle errors from async operations.",
    "Set a timeout on every async I/O call. Never await indefinitely.",
    "Propagate cancellation signals through the full call chain.",
  ],
  worker: [
    "Handle SIGTERM gracefully — finish the current job before shutting down.",
    "Implement a heartbeat or health check so a scheduler can detect stuck workers.",
    "Job processing must be idempotent so retries after failure are safe.",
  ],
  docker: [
    "Use a multi-stage build to keep the final image minimal.",
    "Run the process as a non-root user.",
    "Pin base image versions — never use `latest`.",
    "Add a HEALTHCHECK instruction.",
  ],
  kubernetes: [
    "Set resource requests AND limits for every container.",
    "Define both liveness and readiness probes.",
    "Use a PodDisruptionBudget for services with an availability SLO.",
    "Never store secrets in ConfigMaps — use Kubernetes Secrets or an external vault.",
  ],
  test: [
    "Cover the happy path, all documented error paths, and at least two edge cases.",
    "Name tests after behaviour: `test_<unit>_<condition>_<expected_result>`.",
    "No shared mutable state between tests — each must be independently runnable.",
    "Mock at the I/O boundary only. Never mock business logic.",
  ],
  react: [
    "Avoid unnecessary re-renders — memoize expensive child components.",
    "Keep side effects in useEffect with correct, minimal dependency arrays.",
    "Handle loading, error, and empty states for every data-fetching hook.",
    "Do not store derived state in useState — compute it from existing state/props.",
  ],
  component: [
    "Keep the component focused on one responsibility. Split if it does two distinct things.",
    "Accept a className or style prop so callers can adjust layout without forking.",
    "Document all props with types and a one-line description.",
  ],
  performance: [
    "Profile before optimising — identify the actual bottleneck first.",
    "State the baseline metric and the target (e.g. p99 < 200 ms).",
    "Prefer algorithmic improvements over micro-optimisations.",
    "Add a benchmark test so regressions are caught in CI.",
  ],
  memory: [
    "Determine whether the issue is a leak (growing indefinitely) or high steady-state usage.",
    "Use a profiler to locate the largest allocations — do not guess.",
    "Check for references held in closures, caches, or globals that prevent garbage collection.",
  ],
  encryption: [
    "Use AES-256-GCM for symmetric encryption. Include a random IV per operation.",
    "Never reuse an IV with the same key.",
    "Use AEAD — authenticate the ciphertext before decrypting to detect tampering.",
    "Plan for key rotation from day one.",
  ],
  "rate limit": [
    "Apply limits at the edge (load balancer / API gateway) as the first line of defence.",
    "Use a sliding window algorithm for a smoother limit than a fixed window.",
    "Return a `Retry-After` header so clients can back off gracefully.",
    "Implement separate burst and sustained rate limits.",
  ],
  microservice: [
    "Define the service boundary — what data does this service own exclusively?",
    "Design for failure: circuit breaker, retry with exponential backoff, timeout on every outbound call.",
    "Use correlation IDs for distributed tracing.",
    "Version your API contract and maintain backward compatibility within a major version.",
  ],
  distributed: [
    "State the consistency model required: strong, eventual, or causal.",
    "Design for partial failure — what happens when one node is unreachable?",
    "Use idempotent operations wherever possible so retries are safe.",
  ],
};

// ── Task structures ───────────────────────────────────────────────────────────

const PF_TASK_STRUCTURE = {
  implement: {
    role: "senior software engineer",
    coreLabel: "Implement",
    sections: [
      ["Functional requirements",    "List the exact behaviour: inputs, outputs, documented side effects, and every state the component must handle correctly."],
      ["Error handling",             "For every failure mode, specify the exact exception type or HTTP status code. No catch-all handlers."],
      ["Edge cases",                 "Cover: empty/null/zero input, maximum size, concurrent access, partial failure in multi-step operations."],
      ["Non-functional requirements","State thread-safety expectations, statelessness, memory/latency constraints, and backward-compatibility requirements."],
      ["Testability",                "Accept dependencies (secrets, clocks, HTTP clients) via parameters or DI, not from global state."],
    ],
    deliverables: [
      "Full implementation with type annotations and a comment on every non-obvious decision.",
      "Unit tests covering all documented error paths and the two most critical edge cases.",
      "A design note (3–5 sentences) on the key trade-off made.",
    ],
  },
  debug: {
    role: "senior engineer conducting a debugging session",
    coreLabel: "Debug",
    sections: [
      ["Reproduction",      "Provide the smallest self-contained example that reliably triggers the bug. State whether intermittent or deterministic."],
      ["Hypotheses",        "List the top 3 root-cause candidates ranked by probability. For each, state the evidence that would confirm or rule it out."],
      ["Fix",               "Apply the minimal surgical change. Do not refactor unrelated code. Explain why the fix works, not just what it changes."],
      ["Regression guard",  "Write a test that fails before the fix and passes after. Identify if the same pattern exists elsewhere."],
    ],
    deliverables: [
      "Root cause diagnosis in 2–3 sentences.",
      "Fix as a clean diff or annotated snippet.",
      "Regression test.",
      "One concrete recommendation to prevent this class of bug.",
    ],
  },
  refactor: {
    role: "senior engineer performing a focused refactor",
    coreLabel: "Refactor",
    sections: [
      ["Constraints",  "External behaviour must not change. Keep the diff minimal. Do not fix unrelated issues in the same PR."],
      ["Goals",        "State the specific quality property to improve: naming, duplication, coupling, control-flow nesting, or separation of concerns."],
      ["Out of scope", "List issues noticed but deliberately deferred to a follow-up."],
    ],
    deliverables: [
      "Refactored code.",
      "Before/after diff of the three most impactful changes.",
      "Future Work section listing deferred issues.",
    ],
  },
  review: {
    role: "principal engineer conducting a code review",
    coreLabel: "Review",
    sections: [
      ["Correctness",             "Logic errors, off-by-one, type mismatches, unhandled edge cases. Reference specific lines."],
      ["Security",                "Input validation, injection risks, authentication enforcement, secret handling."],
      ["Performance",             "N+1 queries, unnecessary allocations, synchronous I/O on hot paths, wrong data structures."],
      ["Readability",             "Naming clarity, nesting depth, single responsibility, missing public API documentation."],
      ["Testability",             "Can this be unit-tested without mocking internals? Is all documented behaviour covered?"],
    ],
    deliverables: [
      "Overall verdict: Approve / Request changes / Needs discussion.",
      "Blocking issues with file and line reference.",
      "Non-blocking suggestions grouped by category.",
      "Two to three positive callouts.",
    ],
  },
  design: {
    role: "staff engineer designing a system or component",
    coreLabel: "Design",
    sections: [
      ["Assumptions",          "State scale (RPS, data volume, user count), consistency model, p99 latency SLO, team size, and existing stack constraints."],
      ["Options considered",   "2–3 viable approaches: one-sentence summary, key trade-offs, and when you would choose each."],
      ["Recommended design",   "Component responsibilities, data model, API contract, failure modes, and how the design scales to 10x load."],
      ["Decision log",         "The three most significant choices made and the alternatives rejected, with reasoning."],
      ["MVP scope",            "The smallest version that is safe to ship and delivers real value."],
    ],
    deliverables: [
      "ASCII component diagram with responsibility labels.",
      "API or data model contract with field types and constraints.",
      "Decision log with rejected alternatives.",
      "Risk register: top 3 risks with probability, impact, and mitigation.",
    ],
  },
  test: {
    role: "senior engineer writing a production-grade test suite",
    coreLabel: "Test",
    sections: [
      ["Test layer",   "Decide unit / integration / E2E split and justify. Unit: no I/O. Integration: real or high-fidelity fakes. E2E: critical paths only."],
      ["Test cases",   "Happy path, empty/null/zero, boundary values, every documented error path, concurrency if applicable, named regression tests."],
      ["Test quality", "One assertion focus per test. Names: `test_<unit>_<condition>_<expected>`. No shared mutable state. Test the public contract."],
    ],
    deliverables: [
      "Complete test file with arrange / act / assert sections.",
      "All fixtures and mocks with explanation.",
      "Coverage gap analysis — what is not tested and why.",
    ],
  },
  optimize: {
    role: "senior performance engineer",
    coreLabel: "Optimise",
    sections: [
      ["Baseline and target",       "Current measured value and acceptable target. Do not optimise without a baseline."],
      ["Bottleneck identification",  "Top 3 likely bottlenecks: algorithm complexity, I/O wait, memory/GC, lock contention."],
      ["Strategy",                  "Order: algorithm change > caching > batching/async I/O > micro-optimisation."],
      ["Correctness preservation",  "Observable behaviour must be identical after the change. Add a benchmark test."],
    ],
    deliverables: [
      "Profiling plan with specific tool and command.",
      "Optimised implementation with before/after complexity or empirical comparison.",
      "Benchmark output.",
      "A comment explaining why the optimised form is correct.",
    ],
  },
  explain: {
    role: "senior engineer writing documentation for a new contributor",
    coreLabel: "Explain",
    sections: [
      ["Bird's-eye view",     "One paragraph: what this code does at a business level. A non-technical reader should understand the purpose."],
      ["Structural walkthrough", "Main components in the order a new reader encounters them. ASCII flow diagram preferred for branching."],
      ["Non-obvious sections","The 3–5 most surprising lines/blocks: what they do, why written this way, what breaks if changed naively."],
      ["Maintenance guide",   "Implicit assumptions, footguns, global state dependencies, safe change boundaries."],
    ],
    deliverables: [
      "Bird's-eye summary (one paragraph).",
      "Structural walkthrough with ASCII flow if applicable.",
      "Annotated version of the most complex section.",
      "Maintenance notes: footguns, assumptions, safe boundaries.",
    ],
  },
  security: {
    role: "senior application security engineer",
    coreLabel: "Security audit",
    sections: [
      ["Threat model",   "Attacker profile and what they gain from a successful attack."],
      ["Attack surface", "All entry points: HTTP, CLI, env vars, file reads, third-party callbacks, inter-service calls."],
      ["OWASP check",    "For each relevant category (injection, broken auth, data exposure, insecure design, misconfiguration) — state finding."],
      ["Hardening",      "Specific code changes in priority order. Each: description, reproduction steps, exact fix."],
    ],
    deliverables: [
      "Executive summary: risk level (Critical / High / Medium / Low).",
      "Findings table: severity, description, reproduction, fix.",
      "Hardened version of the most critical section.",
      "Three automated security checks to add to CI.",
    ],
  },
};

// ── Anti-hallucination block ──────────────────────────────────────────────────
// This is appended to EVERY enhanced prompt. It is the core anti-hallucination
// layer — it explicitly constrains the AI's output space.

const PF_ANTI_HALLUCINATION = `
─── Precision constraints (read before responding) ──────────────────────────
1. ASSUMPTIONS FIRST — Before writing any code or analysis, list every
   assumption you are making about the environment, framework version,
   existing interfaces, and business rules. Number them.

2. NO INVENTION — Do not reference library functions, API endpoints, config
   keys, or framework features that you are not certain exist in the version
   being used. If uncertain, write:
     [UNCERTAIN: describe what you are unsure about]
   and continue. Do not guess and present it as fact.

3. SCOPE LOCK — Implement only what is explicitly specified above.
   Do not add extra features, abstractions, or dependencies that were not
   requested. If a useful addition comes to mind, mention it in a separate
   "Optional follow-up" section — do not include it in the main output.

4. ASK BEFORE GUESSING — If any requirement is ambiguous and the ambiguity
   would lead to meaningfully different implementations, state your
   interpretation explicitly: "I am interpreting X as Y. If that is wrong,
   let me know."

5. HONEST CONFIDENCE — If you have low confidence in a specific technical
   detail (e.g. exact method signature, behaviour under concurrency), mark it:
     [LOW CONFIDENCE: ...]
   Do not omit the flag to appear more certain.
─────────────────────────────────────────────────────────────────────────────`.trim();

// ── Helpers ───────────────────────────────────────────────────────────────────

function pfFindConceptExpansions(text) {
  const lower = text.toLowerCase();
  const found = [];
  const seen  = new Set();
  for (const [concept, points] of Object.entries(PF_CONCEPT_EXPANSIONS)) {
    if (lower.includes(concept)) {
      for (const p of points) {
        if (!seen.has(p)) { seen.add(p); found.push(p); }
      }
    }
  }
  return found;
}

function pfExtractCore(text) {
  let c = text.trim().replace(/^\s*(can you|please|could you|i need|i want|help me|write me)\s+/i, "");
  return c.length ? c[0].toUpperCase() + c.slice(1) : text.trim();
}

// ── Main enhance function ─────────────────────────────────────────────────────

function pfEnhance(prompt, taskType, language) {
  const struct       = PF_TASK_STRUCTURE[taskType] || PF_TASK_STRUCTURE.implement;
  const conceptReqs  = pfFindConceptExpansions(prompt);
  const core         = pfExtractCore(prompt);
  const langHint     = language ? ` in ${language}` : "";

  const lines = [];

  // Role
  lines.push(`You are a ${struct.role}.`);
  lines.push("");

  // Task
  lines.push(`## ${struct.coreLabel}${langHint}`);
  lines.push("");
  lines.push(core);
  lines.push("");

  // Concept-specific requirements
  if (conceptReqs.length) {
    lines.push("## Technical requirements");
    lines.push("");
    for (const r of conceptReqs) lines.push(`- ${r}`);
    lines.push("");
  }

  // Scope and constraints
  lines.push("## Scope and constraints");
  lines.push("");
  for (const [title, desc] of struct.sections) {
    lines.push(`**${title}**`);
    lines.push(desc);
    lines.push("");
  }

  // Non-negotiables
  lines.push("## Non-negotiables");
  lines.push("");
  lines.push("- Handle all failure paths explicitly — no silent failures or bare catch-all handlers.");
  lines.push("- Validate and sanitise every external input before use.");
  if (!["explain","review"].includes(taskType)) {
    lines.push("- Structure the code so it can be unit-tested without mocking internals.");
  }
  lines.push("- Use descriptive names — the code must be readable without needing comments for the happy path.");
  if (["python","typescript","go","rust","java","c#","swift","kotlin"].includes(language)) {
    lines.push(`- Use ${language} type annotations / types throughout.`);
  }
  lines.push("");

  // Deliverables
  lines.push("## Deliver");
  lines.push("");
  for (let i = 0; i < struct.deliverables.length; i++) {
    lines.push(`${i + 1}. ${struct.deliverables[i]}`);
  }
  lines.push("");

  // Anti-hallucination block
  lines.push(PF_ANTI_HALLUCINATION);

  return lines.join("\n");
}
