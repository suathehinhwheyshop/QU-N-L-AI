"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Plan } from "@orbit/shared/contracts";
import type { SearchSpec, FactBundle } from "@orbit/shared/seo";
type Status = {
  configured: boolean;
  status: string;
  kind: string;
  properties: { siteUrl: string; permissionLevel: string }[];
  expires_at?: string;
  error_code?: string;
};
type Data = {
  id: string;
  name: string;
  kind: string;
  sha256: string;
  row_count: number;
  previous_row_count: number;
  warnings: string[];
  spec: SearchSpec;
};
type Job = {
  id: string;
  run_id: string;
  status: string;
  error_code: string | null;
  dataset_id: string | null;
};
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch("/api/" + path, init);
  const d = await r.json();
  if (!r.ok) throw Error(d.message ?? d.code ?? "Không hoàn tất yêu cầu");
  return d;
}
const post = (data: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});
const day = (days: number) =>
  new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const number = (v: number | null, percent = false) =>
  v === null
    ? "—"
    : (percent ? v * 100 : v).toLocaleString("vi-VN", {
        maximumFractionDigits: 2,
      }) + (percent ? "%" : "");
export default function SeoWorkspace({
  workspaceId,
  onRun,
}: {
  workspaceId: string;
  onRun: (id: string) => void;
}) {
  const [status, setStatus] = useState<Status>(),
    [data, setData] = useState<Data[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [selected, setSelected] = useState(""),
    [insights, setInsights] = useState<{
      facts: FactBundle;
      spec: SearchSpec;
      provenance: { kind: string; warnings: string[] };
      sha256: string;
    }>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [spec, setSpec] = useState<SearchSpec>({
    property: "sc-domain:wheyshop.vn",
    current: { start: day(31), end: day(4) },
    search_type: "web",
    country: "all",
    device: "all",
  });
  const [compare, setCompare] = useState(false),
    [previous, setPrevious] = useState({ start: day(59), end: day(32) }),
    [preview, setPreview] = useState<{
      goal: Record<string, unknown>;
      plan: Plan;
    }>();
  const importKey = useRef("");
  if (!importKey.current) importKey.current = crypto.randomUUID();
  const refresh = useCallback(async () => {
    const [s, d, j] = await Promise.all([
      api<Status>("gsc/status"),
      api<Data[]>("gsc/datasets"),
      api<Job[]>("gsc/jobs"),
    ]);
    setStatus(s);
    setData(d);
    setJobs(j);
  }, []);
  useEffect(() => {
    let off = false;
    const load = async () => {
      try {
        const [s, d, j] = await Promise.all([
          api<Status>("gsc/status"),
          api<Data[]>("gsc/datasets"),
          api<Job[]>("gsc/jobs"),
        ]);
        if (!off) {
          setStatus(s);
          setData(d);
          setJobs(j);
        }
      } catch (e) {
        if (!off) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      off = true;
      clearInterval(timer);
    };
  }, []);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const specification = () => ({ ...spec, ...(compare ? { previous } : {}) });
  async function select(id: string) {
    setSelected(id);
    setPreview(undefined);
    setInsights(undefined);
    setInsights(await api("gsc/datasets/" + id));
  }
  useEffect(() => {
    if (!selected && data[0])
      void select(data[0].id).catch((e) => setError(e.message));
  }, [data, selected]);
  const oauthMessage =
    typeof window !== "undefined"
      ? new URLSearchParams(location.search).get("gsc")
      : null;
  return (
    <div className="seo-workspace" data-testid="seo-workspace">
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="inline-note">
          {notice}
        </p>
      )}
      {oauthMessage && (
        <p className="inline-note">
          Kết quả OAuth: {oauthMessage}. Khám phá property để kiểm chứng quyền
          đọc.
        </p>
      )}
      <section className="panel seo-panel">
        <div className="panel-header">
          <h2>Google Search Console · chỉ đọc</h2>
          <span className="pill">
            {status?.status ?? "Đang đọc trạng thái"}
          </span>
        </div>
        <div className="panel-body">
          <p>
            GSC: {status?.kind ?? "UNVERIFIED"} · AI LIVE được nghiệm thu riêng.
            Không sửa hoặc xuất bản website.
          </p>
          {!status?.configured && (
            <p className="inline-note">
              Chưa có OAuth client hoặc token encryption key phía server. Anh
              vẫn có thể import CSV/JSON. Không nhập secrets vào giao diện.
            </p>
          )}
          <div className="seo-actions">
            <button
              className="button primary"
              disabled={busy || !status?.configured}
              onClick={() =>
                void act(async () => {
                  const r = await api<{ url: string }>(
                    "gsc/oauth/start",
                    post({}),
                  );
                  location.assign(r.url);
                })
              }
            >
              Kết nối Google read-only
            </button>
            <button
              className="button secondary"
              disabled={
                busy ||
                !status ||
                !["AUTHORIZED", "CONNECTED", "HTTP_STUB"].includes(
                  status.status,
                )
              }
              onClick={() =>
                void act(async () => {
                  await api("gsc/properties", post({}));
                  setNotice("Đã đọc property từ connector.");
                })
              }
            >
              Khám phá property
            </button>
            <button
              className="button secondary"
              disabled={
                busy ||
                !status ||
                !["AUTHORIZED", "CONNECTED", "HTTP_STUB"].includes(
                  status.status,
                )
              }
              onClick={() =>
                void act(async () => {
                  await api("gsc/refresh", post({}));
                  setNotice("Token đã được refresh phía server.");
                })
              }
            >
              Refresh token
            </button>
            <button
              className="button secondary"
              disabled={
                busy ||
                !status ||
                ["DISCONNECTED", "REVOKED"].includes(status.status)
              }
              onClick={() => {
                if (
                  confirm(
                    "Thu hồi quyền GSC và ngừng đọc dữ liệu cho các job tiếp theo?",
                  )
                )
                  void act(async () => {
                    await api("gsc/revoke", post({}));
                    setNotice("Đã thu hồi quyền Google.");
                  });
              }}
            >
              Thu hồi quyền
            </button>
          </div>
          {status?.properties.length ? (
            <label>
              Property đã xác minh
              <select
                aria-label="Property đã xác minh"
                value={
                  status.properties.some((p) => p.siteUrl === spec.property)
                    ? spec.property
                    : ""
                }
                onChange={(e) => {
                  setSpec({ ...spec, property: e.target.value });
                  importKey.current = crypto.randomUUID();
                }}
              >
                <option value="" disabled>
                  Chọn property
                </option>
                {status.properties.map((p) => (
                  <option key={p.siteUrl} value={p.siteUrl}>
                    {p.siteUrl} · {p.permissionLevel}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </section>
      <section className="panel seo-panel">
        <div className="panel-header">
          <h2>Nguồn dữ liệu và kỳ so sánh</h2>
          <a className="button secondary" href="/api/gsc/template">
            Mẫu CSV
          </a>
        </div>
        <form
          className="panel-body"
          data-testid="seo-import"
          onChange={() => {
            importKey.current = crypto.randomUUID();
          }}
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const files = new FormData(form);
            files.set("spec", JSON.stringify(specification()));
            files.set("request_key", importKey.current);
            void act(async () => {
              const d = await api<Data>("gsc/import", {
                method: "POST",
                body: files,
              });
              await select(d.id);
              setNotice(
                "Đã lưu dataset IMPORT có checksum. Đây chưa phải bằng chứng GSC API.",
              );
            });
          }}
        >
          <label>
            Property (URL-prefix hoặc sc-domain)
            <input
              name="property"
              required
              value={spec.property}
              onChange={(e) => setSpec({ ...spec, property: e.target.value })}
            />
          </label>
          <div className="field-grid">
            <label>
              Từ ngày
              <input
                type="date"
                name="current_start"
                required
                value={spec.current.start}
                onChange={(e) =>
                  setSpec({
                    ...spec,
                    current: { ...spec.current, start: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Đến ngày
              <input
                type="date"
                name="current_end"
                required
                value={spec.current.end}
                onChange={(e) =>
                  setSpec({
                    ...spec,
                    current: { ...spec.current, end: e.target.value },
                  })
                }
              />
            </label>
          </div>
          <label className="checkbox-label">
            <input
              name="compare"
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            So sánh kỳ trước cùng độ dài
          </label>
          {compare && (
            <div className="field-grid">
              <label>
                Kỳ trước bắt đầu
                <input
                  type="date"
                  name="previous_start"
                  required
                  value={previous.start}
                  onChange={(e) =>
                    setPrevious({ ...previous, start: e.target.value })
                  }
                />
              </label>
              <label>
                Kỳ trước kết thúc
                <input
                  type="date"
                  name="previous_end"
                  required
                  value={previous.end}
                  onChange={(e) =>
                    setPrevious({ ...previous, end: e.target.value })
                  }
                />
              </label>
            </div>
          )}
          <div className="field-grid">
            <label>
              Search type
              <select
                value={spec.search_type}
                onChange={(e) =>
                  setSpec({
                    ...spec,
                    search_type: e.target.value as SearchSpec["search_type"],
                  })
                }
              >
                {["web", "image", "video", "news"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Device
              <select
                value={spec.device}
                onChange={(e) =>
                  setSpec({
                    ...spec,
                    device: e.target.value as SearchSpec["device"],
                  })
                }
              >
                {["all", "desktop", "mobile", "tablet"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Country (all hoặc mã 3 chữ)
            <input
              value={spec.country}
              pattern="all|[a-z]{3}"
              required
              onChange={(e) => setSpec({ ...spec, country: e.target.value })}
            />
          </label>
          <p className="muted">
            CSV: period,page,query,clicks,impressions,position. period là
            current/previous. JSON: {"{current: [...], previous: [...]}"} với
            cùng tên trường; tối đa 5 MB. Ngày GSC theo America/Los_Angeles.
          </p>
          <input
            aria-label="File dữ liệu SEO"
            type="file"
            name="file"
            accept=".csv,.json"
            required
          />
          <div className="seo-actions">
            <button className="button primary" type="submit" disabled={busy}>
              Import dataset
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={
                busy ||
                !status?.properties.some((p) => p.siteUrl === spec.property)
              }
              onClick={() =>
                void act(async () => {
                  const r = await api<{ run_id: string }>(
                    "gsc/sync",
                    post({
                      spec: specification(),
                      request_key: crypto.randomUUID(),
                    }),
                  );
                  setNotice("Job lấy dữ liệu đã vào queue; không gọi AI.");
                  onRun(r.run_id);
                })
              }
            >
              Lấy dữ liệu GSC qua worker
            </button>
          </div>
        </form>
      </section>
      <section className="panel seo-panel">
        <div className="panel-header">
          <h2>Datasets và lịch sử lấy dữ liệu</h2>
        </div>
        <div className="panel-body seo-datasets">
          {!data.length && (
            <p>Chưa có dataset. Import file hoặc kết nối GSC để bắt đầu.</p>
          )}
          {data.map((d) => (
            <button
              key={d.id}
              className={"seo-dataset " + (selected === d.id ? "selected" : "")}
              disabled={busy}
              onClick={() => void act(() => select(d.id))}
            >
              <strong>{d.name}</strong>
              <span>
                {d.kind} · {d.row_count} dòng hiện tại / {d.previous_row_count}{" "}
                kỳ trước
              </span>
              <code>{d.sha256}</code>
            </button>
          ))}
          {jobs.map((j) => (
            <div className="seo-job" key={j.id}>
              <span>
                {j.status ?? "Đang lưu job"} {j.error_code ?? ""}
              </span>
              <button
                className="button secondary"
                onClick={() => onRun(j.run_id)}
                disabled={!j.run_id}
              >
                Xem execution
              </button>
            </div>
          ))}
        </div>
      </section>
      {insights && (
        <section className="panel seo-panel" data-testid="seo-insights">
          <div className="panel-header">
            <h2>Insights định lượng · tính bằng code</h2>
            <span className="pill">{insights.provenance.kind}</span>
          </div>
          <div className="panel-body">
            <p className="mono">Dataset SHA256 {insights.sha256}</p>
            <p>
              Dữ liệu đã lưu: {insights.spec.property} ·{" "}
              {insights.spec.current.start} → {insights.spec.current.end}
              {insights.spec.previous
                ? ` · kỳ trước ${insights.spec.previous.start} → ${insights.spec.previous.end}`
                : ""}
              . Filters: {insights.spec.search_type} / {insights.spec.country} /{" "}
              {insights.spec.device}.
            </p>
            <p>
              Chỉ số của các dòng đã thu thập trong dataset; phạm vi có thể
              thiếu truy vấn ẩn hoặc dòng ngoài giới hạn API.
            </p>
            <div className="seo-metrics">
              {Object.entries(insights.facts.totals).map(([k, v]) => (
                <div key={k}>
                  <strong>{number(v, k === "ctr")}</strong>
                  <span>{k}</span>
                </div>
              ))}
            </div>
            {insights.facts.previous_totals && (
              <p>
                Kỳ trước: {number(insights.facts.previous_totals.clicks)} clicks
                / {number(insights.facts.previous_totals.impressions)}{" "}
                impressions; CTR{" "}
                {number(insights.facts.previous_totals.ctr, true)}.
              </p>
            )}
            <ul>
              {insights.facts.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Evidence</th>
                    <th>Page / query</th>
                    <th>Clicks</th>
                    <th>Impressions</th>
                    <th>CTR</th>
                    <th>Δ clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.facts.facts.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <code>{f.id}</code>
                      </td>
                      <td>
                        {f.page}
                        <br />
                        {f.query}
                      </td>
                      <td>{f.current.clicks}</td>
                      <td>{f.current.impressions}</td>
                      <td>{number(f.current.ctr, true)}</td>
                      <td>{f.click_delta ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form
              data-testid="seo-execute"
              onChange={() => setPreview(undefined)}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const goal = {
                  goal: String(f.get("goal")),
                  workspace_id: workspaceId,
                  seo_dataset_id: selected,
                  mode: String(f.get("mode")),
                  budget_cents: Number(f.get("budget")),
                  live_data_consent: f.get("consent") === "on",
                  planning_strategy: "TEMPLATE",
                  request_key: crypto.randomUUID(),
                };
                void act(async () => {
                  const plan = await api<Plan>("plans", post(goal));
                  setPreview({ goal, plan });
                });
              }}
            >
              <label>
                Mục tiêu SEO
                <textarea
                  name="goal"
                  required
                  minLength={10}
                  maxLength={5000}
                  defaultValue="Phân tích hiệu suất SEO, kiểm chứng bằng chứng và tạo bảng công việc tối ưu."
                />
              </label>
              <div className="field-grid">
                <label>
                  Thực thi AI
                  <select name="mode">
                    <option value="MOCK">MOCK · không gọi AI thật</option>
                    <option value="LIVE">
                      LIVE · cần hai provider đã kiểm chứng
                    </option>
                  </select>
                </label>
                <label>
                  Ngân sách USD cents
                  <input
                    name="budget"
                    type="number"
                    min={0}
                    max={100000}
                    defaultValue={0}
                    required
                  />
                </label>
              </div>
              <label className="checkbox-label">
                <input name="consent" type="checkbox" />
                Cho phép gửi facts/query/URL tới AI đã kiểm chứng cho lượt này;
                áp dụng quyền và hạn mức của phương thức kết nối.
              </label>
              <button
                className="button secondary"
                disabled={busy}
                type="submit"
              >
                Xem kế hoạch SEO
              </button>
            </form>
            {preview && (
              <div className="seo-preview">
                <p>
                  {preview.plan.nodes.length} bước · AI{" "}
                  {preview.goal.mode as string} · Ước tính reservation:{" "}
                  {preview.plan.estimate.cost_cents} cents.
                </p>
                <ol>
                  {preview.plan.nodes.map((n) => (
                    <li key={n.key}>{n.title}</li>
                  ))}
                </ol>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const r = await api<{ id: string }>(
                        "runs",
                        post(preview.goal),
                      );
                      onRun(r.id);
                    })
                  }
                >
                  Khởi chạy SEO {preview.goal.mode as string}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
