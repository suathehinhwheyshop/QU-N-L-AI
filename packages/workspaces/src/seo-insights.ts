import {
  Facts,
  SeoAdvice,
  SeoReview,
  SeoBoard,
  type SeoDataset,
  type Row,
  type SeoFact,
  type FactBundle,
} from "@orbit/shared/seo";
import { OrbitError } from "@orbit/shared/contracts";
import { digest, jsonBytes } from "@orbit/storage/store";
export const metrics = (rows: Row[]) => {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0),
    impressions = rows.reduce((s, r) => s + r.impressions, 0);
  if (!Number.isSafeInteger(clicks) || !Number.isSafeInteger(impressions))
    throw new OrbitError("GSC_INVALID_DATA");
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : null,
    position: impressions
      ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions
      : null,
  };
};
export function computeFacts(data: SeoDataset, sha: string): FactBundle {
  if (!data.current.length) throw new OrbitError("GSC_EMPTY_DATASET");
  const key = (r: Row) => JSON.stringify([r.page, r.query]);
  const old = new Map(data.previous.map((r) => [key(r), r]));
  const current = new Map(data.current.map((r) => [key(r), r]));
  const all = [
    ...data.current,
    ...data.previous.filter((r) => !current.has(key(r))),
  ];
  const facts: SeoFact[] = all.map((r) => {
    const now = current.get(key(r));
    const prev = old.get(key(r));
    const c = metrics(now ? [now] : []),
      p = data.spec.previous ? metrics(prev ? [prev] : []) : null;
    const eligible: SeoFact["eligible"] = ["MONITOR"];
    if (c.impressions >= 100 && c.ctr !== null && c.ctr < 0.03)
      eligible.push("LOW_CTR");
    if (now && prev && p && p.clicks > 0 && c.clicks < p.clicks)
      eligible.push("DECLINING_CLICKS");
    if (c.position !== null && c.position >= 4 && c.position <= 20)
      eligible.push("NEAR_TOP");
    return {
      id: "F-" + digest(Buffer.from(key(r))).slice(0, 24),
      page: r.page,
      query: r.query,
      current_present: !!now,
      previous_present: !!prev,
      current: c,
      previous: p,
      click_delta: p ? c.clicks - p.clicks : null,
      click_change_pct:
        p && p.clicks > 0 ? ((c.clicks - p.clicks) / p.clicks) * 100 : null,
      eligible,
    };
  });
  facts.sort(
    (a, b) =>
      b.eligible.length - a.eligible.length ||
      b.current.impressions +
        (b.previous?.impressions ?? 0) -
        (a.current.impressions + (a.previous?.impressions ?? 0)) ||
      a.id.localeCompare(b.id),
  );
  const warnings = [...data.provenance.warnings];
  if (facts.length > 20)
    warnings.push(
      `Phân tích AI chỉ nhận 20/${facts.length} facts đã xếp hạng; tổng vẫn tính từ toàn bộ các dòng đã thu thập.`,
    );
  if (!data.spec.previous)
    warnings.push("Không có kỳ so sánh; không suy ra tăng/giảm.");
  else
    warnings.push(
      "Không thấy một page/query trong một kỳ không chứng minh lưu lượng bằng 0: GSC có thể ẩn hoặc cắt bớt dòng.",
    );
  return Facts.parse({
    dataset_sha256: sha,
    totals: metrics(data.current),
    previous_totals: data.spec.previous ? metrics(data.previous) : null,
    facts: facts.slice(0, 20),
    warnings,
  });
}
export function adviceFixture(
  facts: FactBundle,
  sourceHash: string,
  factsHash: string,
) {
  return SeoAdvice.parse({
    source_sha256: sourceHash,
    facts_sha256: factsHash,
    items: facts.facts.slice(0, 5).map((f) => {
      const reason = f.eligible.includes("DECLINING_CLICKS")
        ? "DECLINING_CLICKS"
        : f.eligible.includes("LOW_CTR")
          ? "LOW_CTR"
          : f.eligible.includes("NEAR_TOP")
            ? "NEAR_TOP"
            : "MONITOR";
      return {
        fact_id: f.id,
        reason,
        action:
          reason === "DECLINING_CLICKS"
            ? "INVESTIGATE_DECLINE"
            : reason === "LOW_CTR"
              ? "REVIEW_SNIPPET"
              : reason === "NEAR_TOP"
                ? "REVIEW_CONTENT"
                : "MONITOR",
        priority: reason === "MONITOR" ? "P3" : "P1",
      };
    }),
  });
}
const expectedAction = {
  LOW_CTR: "REVIEW_SNIPPET",
  DECLINING_CLICKS: "INVESTIGATE_DECLINE",
  NEAR_TOP: "REVIEW_CONTENT",
  MONITOR: "MONITOR",
};
export function validateAdvice(
  raw: unknown,
  facts: FactBundle,
  source: string,
  factsHash: string,
  review = false,
) {
  const output = review ? SeoReview.parse(raw) : SeoAdvice.parse(raw);
  if (output.source_sha256 !== source || output.facts_sha256 !== factsHash)
    throw new OrbitError("GSC_SOURCE_MISMATCH");
  const seen = new Set<string>();
  for (const item of output.items) {
    const fact = facts.facts.find((f) => f.id === item.fact_id);
    if (
      !fact ||
      seen.has(item.fact_id) ||
      !fact.eligible.includes(item.reason) ||
      expectedAction[item.reason] !== item.action
    )
      throw new OrbitError("INVALID_OUTPUT");
    seen.add(item.fact_id);
  }
  return output;
}
const titles = {
  REVIEW_SNIPPET: "Rà soát title/meta và search intent",
  REVIEW_CONTENT: "Rà soát nội dung và internal link",
  INVESTIGATE_DECLINE: "Điều tra giảm clicks quan sát được",
  MONITOR: "Theo dõi và đối chiếu dữ liệu",
};
const reasons = {
  LOW_CTR: "CTR quan sát thấp theo ngưỡng kiểm tra; chưa kết luận nguyên nhân.",
  DECLINING_CLICKS:
    "Clicks trong các dòng được trả về giảm; cần kiểm tra lại phạm vi dữ liệu.",
  NEAR_TOP: "Vị trí bình quân trong vùng cơ hội kiểm tra; chưa dự báo traffic.",
  MONITOR: "Giữ điểm kiểm tra, không tự suy ra cơ hội hoặc nguyên nhân.",
};
function describe(m: ReturnType<typeof metrics>) {
  return `${m.clicks} clicks / ${m.impressions} impressions; CTR ${m.ctr === null ? "n/a" : (m.ctr * 100).toFixed(2) + "%"}; position ${m.position === null ? "n/a" : m.position.toFixed(2)}`;
}
export function synthesize(
  source: {
    dataset_sha256: string;
    facts_sha256: string;
    provenance: { kind: "GSC_API" | "HTTP_STUB" | "IMPORT" };
    facts: FactBundle;
  },
  sourceHash: string,
  review: unknown,
) {
  const validated = validateAdvice(
    review,
    source.facts,
    sourceHash,
    source.facts_sha256,
    true,
  );
  return SeoBoard.parse({
    summary:
      "Bảng việc SEO dựa trên các dòng dữ liệu đã thu thập. Mọi giá trị định lượng do code tính, AI chỉ chọn hành động theo fact ID.",
    source_sha256: sourceHash,
    facts_sha256: source.facts_sha256,
    dataset_sha256: source.dataset_sha256,
    source_kind: source.provenance.kind,
    metrics: source.facts.totals,
    previous_metrics: source.facts.previous_totals,
    warnings: source.facts.warnings,
    items: validated.items.map((i, n) => {
      const f = source.facts.facts.find((x) => x.id === i.fact_id)!;
      return {
        id: "SEO-" + String(n + 1).padStart(2, "0"),
        fact_id: f.id,
        title: titles[i.action],
        url: f.page,
        priority: i.priority,
        reason: reasons[i.reason],
        evidence: `${f.id}; query ${JSON.stringify(f.query)}; dòng hiện tại ${f.current_present ? "có" : "không được trả về"}, kỳ trước ${f.previous_present ? "có" : "không được trả về"}; hiện tại ${describe(f.current)}${f.previous ? "; kỳ trước " + describe(f.previous) : ""}; dataset ${source.dataset_sha256}`,
        acceptance:
          "Đối chiếu GSC cùng kỳ/bộ lọc và kiểm tra trang trước khi thay đổi; ORBIT chưa chỉnh hoặc xuất bản website.",
        metrics: f.current,
        previous_metrics: f.previous,
      };
    }),
  });
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function boardCsv(board: ReturnType<typeof synthesize>) {
  const rows = [
    [
      "id",
      "fact_id",
      "title",
      "url",
      "priority",
      "clicks",
      "impressions",
      "ctr",
      "position",
      "previous_clicks",
      "evidence",
      "acceptance",
    ],
    ...board.items.map((i) => [
      i.id,
      i.fact_id,
      i.title,
      i.url,
      i.priority,
      i.metrics.clicks,
      i.metrics.impressions,
      i.metrics.ctr,
      i.metrics.position,
      i.previous_metrics?.clicks,
      i.evidence,
      i.acceptance,
    ]),
  ];
  return (
    "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"
  );
}
