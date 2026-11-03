"use client";
import { useEffect, useState } from "react";
type Connection = {
  id: string;
  name: string;
  method: string;
  status: string;
  code: string;
  login_action?: string;
  version?: string;
  remaining_quota: null;
  quota_notice?: string;
};
export default function SubscriptionConnections() {
  const [rows, setRows] = useState<Connection[]>([]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function load() {
    const r = await fetch("/api/subscriptions", { cache: "no-store" });
    if (!r.ok) throw Error("Không đọc được trạng thái CLI.");
    setRows(await r.json());
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function probe(id: string) {
    setBusy(id);
    setError("");
    try {
      const r = await fetch("/api/connections/" + id + "/subscription-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.message ?? data.code);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await load().catch(() => {});
      setBusy("");
    }
  }
  if (!rows.length) return null;
  return (
    <section
      data-testid="subscription-connections"
      className="panel panel-body"
    >
      <h2>AI qua gói thuê bao</h2>
      <p>
        Đăng nhập bằng CLI chính thức trong WSL2. Kiểm tra kết nối gửi một yêu
        cầu nhỏ và sử dụng hạn mức của tài khoản; không thay đổi billing
        settings. CLI được cài chưa đồng nghĩa đã kết nối.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="connection-grid">
        {rows.map((c) => (
          <article className="panel panel-body" key={c.id} data-cli={c.id}>
            <h3>{c.name}</h3>
            <span className="pill">{c.status}</span>
            <p>
              {c.method}
              {c.version && " · " + c.version}
            </p>
            <small>{c.code}</small>
            {c.login_action && (
              <>
                <p>PowerShell:</p>
                <code style={{ overflowWrap: "anywhere" }}>
                  Orbit.ps1 -Action {c.login_action} -Repository
                  /home/USER/ORBIT
                </code>
                <p>{c.quota_notice}</p>
                <button
                  className="button secondary"
                  disabled={
                    !!busy ||
                    ["NOT_INSTALLED", "UNSUPPORTED", "BLOCKED"].includes(
                      c.status,
                    )
                  }
                  onClick={() => void probe(c.id)}
                >
                  {busy === c.id
                    ? "Đang kiểm tra…"
                    : "Kiểm tra bằng hạn mức thuê bao"}
                </button>
              </>
            )}
          </article>
        ))}
      </div>
      <p>
        Claude Max 5x và Grokbot đang BLOCKED về quyền tích hợp. ChatGPT dùng
        Codex CLI chính thức; chỉ chạy khi cơ chế dùng hạn mức bao gồm được xác
        minh. Gemini tắt mặc định; không dùng để thay thế provider còn thiếu.
        Không bật overage, top-up hoặc chuyển sang API tính phí.
      </p>
    </section>
  );
}
