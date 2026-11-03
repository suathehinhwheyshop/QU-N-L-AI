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
            const form = new FormData(e.currentTarget);
            const password = form.get("password"),
              email = form.get("email");
            const res = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password }),
            });
            if (!res.ok)
              throw Error(
                "Không đăng nhập được. Kiểm tra email và mật khẩu hoặc thử lại sau.",
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
        <p>Đăng nhập để truy cập không gian làm việc của anh.</p>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
        />
        <label htmlFor="password">Mật khẩu</label>
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
          Tài khoản do quản trị viên cấp. Không nhập API key tại đây.
        </small>
      </form>
    </main>
  );
}
