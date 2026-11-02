"use client";
import { useState } from "react";
export default function Login() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-shell">
      <form
        method="post"
        action="/api/auth/login"
        className="panel login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const password = new FormData(e.currentTarget).get("password");
            const res = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password }),
            });
            if (!res.ok)
              throw Error(
                "Không đăng nhập được. Kiểm tra mật khẩu development phía server.",
              );
            location.href = "/";
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand">
          <span>◉</span> orbit
        </div>
        <div className="eyebrow">FOUNDATION · KHÔNG GIAN CÁ NHÂN</div>
        <h1>Chào anh, trở lại công việc.</h1>
        <p>
          Đăng nhập development. Chưa mở truy cập public hoặc kết nối AI thật.
        </p>
        <label htmlFor="password">Mật khẩu development</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={512}
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Đang đăng nhập…" : "Vào ORBIT →"}
        </button>
        <small>
          Mật khẩu được cấu hình qua ORBIT_ADMIN_PASSWORD trên server; không gửi
          API key vào đây.
        </small>
      </form>
    </main>
  );
}
