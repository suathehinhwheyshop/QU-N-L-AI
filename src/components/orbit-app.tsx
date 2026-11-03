"use client";
import SeoWorkspace from "./seo-workspace";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  LayoutDashboard,
  Workflow,
  ListTodo,
  Plug,
  Files,
  Settings,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Play,
  Pause,
  RotateCcw,
  Square,
  Check,
  Clock,
  ShieldCheck,
  Download,
  ChevronRight,
  Search,
  Activity,
  CheckCircle2,
  AlertCircle,
  LogOut,
  Upload,
  X,
  Database,
  Layers,
  FileText,
} from "lucide-react";
import type {
  Bootstrap,
  Detail,
  TaskRow,
  FileRow,
  SettingsRow,
  ConnectionRow,
} from "@/core/dto";
import type { Plan } from "@/core/contracts";
import type { z } from "zod";
import type { Board } from "@/core/contracts";
type View =
  | "seo"
  | "dashboard"
  | "new"
  | "workflows"
  | "detail"
  | "tasks"
  | "connections"
  | "artifacts"
  | "settings";
const navigation = [
  ["seo", "SEO", Database],
  ["dashboard", "Tổng quan", LayoutDashboard],
  ["workflows", "Workflow", Workflow],
  ["tasks", "Bảng việc", ListTodo],
  ["connections", "Kết nối", Plug],
  ["artifacts", "Artifacts", Files],
  ["settings", "Cài đặt", Settings],
] as const;
const titles: Record<View, [string, string]> = {
  seo: [
    "SEO có dữ liệu. Kết quả có bằng chứng.",
    "GSC / import → phân tích → kiểm chứng → duyệt → MD / CSV / JSON.",
  ],
  dashboard: [
    "Mọi AI. Một không gian.",
    "Một mục tiêu, nhiều công cụ. Anh luôn nắm quyền điều phối.",
  ],
  new: [
    "Anh muốn hoàn thành điều gì?",
    "Giao mục tiêu, xem kế hoạch và khởi chạy đúng phạm vi.",
  ],
  workflows: [
    "Từ mục tiêu đến kết quả.",
    "Workflow và checkpoint được lưu trong PostgreSQL.",
  ],
  detail: [
    "Một mục tiêu. Trọn quy trình.",
    "Theo dõi từng bước, bằng chứng và lần thực thi.",
  ],
  tasks: [
    "Rõ từng việc. Đúng thứ tự.",
    "Dependencies, người thực hiện và tiêu chí hoàn thành.",
  ],
  connections: [
    "Đúng năng lực. Đúng công cụ.",
    "Chỉ kết nối đã kiểm chứng mới được đánh dấu CONNECTED.",
  ],
  artifacts: [
    "Kết quả có nguồn gốc.",
    "File thật, checksum, phiên bản và lịch sử bàn giao.",
  ],
  settings: [
    "Giới hạn do anh quyết định.",
    "Ngân sách, quyền thực thi và chính sách dữ liệu.",
  ],
};
const statusNames: Record<string, string> = {
  QUEUED: "Chờ worker",
  PENDING: "Chờ đầu vào",
  RUNNING: "Đang thực thi",
  WAITING_APPROVAL: "Chờ phê duyệt",
  COMPLETED: "Đã kiểm chứng",
  FAILED: "Không hoàn thành",
  CANCELED: "Đã hủy",
  PAUSED: "Đã tạm dừng",
  MOCK: "MOCK",
  DISCONNECTED: "Chưa kết nối",
};
function Status({ value }: { value: string }) {
  return (
    <span
      className={
        "pill " +
        (["COMPLETED", "MOCK", "CONNECTED"].includes(value)
          ? "green"
          : value === "RUNNING"
            ? "blue"
            : ["WAITING_APPROVAL", "PAUSED"].includes(value)
              ? "amber"
              : value === "FAILED"
                ? "red"
                : "")
      }
    >
      {statusNames[value] || value}
    </span>
  );
}
const date = (s: string) =>
  new Date(s).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch("/api/" + path, { cache: "no-store", ...init });
  if (res.status === 401) {
    location.href = "/login";
    throw Error("Anh cần đăng nhập.");
  }
  const data = await res.json();
  if (!res.ok) throw Error(data.message || "Không thực hiện được yêu cầu.");
  return data;
}
const post = (data: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});
export default function OrbitApp() {
  const [data, setData] = useState<Bootstrap>(),
    [view, setView] = useState<View>("dashboard"),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Detail>(),
    [files, setFiles] = useState<FileRow[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [inspect, setInspect] = useState<TaskRow>();
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const navigate = useCallback((v: View, id?: string) => {
    location.hash = id ? "workflow/" + id : v;
  }, []);
  useEffect(() => {
    const change = () => {
      const h = location.hash.slice(1);
      if (h.startsWith("workflow/")) {
        setSelected(h.slice(9));
        setView("detail");
      } else setView(Object.hasOwn(titles, h) ? (h as View) : "dashboard");
    };
    change();
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  const refresh = useCallback(async () => {
    const d = await api<Bootstrap>("bootstrap");
    setData(d);
    if (!selectedRef.current && d.runs[0]) setSelected(d.runs[0].id);
  }, []);
  useEffect(() => {
    let off = false;
    const load = async () => {
      try {
        const d = await api<Bootstrap>("bootstrap");
        if (!off) {
          setData(d);
          if (!selectedRef.current && d.runs[0]) setSelected(d.runs[0].id);
        }
      } catch (e) {
        if (!off) setError((e as Error).message);
      }
    };
    void load();
    const t = setInterval(load, 2000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    if (!selected) return;
    let off = false;
    setDetail(undefined);
    const load = async () => {
      try {
        const d = await api<Detail>("runs/" + selected);
        if (!off) setDetail(d);
      } catch (e) {
        if (!off) setError((e as Error).message);
      }
    };
    void load();
    const t = setInterval(load, 1200);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [selected]);
  useEffect(() => {
    if (view === "artifacts")
      api<FileRow[]>("artifacts")
        .then(setFiles)
        .catch((e) => setError(e.message));
  }, [view]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  const mutate = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      if (selected) setDetail(await api<Detail>("runs/" + selected));
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const control = (action: string) =>
    mutate(
      () => api("runs/" + selected + "/" + action, post({})),
      "Yêu cầu đã lưu trên server.",
    );
  if (!data)
    return (
      <div className="loading">
        <div className="brand">◉ orbit</div>
        <p>{error || "Đang đọc không gian làm việc…"}</p>
      </div>
    );
  const [title, description] = titles[view];
  const selectRun = (
    <select
      aria-label="Chọn workflow"
      className="compact-select"
      value={selected}
      onChange={(e) => setSelected(e.target.value)}
    >
      {data.runs.map((r) => (
        <option key={r.id} value={r.id}>
          {r.goal.slice(0, 55)} · {r.id.slice(0, 6)}
        </option>
      ))}
    </select>
  );
  const board = detail?.tasks.find((t) => t.key === "board")?.output as
    z.infer<typeof Board> | undefined;
  return (
    <>
      <aside className="sidebar">
        <a className="brand" href="#dashboard">
          <span>◉</span>orbit <small>FOUNDATION</small>
        </a>
        <div className="workspace-box">
          <span className="workspace-icon">W</span>
          <div>
            <strong>Không gian của anh</strong>
            <small>4 workspace · riêng tư</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <div className="nav-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav>
          {navigation.map(([key, label, Icon]) => (
            <a
              key={key}
              href={"#" + key}
              className={
                "nav-link " +
                (view === key || (view === "detail" && key === "workflows")
                  ? "active"
                  : "")
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="foundation-note">
            <span className="status-dot" /> Engine bền vững · Read-only
            <p>
              PostgreSQL + worker độc lập.
              <br />
              MVP chỉ đọc và tạo báo cáo.
            </p>
          </div>
          <div className="account">
            <span className="avatar">DN</span>
            <div>
              <strong>Dũng Nguyễn</strong>
              <small>Development account</small>
            </div>
            <button
              title="Đăng xuất"
              aria-label="Đăng xuất"
              onClick={() =>
                void mutate(async () => {
                  await api("auth/logout", post({}));
                  location.href = "/login";
                }, "")
              }
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      <div className="shell">
        <header className="topbar">
          <div>
            Không gian cá nhân <span>/</span>{" "}
            <strong>
              {view === "detail"
                ? "Workflow Detail"
                : navigation.find((n) => n[0] === view)?.[1] || "Mục tiêu mới"}
            </strong>
          </div>
          <div className="top-right">
            <span className="version-label">ORBIT · READ-ONLY</span>
            <span className="avatar">DN</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">ORBIT / UNIVERSAL AI WORKSPACE</div>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
            {view !== "new" && (
              <button
                className="button primary"
                onClick={() => navigate("new")}
              >
                <Plus size={16} /> Giao mục tiêu mới
              </button>
            )}
          </div>
          <div className="mode-banner">
            <ShieldCheck size={18} />
            <p>
              <strong>Phân biệt bằng chứng thực thi.</strong> MOCK và HTTP_STUB
              không phải LIVE. Chỉ probe inference API thật mới xác nhận kết
              nối. GSC API cần OAuth được xác minh riêng; không sửa website.
            </p>
            <a href="#connections">
              Trạng thái kết nối <ArrowUpRight size={12} />
            </a>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={16} />
              {error}
              <button
                aria-label="Đóng thông báo lỗi"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === "dashboard" && (
            <>
              <div className="stats">
                {[
                  [
                    Workflow,
                    "Workflow đang chạy",
                    data.runs.filter((r) =>
                      ["RUNNING", "QUEUED"].includes(r.status),
                    ).length,
                    "Từ hàng đợi bền vững",
                  ],
                  [
                    CheckCircle2,
                    "Tác vụ hoàn thành",
                    data.stats.completed_tasks,
                    "Output đã kiểm tra schema",
                  ],
                  [
                    Clock,
                    "Chờ phê duyệt",
                    data.stats.waiting_approvals,
                    "Quyết định thuộc về anh",
                  ],
                  [
                    Plug,
                    "AI thật đã kết nối",
                    data.connections.filter(
                      (c) =>
                        c.status === "CONNECTED" && c.metadata.kind !== "tool",
                    ).length,
                    `${data.connections.filter((c) => c.mode === "MOCK" && c.metadata.kind === "provider").length} adapter MOCK để kiểm thử`,
                  ],
                ].map(([Icon, label, value, caption], i) => {
                  const I = Icon as typeof Workflow;
                  return (
                    <div className="stat panel" key={i}>
                      <div className="stat-label">
                        <span>{String(label)}</span>
                        <I size={17} />
                      </div>
                      <div className="stat-value">{String(value)}</div>
                      <small>{String(caption)}</small>
                    </div>
                  );
                })}
              </div>
              <div className="section-title">
                <h2>Đội ngũ AI & công cụ</h2>
                <a href="#connections">Quản lý kết nối →</a>
              </div>
              <div className="provider-strip">
                {data.connections
                  .filter((c) => c.metadata.kind !== "tool")
                  .map((c) => (
                    <div className="provider-mini panel" key={c.id}>
                      <span
                        className={
                          "provider-icon " +
                          (c.id === "anthropic" ? "terra" : "")
                        }
                      >
                        {c.mode === "MOCK" ? "◇" : c.name[0]}
                      </span>
                      <strong>{c.name}</strong>
                      <Status value={c.status} />
                    </div>
                  ))}
              </div>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <h2>Workflow gần nhất</h2>
                      <small>Mục tiêu, trạng thái và phiên bản thực thi</small>
                    </div>
                    <a href="#workflows">Xem tất cả →</a>
                  </div>
                  {data.runs.length ? (
                    <div className="run-list">
                      {data.runs.slice(0, 5).map((r) => (
                        <button
                          key={r.id}
                          className="run-row"
                          onClick={() => navigate("detail", r.id)}
                        >
                          <span className="row-icon">
                            <Workflow size={19} />
                          </span>
                          <span className="row-copy">
                            <strong>{r.goal}</strong>
                            <small>
                              {r.mode} · {date(r.created_at)} ·{" "}
                              {r.id.slice(0, 8)}
                            </small>
                          </span>
                          <Status value={r.status} />
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Sẵn sàng cho mục tiêu đầu tiên"
                      text="Tạo workflow SEO để thử luồng hai AI và phê duyệt trước khi bàn giao."
                      action={
                        <button
                          className="button secondary"
                          onClick={() => navigate("new")}
                        >
                          Tạo mục tiêu →
                        </button>
                      }
                    />
                  )}
                </section>
                <section className="panel">
                  <div className="panel-header">
                    <h2>Lịch sử hoạt động</h2>
                    <Activity size={16} />
                  </div>
                  <div className="activity-list">
                    {data.activity.length ? (
                      data.activity.map((e) => (
                        <div className="activity" key={e.id}>
                          <small>{date(e.created_at)}</small>
                          <p>{e.message}</p>
                        </div>
                      ))
                    ) : (
                      <p className="muted">
                        Chưa có hoạt động. Nhật ký sẽ ghi lại mỗi checkpoint.
                      </p>
                    )}
                  </div>
                </section>
              </div>
              <div className="workspace-strip">
                {data.workspaces.map((w) => (
                  <div className="panel workspace-card" key={w.id}>
                    <Layers size={20} />
                    <h3>{w.name}</h3>
                    <p>
                      {w.kind === "seo"
                        ? "GSC → phân tích → phản biện → phê duyệt → báo cáo"
                        : "Template báo cáo dùng chung; chưa tích hợp công cụ chuyên ngành."}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
          {view === "seo" && (
            <SeoWorkspace
              workspaceId={data.workspaces.find((w) => w.kind === "seo")!.id}
              onRun={(id) => navigate("detail", id)}
            />
          )}
          {view === "new" && (
            <NewGoal
              data={data}
              onError={setError}
              onCreated={(id) => {
                void refresh();
                navigate("detail", id);
              }}
            />
          )}
          {view === "workflows" && (
            <section className="panel">
              <div className="panel-header">
                <h2>Tất cả workflow</h2>
                <span className="muted">{data.runs.length} lượt gần nhất</span>
              </div>
              {data.runs.length ? (
                data.runs.map((r) => (
                  <button
                    className="run-row"
                    key={r.id}
                    onClick={() => navigate("detail", r.id)}
                  >
                    <span className="row-icon">
                      <Workflow size={20} />
                    </span>
                    <span className="row-copy">
                      <strong>{r.goal}</strong>
                      <small>
                        {r.mode} · {date(r.created_at)} · $
                        {Number(r.spent_cents / 100).toFixed(2)}
                      </small>
                    </span>
                    <Status value={r.status} />
                    <ChevronRight size={16} />
                  </button>
                ))
              ) : (
                <Empty
                  title="Chưa có workflow"
                  text="Giao một mục tiêu để bắt đầu."
                />
              )}
            </section>
          )}
          {view === "detail" &&
            (!detail ? (
              <Empty
                title="Đang tải workflow"
                text="Đọc checkpoint từ PostgreSQL…"
              />
            ) : (
              <>
                <section className="panel run-hero">
                  <div className="run-meta">
                    <span className="mono">
                      RUN {detail.run.id.slice(0, 8)}
                    </span>
                    <Status value={detail.run.status} />
                  </div>
                  <h2>{detail.run.goal}</h2>
                  <p>
                    MODE {detail.run.mode} · {date(detail.run.created_at)} · Chi
                    phí ghi nhận ${(detail.run.spent_cents / 100).toFixed(2)} /
                    ${(detail.run.budget_cents / 100).toFixed(2)}
                  </p>
                  <div className="action-row">
                    {["RUNNING", "QUEUED", "WAITING_APPROVAL"].includes(
                      detail.run.status,
                    ) && (
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() => void control("pause")}
                      >
                        <Pause size={14} /> Tạm dừng
                      </button>
                    )}
                    {detail.run.status === "PAUSED" && (
                      <button
                        disabled={busy}
                        className="button primary"
                        onClick={() => void control("resume")}
                      >
                        <Play size={14} /> Tiếp tục
                      </button>
                    )}
                    {detail.run.status === "FAILED" &&
                      detail.tasks.some(
                        (t) =>
                          t.status === "FAILED" &&
                          t.attempt_count < t.max_attempts,
                      ) && (
                        <button
                          disabled={busy}
                          className="button secondary"
                          onClick={() => void control("retry")}
                        >
                          <RotateCcw size={14} /> Thử lại
                        </button>
                      )}
                    {!["COMPLETED", "CANCELED"].includes(detail.run.status) && (
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() => {
                          if (
                            confirm(
                              "Hủy workflow này? Các bước tiếp theo sẽ không được thực hiện.",
                            )
                          )
                            void control("cancel");
                        }}
                      >
                        <Square size={13} /> Hủy workflow
                      </button>
                    )}
                    <span className="muted">
                      Pause ngừng nhận bước mới; bước đang chạy có thể hoàn tất
                      checkpoint.
                    </span>
                  </div>
                </section>
                {detail.approvals
                  .filter((a) => a.status === "PENDING")
                  .map((a) => (
                    <section className="approval-card" key={a.id}>
                      <ShieldCheck size={25} />
                      <div>
                        <h3>Bảng công việc đang chờ anh duyệt</h3>
                        <p>
                          Xem bảng việc và đầu ra trước khi cho phép tạo báo
                          cáo. Không có quyền sửa website.
                        </p>
                        <small className="mono">
                          SHA256 {a.output_hash.slice(0, 24)}…
                        </small>
                      </div>
                      <div className="action-row">
                        <button
                          disabled={
                            busy || detail.run.status !== "WAITING_APPROVAL"
                          }
                          className="button secondary"
                          onClick={() =>
                            void mutate(
                              () =>
                                api(
                                  "approvals/" + a.id,
                                  post({
                                    decision: "reject",
                                    output_hash: a.output_hash,
                                  }),
                                ),
                              "Đã từ chối. Workflow không xuất báo cáo.",
                            )
                          }
                        >
                          Từ chối
                        </button>
                        <button
                          disabled={
                            busy || detail.run.status !== "WAITING_APPROVAL"
                          }
                          className="button primary"
                          onClick={() =>
                            void mutate(
                              () =>
                                api(
                                  "approvals/" + a.id,
                                  post({
                                    decision: "approve",
                                    output_hash: a.output_hash,
                                  }),
                                ),
                              "Đã phê duyệt đúng phiên bản.",
                            )
                          }
                        >
                          Phê duyệt báo cáo <Check size={14} />
                        </button>
                      </div>
                    </section>
                  ))}
                <div className="section-title">
                  <h2>Sơ đồ tác vụ & dependencies</h2>
                  <span className="muted">
                    {
                      detail.tasks.filter((t) => t.status === "COMPLETED")
                        .length
                    }
                    /{detail.tasks.length} bước đã kiểm chứng
                  </span>
                </div>
                <div className="dag">
                  {[...detail.tasks]
                    .sort((a, b) => {
                      const nodes = (detail.run.plan as unknown as Plan).nodes;
                      return (
                        nodes.findIndex((n) => n.key === a.key) -
                        nodes.findIndex((n) => n.key === b.key)
                      );
                    })
                    .map((t, i) => (
                      <button
                        className="panel node-card"
                        key={t.id}
                        onClick={() => setInspect(t)}
                      >
                        <div className="node-top">
                          <span
                            className={
                              "step-index " +
                              (t.status === "COMPLETED" ? "done" : "")
                            }
                          >
                            {t.status === "COMPLETED" ? (
                              <Check size={15} />
                            ) : (
                              String(i + 1).padStart(2, "0")
                            )}
                          </span>
                          <Status value={t.status} />
                        </div>
                        <h3>{t.title}</h3>
                        <p>
                          {t.provider_id || t.kind} {t.model && "· " + t.model}
                        </p>
                        <small>
                          Phụ thuộc:{" "}
                          {detail.dependencies
                            .filter((d) => d.task_id === t.id)
                            .map(
                              (d) =>
                                detail.tasks.find(
                                  (x) => x.id === d.depends_on_id,
                                )?.key,
                            )
                            .join(", ") || "Không có"}
                        </small>
                        <span className="node-foot">
                          Attempt {t.attempt_count}/{t.max_attempts}
                          <ArrowUpRight size={13} />
                        </span>
                      </button>
                    ))}
                </div>
                <div className="dashboard-grid detail-bottom">
                  <section className="panel">
                    <div className="panel-header">
                      <h2>Input / Output & bằng chứng</h2>
                      <Files size={16} />
                    </div>
                    <div className="panel-body">
                      {board ? (
                        <>
                          <p className="muted">{board.summary}</p>
                          <button
                            className="button secondary"
                            onClick={() => navigate("tasks")}
                          >
                            Xem {board.items.length} đề xuất trong bảng việc →
                          </button>
                        </>
                      ) : (
                        <p className="muted">
                          Bảng việc xuất hiện sau khi hai adapter hoàn tất và dữ
                          liệu hợp lệ.
                        </p>
                      )}
                      <div className="file-list">
                        {detail.artifacts.map((a) => (
                          <FileLink file={a} key={a.id} />
                        ))}
                      </div>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-header">
                      <h2>Logs & checkpoint</h2>
                      <Database size={16} />
                    </div>
                    <div className="activity-list log-scroll">
                      {detail.logs
                        .slice()
                        .reverse()
                        .map((e) => (
                          <div className="activity" key={e.id}>
                            <small>
                              {date(e.created_at)} · {e.type}
                            </small>
                            <p>{e.message}</p>
                            {e.attempt_id && (
                              <code>{e.attempt_id.slice(0, 8)}</code>
                            )}
                          </div>
                        ))}
                    </div>
                  </section>
                </div>
              </>
            ))}
          {view === "tasks" && (
            <>
              <div className="section-title">
                <h2>Tác vụ điều phối</h2>
                {selectRun}
              </div>
              {detail ? (
                <TaskBoard detail={detail} onInspect={setInspect} />
              ) : (
                <Empty
                  title="Chưa có tác vụ"
                  text="Tạo workflow để hình thành DAG và danh sách việc."
                />
              )}
              {board && (
                <section className="panel proposal-panel">
                  <div className="panel-header">
                    <h2>Đề xuất từ phân tích & phản biện</h2>
                    <span className="pill amber">
                      Chỉ lập kế hoạch · chưa sửa web
                    </span>
                  </div>
                  {board.items.map((item) => (
                    <article className="proposal" key={item.id}>
                      <div className="section-title">
                        <h3>{item.title}</h3>
                        <span className="pill">{item.priority}</span>
                      </div>
                      <p className="mono">{item.url}</p>
                      <p>
                        <strong>Lý do:</strong> {item.reason}
                      </p>
                      <p>
                        <strong>Evidence:</strong> {item.evidence}
                      </p>
                      <p>
                        <strong>Acceptance:</strong> {item.acceptance}
                      </p>
                    </article>
                  ))}
                </section>
              )}
            </>
          )}
          {view === "connections" && (
            <>
              <div className="connection-grid">
                {data.connections.map((c) => (
                  <section className="panel connection-card" key={c.id}>
                    <div className="connection-heading">
                      <span className="provider-icon">
                        {c.mode === "MOCK" ? "◇" : c.name[0]}
                      </span>
                      <Status value={c.status} />
                    </div>
                    <h2>{c.name}</h2>
                    <p>
                      {c.mode === "MOCK"
                        ? "Adapter fixture để kiểm thử orchestration. Không gửi dữ liệu ra ngoài."
                        : c.metadata.kind === "provider"
                          ? "Adapter API đã có code. Chưa xác minh LIVE nếu thiếu key/model/probe thật."
                          : "GSC OAuth read-only. Mở SEO Workspace để quản lý quyền, property và datasets."}
                    </p>
                    <div className="metadata-row">
                      <span>Capabilities</span>
                      <strong>
                        {c.capabilities.join(", ") || "Chưa xác minh"}
                      </strong>
                    </div>
                    <div className="metadata-row">
                      <span>Models</span>
                      <strong>{c.models.join(", ") || "Chưa cấu hình"}</strong>
                    </div>
                    <div className="metadata-row">
                      <span>Quyền</span>
                      <strong>
                        {c.mode === "MOCK"
                          ? "Local-only · không thao tác website"
                          : "Chưa cấp quyền"}
                      </strong>
                    </div>
                    <small>
                      {c.checked_at
                        ? "Kiểm tra " +
                          date(c.checked_at) +
                          " · " +
                          c.health_code
                        : "Chưa test connection"}
                    </small>
                    {c.mode === "MOCK" && c.metadata.kind === "provider" && (
                      <ProviderConfig
                        key={
                          c.id +
                          String(c.metadata.enabled) +
                          String(c.metadata.selected_model)
                        }
                        connection={c}
                        busy={busy}
                        save={(config) =>
                          mutate(
                            () =>
                              api("connections/" + c.id + "/config", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(config),
                              }),
                            "Đã lưu model configuration. Router sẽ dùng cấu hình này cho task mới.",
                          )
                        }
                      />
                    )}
                    {c.mode === "LIVE" && c.metadata.kind === "provider" && (
                      <LiveProviderConfig
                        connection={c}
                        busy={busy}
                        save={(config) =>
                          mutate(
                            () =>
                              api("connections/" + c.id + "/config", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(config),
                              }),
                            "Đã lưu cấu hình LIVE; cần probe API thật trước khi router sử dụng.",
                          )
                        }
                        probe={() =>
                          mutate(
                            () =>
                              api(
                                "connections/" + c.id + "/test",
                                post({ consent: true }),
                              ),
                            "Đã nhận phản hồi probe. Chỉ LIVE_API hợp lệ mới được xác nhận kết nối.",
                          )
                        }
                      />
                    )}
                    {c.mode === "MOCK" ? (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          void mutate(
                            () =>
                              api("connections/" + c.id + "/test", post({})),
                            "Mock adapter đã phản hồi. Trạng thái vẫn là MOCK.",
                          )
                        }
                      >
                        Test mock adapter <ArrowUpRight size={14} />
                      </button>
                    ) : (
                      <div className="not-available">
                        {c.metadata.kind === "provider"
                          ? c.metadata.credential_present
                            ? "API code sẵn sàng; cần model/pricing và probe thật."
                            : "Thiếu API key phía server. Không nhập key vào giao diện."
                          : "Quản lý GSC tại SEO Workspace."}
                      </div>
                    )}
                  </section>
                ))}
              </div>
              <div className="inline-note">
                Router chọn theo capability, tính khả dụng, chi phí, độ trễ và
                data policy. Thuê bao chat không được coi là API credential.
                Không nhập secret vào giao diện này.
              </div>
            </>
          )}
          {view === "artifacts" && (
            <div className="artifact-grid">
              {files.length ? (
                files.map((f) => (
                  <section className="panel artifact-card" key={f.id}>
                    <div className="section-title">
                      <FileText size={23} />
                      <Status value={f.mode} />
                    </div>
                    <h3>{f.name}</h3>
                    <p>
                      Version {f.version} · {f.size_bytes} bytes
                    </p>
                    <code>SHA256 {f.sha256.slice(0, 22)}…</code>
                    <small>
                      {date(f.created_at)} · {f.source_ids.length} nguồn bàn
                      giao
                    </small>
                    <FileLink file={f} />
                  </section>
                ))
              ) : (
                <Empty
                  title="Chưa có artifact"
                  text="Output đã kiểm chứng và file đính kèm sẽ được lưu ở đây."
                />
              )}
            </div>
          )}
          {view === "settings" && (
            <SettingsPanel
              initial={data.settings}
              busy={busy}
              save={(s) =>
                mutate(
                  () =>
                    api("settings", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(s),
                    }),
                  "Đã lưu cài đặt vào PostgreSQL.",
                )
              }
            />
          )}
          <footer>
            ORBIT · Multi-AI Workspace <span>·</span> Run / Task / Attempt /
            Approval / Artifact
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {inspect && (
        <InspectTask
          task={detail?.tasks.find((t) => t.id === inspect.id) || inspect}
          detail={detail}
          onClose={() => setInspect(undefined)}
        />
      )}
    </>
  );
}
function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Workflow size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function FileLink({ file }: { file: FileRow }) {
  return (
    <a href={"/api/artifacts/" + file.id} className="file-link">
      <FileText size={16} />
      <span>
        {file.name}
        <small>
          v{file.version} · {file.mode} · checksum {file.sha256.slice(0, 10)}
        </small>
      </span>
      <Download size={15} />
    </a>
  );
}
function NewGoal({
  data,
  onError,
  onCreated,
}: {
  data: Bootstrap;
  onError: (s: string) => void;
  onCreated: (id: string) => void;
}) {
  const [plan, setPlan] = useState<Plan>(),
    [busy, setBusy] = useState(false),
    [uploads, setUploads] = useState<{ id: string; name: string }[]>([]),
    [key] = useState(() => crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);
  const previewKey = useRef("");
  const payload = () => {
    const f = new FormData(form.current!);
    return {
      goal: f.get("goal"),
      acceptance_criteria: String(f.get("acceptance_criteria") || "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
      workspace_id: f.get("workspace_id"),
      budget_cents: Number(f.get("budget_cents")),
      site: f.get("site"),
      mode: f.get("mode"),
      planning_strategy: f.get("planning_strategy"),
      live_data_consent: f.get("live_data_consent") === "on",
      scenario: f.get("scenario"),
      attachment_ids: uploads.map((f) => f.id),
      request_key: key,
    };
  };
  return (
    <div className="new-goal-grid">
      <form
        ref={form}
        className="panel goal-form"
        onChange={() => setPlan(undefined)}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          onError("");
          try {
            const request = payload();
            const result = await api<Plan>("plans", post(request));
            if (JSON.stringify(request) !== JSON.stringify(payload()))
              throw Error(
                "Yêu cầu đã thay đổi. Anh xem lại kế hoạch trước khi chạy.",
              );
            previewKey.current = JSON.stringify(request);
            setPlan(result);
          } catch (e) {
            onError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="panel-header">
          <h2>Một yêu cầu. Một kế hoạch.</h2>
          <span className="pill green">MVP READ-ONLY</span>
        </div>
        <div className="panel-body">
          <div className="field-grid">
            <div>
              <label htmlFor="execution-mode">Chế độ thực thi</label>
              <select id="execution-mode" name="mode">
                <option value="MOCK">MOCK · kiểm thử offline</option>
                <option value="LIVE">LIVE · cần 2 API đã probe thật</option>
              </select>
            </div>
            <div>
              <label htmlFor="planning-strategy">Lập kế hoạch</label>
              <select id="planning-strategy" name="planning_strategy">
                <option value="TEMPLATE">Template an toàn</option>
                <option value="AI_WITH_FALLBACK">
                  AI theo schema + fallback template
                </option>
              </select>
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" name="live_data_consent" />
            Cho phép gửi mục tiêu và output của lượt này tới các AI API đã xác
            minh (bắt buộc với LIVE).
          </label>
          <small>
            AI planning chạy thành task có budget/checkpoint sau khi khởi chạy,
            preview không gọi API tính phí. Phase 2 LIVE dùng
            Research/Video/Development; GSC thật thuộc Phase 3.
          </small>
          <label htmlFor="goal">Mục tiêu của anh</label>
          <textarea
            id="goal"
            name="goal"
            minLength={10}
            maxLength={5000}
            rows={5}
            required
            placeholder="Ví dụ: phân tích SEO từ GSC, lập kế hoạch video, nghiên cứu hoặc chia task phát triển phần mềm."
          />
          <label htmlFor="acceptance-criteria">
            Điều kiện hoàn thành bổ sung (mỗi dòng một ý)
          </label>
          <textarea
            id="acceptance-criteria"
            name="acceptance_criteria"
            rows={2}
            maxLength={4000}
            placeholder="Ví dụ: mỗi đề xuất phải có bằng chứng và tiêu chí kiểm tra."
          />
          <div className="field-grid">
            <div>
              <label htmlFor="workspace">Workspace</label>
              <select id="workspace" name="workspace_id">
                {data.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="site">Website tham chiếu</label>
              <input
                id="site"
                name="site"
                type="url"
                required
                defaultValue="https://wheyshop.vn"
              />
            </div>
          </div>
          <div className="field-grid">
            <div>
              <label htmlFor="budget">Ngân sách tối đa (USD cents)</label>
              <input
                id="budget"
                type="number"
                name="budget_cents"
                min={0}
                max={data.settings.max_budget_cents}
                defaultValue={0}
              />
              <small>
                Mock: 0 phí API. Giới hạn cài đặt:{" "}
                {data.settings.max_budget_cents} cents.
              </small>
            </div>
            <div>
              <label htmlFor="scenario">Tình huống kiểm thử adapter</label>
              <select id="scenario" name="scenario">
                <option value="normal">Thông thường</option>
                <option value="fail-once">Lỗi lần đầu → bounded retry</option>
                <option value="invalid-output">
                  Đầu ra sai schema → FAILED
                </option>
              </select>
            </div>
          </div>
          <label htmlFor="attachment">Đính kèm dữ liệu tham chiếu</label>
          <div className="upload-box">
            <Upload size={18} />
            <input
              id="attachment"
              type="file"
              accept=".txt,.json,.csv"
              disabled={busy || uploads.length >= 5}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const f = new FormData();
                f.set("file", file);
                setBusy(true);
                try {
                  const a = await api<{ id: string; name: string }>("uploads", {
                    method: "POST",
                    body: f,
                  });
                  setUploads((u) => [...u, a]);
                  setPlan(undefined);
                } catch (e) {
                  onError((e as Error).message);
                } finally {
                  setBusy(false);
                  e.target.value = "";
                }
              }}
            />
          </div>
          <small>
            TXT/CSV/JSON, tối đa 2 MB/file, 5 file. Lưu thật trên server; mock
            chưa phân tích nội dung các file đính kèm.
          </small>
          {uploads.map((f) => (
            <div className="uploaded-file" key={f.id}>
              <FileText size={14} />
              {f.name}
              <button
                type="button"
                aria-label={"Bỏ đính kèm " + f.name}
                onClick={() => {
                  setUploads((u) => u.filter((x) => x.id !== f.id));
                  setPlan(undefined);
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <div className="form-footer">
            <button className="button primary" disabled={busy} type="submit">
              {busy ? "Đang xử lý…" : "Đề xuất workflow"}{" "}
              <ArrowRight size={15} />
            </button>
            <span>
              Planner template có kiểm tra DAG; chưa phải AI planner tự do.
            </span>
          </div>
        </div>
      </form>
      <section className="panel plan-preview">
        <div className="panel-header">
          <h2>Kế hoạch & chi phí dự kiến</h2>
          <Layers size={17} />
        </div>
        {plan ? (
          <div className="panel-body">
            <p className="muted">
              {plan.template} · version {plan.version}
            </p>
            <div className="goal-contract">
              <strong>Goal contract · {plan.interpretation.strategy}</strong>
              <p>{plan.interpretation.objective}</p>
              <ul>
                {plan.interpretation.acceptance_criteria.map((criterion, i) => (
                  <li key={i}>{criterion}</li>
                ))}
              </ul>
              <small>{plan.interpretation.notice}</small>
            </div>
            <ol className="plan-list">
              {plan.nodes.map((n, i) => (
                <li key={n.key}>
                  <span>{i + 1}</span>
                  <div>
                    <strong>{n.title}</strong>
                    <small>
                      {n.kind} ·{" "}
                      {n.depends_on.length
                        ? "sau " + n.depends_on.join(", ")
                        : "bước đầu"}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
            <div className="estimate">
              <span>Ước tính bảo thủ · {plan.estimate.mode}</span>
              <strong>${(plan.estimate.cost_cents / 100).toFixed(2)}</strong>
            </div>
            <p className="field-hint">
              {plan.estimate.notice} Cần anh duyệt trước khi delivery. Website
              không bị thay đổi.
            </p>
            <button
              className="button primary launch"
              disabled={busy}
              type="button"
              onClick={async () => {
                setBusy(true);
                onError("");
                try {
                  if (previewKey.current !== JSON.stringify(payload()))
                    throw Error(
                      "Yêu cầu đã thay đổi. Anh cần đề xuất lại workflow.",
                    );
                  const run = await api<{ id: string }>(
                    "runs",
                    post(payload()),
                  );
                  onCreated(run.id);
                } catch (e) {
                  onError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Play size={15} /> Khởi chạy workflow {plan.estimate.mode}
            </button>
          </div>
        ) : (
          <Empty
            title="Xem kế hoạch trước khi chạy"
            text="Điền mục tiêu và bấm Đề xuất workflow. Chưa có tác vụ nào được thực thi."
          />
        )}
      </section>
    </div>
  );
}
function TaskBoard({
  detail,
  onInspect,
}: {
  detail: Detail;
  onInspect: (t: TaskRow) => void;
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("ALL");
  const list = detail.tasks.filter(
    (t) =>
      (filter === "ALL" || t.status === filter) &&
      (t.title + " " + t.key + " " + t.provider_id)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="panel">
      <div className="table-toolbar">
        <div className="filters">
          {[
            ["ALL", "Tất cả"],
            ["COMPLETED", "Hoàn thành"],
            ["WAITING_APPROVAL", "Chờ duyệt"],
            ["FAILED", "Lỗi"],
          ].map(([k, v]) => (
            <button
              key={k}
              className={filter === k ? "active" : ""}
              onClick={() => setFilter(k)}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search size={14} />
          <input
            aria-label="Tìm tác vụ"
            placeholder="Tìm tác vụ, provider…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>TÁC VỤ</th>
              <th>DEPENDENCY</th>
              <th>OWNER / PRIORITY</th>
              <th>TRẠNG THÁI</th>
              <th>EVIDENCE</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.title}</strong>
                  <small>
                    {t.key} · {t.id.slice(0, 8)}
                  </small>
                </td>
                <td>
                  {detail.dependencies
                    .filter((d) => d.task_id === t.id)
                    .map(
                      (d) =>
                        detail.tasks.find((x) => x.id === d.depends_on_id)?.key,
                    )
                    .join(", ") || "—"}
                </td>
                <td>
                  {t.provider_id || "ORBIT"}
                  <small>P{t.priority}</small>
                </td>
                <td>
                  <Status value={t.status} />
                </td>
                <td>
                  <button
                    className="button secondary"
                    onClick={() => onInspect(t)}
                  >
                    Xem chi tiết ↗
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && (
          <Empty
            title="Không có tác vụ phù hợp"
            text="Thử bộ lọc hoặc từ khóa khác."
          />
        )}
      </div>
    </section>
  );
}
function SettingsPanel({
  initial,
  busy,
  save,
}: {
  initial: SettingsRow;
  busy: boolean;
  save: (s: unknown) => Promise<void>;
}) {
  return (
    <form
      className="panel settings-panel"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void save({
          max_budget_cents: Number(f.get("budget")),
          concurrency: Number(f.get("concurrency")),
          data_policy: String(f.get("data_policy")),
        });
      }}
    >
      <div className="panel-header">
        <h2>Chính sách thực thi</h2>
        <ShieldCheck size={18} />
      </div>
      <div className="panel-body">
        <div className="field-grid">
          <div>
            <label htmlFor="max-budget">
              Giới hạn mỗi workflow (USD cents)
            </label>
            <input
              id="max-budget"
              name="budget"
              type="number"
              min={0}
              max={100000}
              defaultValue={initial.max_budget_cents}
              required
            />
          </div>
          <div>
            <label htmlFor="concurrency">Tác vụ chạy đồng thời</label>
            <input
              id="concurrency"
              name="concurrency"
              type="number"
              min={1}
              max={4}
              defaultValue={initial.concurrency}
              required
            />
          </div>
        </div>
        <div className="policy-row">
          <ShieldCheck size={18} />
          <div>
            <strong>Read-only bắt buộc</strong>
            <p>
              Không xuất bản, gửi email, thanh toán, xóa dữ liệu hoặc sửa
              website.
            </p>
          </div>
          <span className="pill green">ĐANG ÁP DỤNG</span>
        </div>
        <div className="policy-row">
          <Database size={18} />
          <div>
            <strong>Chính sách dữ liệu AI</strong>
            <p>
              LIVE chỉ nhận việc sau explicit consent theo goal và hai model/API
              có probe thật còn hiệu lực.
            </p>
            <label htmlFor="data-policy">Phạm vi truyền dữ liệu</label>
            <select
              id="data-policy"
              name="data_policy"
              defaultValue={initial.data_policy}
            >
              <option value="local-only">Local-only · chỉ MOCK</option>
              <option value="external">
                External · cho phép API sau consent
              </option>
            </select>
          </div>
        </div>
        <div className="policy-row">
          <CheckCircle2 size={18} />
          <div>
            <strong>Approval trước khi bàn giao</strong>
            <p>Quyết định gắn checksum đúng phiên bản bảng việc.</p>
          </div>
        </div>
        <div className="inline-note">
          Tài khoản do quản trị viên cấp; phiên đăng nhập có thời hạn, phân
          quyền phía server và kiểm tra Origin. Backup mã hóa có lịch; nghiệm
          thu production và kết nối LIVE được kiểm chứng riêng.
        </div>
        <button className="button primary" disabled={busy} type="submit">
          Lưu cấu hình
        </button>
      </div>
    </form>
  );
}
function InspectTask({
  task,
  detail,
  onClose,
}: {
  task: TaskRow;
  detail?: Detail;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog className="task-dialog" ref={ref} onCancel={onClose}>
      <div className="dialog-heading">
        <div>
          <div className="eyebrow">
            TASK {task.id.slice(0, 8)} · {String(task.input.mode ?? "MOCK")}
          </div>
          <h2>{task.title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Đóng chi tiết"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <Status value={task.status} />
      <h3>Acceptance criteria</h3>
      <p>{task.acceptance}</p>
      <h3>Input</h3>
      <pre>{JSON.stringify(task.input, null, 2)}</pre>
      <h3>Output đã kiểm tra schema</h3>
      <pre>
        {task.output
          ? JSON.stringify(task.output, null, 2)
          : "Chưa có output hợp lệ."}
      </pre>
      <h3>Execution attempts</h3>
      {detail?.attempts
        .filter((a) => a.task_id === task.id)
        .map((a) => (
          <div className="attempt-row" key={a.id}>
            <strong>
              #{a.number} · {a.status}
            </strong>
            <small>
              {a.id} · {a.provider_id || task.kind} · ${a.cost_cents / 100}
              {a.error_code && " · " + a.error_code}
            </small>
          </div>
        ))}
      {detail?.artifacts
        .filter((a) => a.task_id === task.id)
        .map((a) => (
          <FileLink key={a.id} file={a} />
        ))}
    </dialog>
  );
}

function ProviderConfig({
  connection,
  busy,
  save,
}: {
  connection: ConnectionRow;
  busy: boolean;
  save: (config: { enabled: boolean; model: string }) => Promise<void>;
}) {
  return (
    <form
      data-provider-id={connection.id}
      className="provider-config"
      onSubmit={(e) => {
        e.preventDefault();
        const fields = new FormData(e.currentTarget);
        void save({
          enabled: fields.get("enabled") === "on",
          model: String(fields.get("model")),
        });
      }}
    >
      <label htmlFor={"model-" + connection.id}>
        Model MOCK (không phải model API thật)
      </label>
      <select
        id={"model-" + connection.id}
        name="model"
        defaultValue={String(
          connection.metadata.selected_model ?? connection.models[0],
        )}
      >
        {connection.models.map((model) => (
          <option key={model}>{model}</option>
        ))}
      </select>
      <label className="checkbox-label">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={connection.metadata.enabled !== false}
        />
        Cho router sử dụng adapter này
      </label>
      <button className="button secondary" disabled={busy}>
        Lưu cấu hình model
      </button>
    </form>
  );
}

function LiveProviderConfig({
  connection,
  busy,
  save,
  probe,
}: {
  connection: ConnectionRow;
  busy: boolean;
  save: (config: unknown) => Promise<void>;
  probe: () => Promise<void>;
}) {
  const profile = connection.metadata.model_config as
    Record<string, unknown> | undefined;
  return (
    <form
      className="provider-config"
      data-live-provider={connection.id}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void save({
          enabled: f.get("enabled") === "on",
          model: String(f.get("model")),
          model_config: {
            input_usd_per_million: Number(f.get("input_price")),
            output_usd_per_million: Number(f.get("output_price")),
            max_input_tokens: Number(f.get("max_input")),
            max_output_tokens: Number(f.get("max_output")),
            price_source: String(f.get("price_source")),
            price_date: String(f.get("price_date")),
          },
        });
      }}
    >
      <label>
        Model ID API
        <input
          name="model"
          required
          maxLength={150}
          defaultValue={String(connection.metadata.selected_model ?? "")}
          placeholder="Model ID chính xác của tài khoản anh"
        />
      </label>
      <div className="field-grid">
        <label>
          USD / 1M input tokens
          <input
            type="number"
            name="input_price"
            min={0}
            max={10000}
            step="any"
            required
            defaultValue={String(profile?.input_usd_per_million ?? "")}
          />
        </label>
        <label>
          USD / 1M output tokens
          <input
            type="number"
            name="output_price"
            min={0}
            max={10000}
            step="any"
            required
            defaultValue={String(profile?.output_usd_per_million ?? "")}
          />
        </label>
      </div>
      <div className="field-grid">
        <label>
          Input token cap
          <input
            type="number"
            name="max_input"
            min={1024}
            max={200000}
            required
            defaultValue={String(profile?.max_input_tokens ?? 32000)}
          />
        </label>
        <label>
          Output token cap
          <input
            type="number"
            name="max_output"
            min={128}
            max={8192}
            required
            defaultValue={String(profile?.max_output_tokens ?? 2048)}
          />
        </label>
      </div>
      <label>
        Nguồn giá (operator xác nhận)
        <input
          name="price_source"
          required
          minLength={5}
          maxLength={300}
          defaultValue={String(profile?.price_source ?? "")}
        />
      </label>
      <label>
        Ngày tham chiếu giá
        <input
          type="date"
          name="price_date"
          required
          defaultValue={String(profile?.price_date ?? "")}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={connection.metadata.enabled === true}
        />
        Cho router dùng sau khi probe thành công
      </label>
      <button className="button secondary" disabled={busy}>
        Lưu model & giới hạn chi phí
      </button>
      <small>
        Chưa tự xác minh giá. Chi phí từ reported usage và giá operator, làm
        tròn lên cents để giới hạn ngân sách. Probe có thể tính phí riêng.
      </small>
      <button
        type="button"
        className="button primary"
        disabled={busy || !connection.metadata.credential_present}
        onClick={() => {
          if (
            confirm(
              "Probe sẽ gọi API thật, có thể tính phí theo cấu hình và giới hạn hiện tại. Tiếp tục?",
            )
          )
            void probe();
        }}
      >
        Probe API thật (có thể tính phí)
      </button>
    </form>
  );
}
