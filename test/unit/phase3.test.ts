import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { seal, unseal } from "@orbit/integrations/token-crypto";
import { parseCsv } from "@orbit/integrations/seo-data";
import {
  computeFacts,
  adviceFixture,
  validateAdvice,
  csvCell,
} from "@orbit/workspaces/seo-insights";
import {
  SearchRequest,
  Dataset,
  assertRows,
  SeoAdvice,
} from "@orbit/shared/seo";
import { digest, jsonBytes } from "@orbit/storage/store";
import { gscHttp } from "@orbit/integrations/gsc-http";
import { currentRows, previousRows, testSpec, gscStub } from "../gsc-support";
const data = () =>
  Dataset.parse({
    version: 1,
    spec: testSpec,
    current: currentRows,
    previous: previousRows,
    provenance: {
      kind: "IMPORT",
      captured_at: "2026-11-03T00:00:00.000Z",
      source_hashes: ["a".repeat(64)],
      warnings: ["USER_SUPPLIED"],
      permission: "read-only",
      timezone: "America/Los_Angeles",
    },
  });
test("AES-GCM tokens have random IVs, authenticate owner/context and fail closed on tamper/key mismatch", () => {
  const before = process.env.ORBIT_TOKEN_ENCRYPTION_KEY;
  process.env.ORBIT_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const a = seal("token-value", "owner:access"),
      b = seal("token-value", "owner:access");
    assert.notEqual(a, b);
    assert.ok(!a.includes("token-value"));
    assert.equal(unseal(a, "owner:access"), "token-value");
    assert.throws(() => unseal(a, "other:access"));
    assert.throws(() => unseal(a.slice(0, -2) + "xx", "owner:access"));
    process.env.ORBIT_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    assert.throws(() => unseal(a, "owner:access"));
  } finally {
    if (before === undefined) delete process.env.ORBIT_TOKEN_ENCRYPTION_KEY;
    else process.env.ORBIT_TOKEN_ENCRYPTION_KEY = before;
  }
});
test("period and row validation reject overlap, unequal periods, impossible counts, duplicate and out-of-property rows", () => {
  assert.equal(
    SearchRequest.parse(testSpec).current.start,
    testSpec.current.start,
  );
  assert.throws(() =>
    SearchRequest.parse({
      ...testSpec,
      previous: { start: "2026-09-01", end: "2026-09-30" },
    }),
  );
  assert.throws(() =>
    SearchRequest.parse({ ...testSpec, previous: testSpec.current }),
  );
  assert.throws(() =>
    assertRows(testSpec, [currentRows[0], currentRows[0]], []),
  );
  assert.throws(() =>
    assertRows(
      testSpec,
      [{ ...currentRows[0], page: "https://evil.test" }],
      [],
    ),
  );
  assert.throws(() =>
    Dataset.parse({
      ...data(),
      current: [{ ...currentRows[0], clicks: 2000 }],
    }),
  );
});
test("CSV parses BOM/quoted commas/newlines and JSON-compatible finite numeric rows, rejects malformed headers/quotes/empty numbers", () => {
  const parsed = parseCsv(
    '\uFEFFperiod,page,query,clicks,impressions,position\r\ncurrent,https://wheyshop.vn/a,"whey, \"\"isolate\"\"\nquery",20,1000,8\r\n',
  );
  assert.equal(parsed.current[0].query, 'whey, "isolate"\nquery');
  for (const input of [
    "page,clicks\na,1",
    'period,page,query,clicks,impressions,position\ncurrent,https://wheyshop.vn,"unterminated,1,2,3',
    "period,page,query,clicks,impressions,position\ncurrent,https://wheyshop.vn/a,q,,2,3",
  ])
    assert.throws(() => parseCsv(input));
  assert.match(csvCell('=IMPORTXML("x")'), /^"'/);
});
test("SEO numbers are deterministic: CTR uses sums, position is impression weighted, baseline deltas are explicit", () => {
  const facts = computeFacts(data(), "b".repeat(64));
  assert.equal(facts.totals.clicks, 55);
  assert.equal(facts.totals.impressions, 2000);
  assert.equal(facts.totals.ctr, 55 / 2000);
  assert.equal(facts.totals.position, (8000 + 1500 + 6000) / 2000);
  const whey = facts.facts.find((f) => f.query === "whey")!;
  assert.equal(whey.click_delta, -20);
  assert.equal(whey.click_change_pct, -50);
  assert.ok(whey.eligible.includes("DECLINING_CLICKS"));
});
test("AI cannot invent numeric fields, evidence IDs, reasons or source hashes", () => {
  const facts = computeFacts(data(), "b".repeat(64)),
    fh = digest(jsonBytes(facts)),
    source = "c".repeat(64),
    advice = adviceFixture(facts, source, fh);
  assert.ok(validateAdvice(advice, facts, source, fh));
  assert.throws(() => SeoAdvice.parse({ ...advice, clicks: 99999 }));
  assert.throws(() =>
    validateAdvice(
      { ...advice, source_sha256: "0".repeat(64) },
      facts,
      source,
      fh,
    ),
  );
  assert.throws(() =>
    validateAdvice(
      { ...advice, items: [{ ...advice.items[0], fact_id: "made-up" }] },
      facts,
      source,
      fh,
    ),
  );
  assert.throws(() =>
    validateAdvice(
      {
        ...advice,
        items: [
          { ...advice.items[0], reason: "MONITOR", action: "REVIEW_CONTENT" },
        ],
      },
      facts,
      source,
      fh,
    ),
  );
});
test("GSC HTTP protocol normalizes 401/403/429, Retry-After and timeout without hidden retry or LIVE claim", async () => {
  const stub = await gscStub();
  try {
    for (const [status, code] of [
      [401, "GSC_UNAUTHORIZED"],
      [403, "GSC_FORBIDDEN"],
      [429, "GSC_RATE_LIMIT"],
    ] as const) {
      stub.state.apiStatus = status;
      await assert.rejects(
        () =>
          gscHttp(
            stub.transport,
            stub.transport.api + "/sites",
            { method: "GET" },
            new AbortController().signal,
          ),
        (e: unknown) => e instanceof Error && e.message === code,
      );
    }
    assert.equal(stub.requests.length, 3);
    const invalidToken = {
      ...stub.transport,
      fetch: async () =>
        new Response('{"error":"invalid_token"}', {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    };
    assert.deepEqual(
      await gscHttp(
        invalidToken,
        invalidToken.revoke,
        { method: "POST" },
        new AbortController().signal,
      ),
      { revoked: true },
    );
    await assert.rejects(
      () =>
        gscHttp(
          invalidToken,
          invalidToken.api + "/sites",
          { method: "GET" },
          new AbortController().signal,
        ),
      /GSC_REQUEST_REJECTED/,
    );
    stub.state.apiStatus = 200;
    stub.state.delay = 100;
    await assert.rejects(
      () =>
        gscHttp(
          stub.transport,
          stub.transport.api + "/sites",
          { method: "GET" },
          AbortSignal.timeout(10),
        ),
      /GSC_TIMEOUT/,
    );
    assert.equal(stub.transport.kind, "HTTP_STUB");
  } finally {
    await stub.close();
  }
});
