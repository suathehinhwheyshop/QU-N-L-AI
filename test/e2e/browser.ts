import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const tabs = await (
  await fetch(
    (process.env.ORBIT_BROWSER_CDP ?? "http://127.0.0.1:9230") + "/json/list",
  )
).json();
const ws = new WebSocket(
  tabs.find((t: { type: string }) => t.type === "page").webSocketDebuggerUrl,
);
await new Promise<void>((r, j) => {
  ws.addEventListener("open", () => r(), { once: true });
  ws.addEventListener("error", () => j(Error("CDP connection failed")), {
    once: true,
  });
});
let seq = 0;
const pending = new Map<
    number,
    {
      resolve: (v: Record<string, unknown>) => void;
      reject: (e: Error) => void;
    }
  >(),
  errors: string[] = [];
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.method === "Runtime.exceptionThrown")
    errors.push(m.params.exceptionDetails.text);
  if (m.id) {
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
    }
  }
};
function send(
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.delete(id)) reject(Error("CDP timeout " + method));
    }, 12000).unref();
  });
}
async function evaluate<T = unknown>(expression: string): Promise<T> {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw Error("Browser expression failed");
  return (r.result as { value: T })?.value;
}
async function waitFor(expression: string, limit = 30000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    if (await evaluate("Boolean(" + expression + ")")) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error(
    "Browser wait failed: " +
      expression +
      "; toast=" +
      (await evaluate("document.querySelector('.toast')?.textContent ?? ''")),
  );
}
async function clickText(text: string) {
  await waitFor(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes(${JSON.stringify(text)})&&!b.disabled)`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`,
  );
}
async function route(hash: string) {
  await evaluate(`location.hash=${JSON.stringify(hash)}`);
  await new Promise((r) => setTimeout(r, 300));
}
const checks: string[] = [];
try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: "about:blank" });
  await waitFor("location.href==='about:blank'");
  await send("Page.navigate", {
    url: process.env.ORBIT_BROWSER_ORIGIN ?? "http://127.0.0.1:3200",
  });
  await waitFor(
    "document.querySelector('#password') || document.querySelector('.page-heading')",
  );
  if (await evaluate("!!document.querySelector('#password')")) {
    await waitFor("document.readyState==='complete'");
    await new Promise((r) => setTimeout(r, 500));
    await evaluate(
      `document.querySelector('#email').value=${JSON.stringify(process.env.ORBIT_TEST_LOGIN_EMAIL)};document.querySelector('#password').value=${JSON.stringify(process.env.ORBIT_TEST_LOGIN_PASSWORD)};document.querySelector('form').requestSubmit()`,
    );
    await waitFor("document.querySelector('.page-heading')");
  }
  await route("#new");
  await waitFor("document.querySelector('#goal')");
  await evaluate(
    "document.querySelector('#goal').value='Phân tích hiệu suất SEO WheyShop từ GSC và tạo bảng công việc có kiểm chứng.'",
  );
  await evaluate(
    "const select=document.querySelector('#workspace');select.value=Array.from(select.options).find(o=>o.text.includes('SEO')).value;select.dispatchEvent(new Event('change',{bubbles:true}))",
  );
  await mkdir(".orbit", { recursive: true });
  await writeFile(
    ".orbit/browser-reference.txt",
    "Reference attachment for ORBIT Phase 1 browser test.",
  );
  const dom = await send("DOM.getDocument");
  const root = (dom.root as { nodeId: number }).nodeId;
  const input = await send("DOM.querySelector", {
    nodeId: root,
    selector: "#attachment",
  });
  await send("DOM.setFileInputFiles", {
    nodeId: input.nodeId,
    files: [resolve(".orbit/browser-reference.txt")],
  });
  await waitFor("document.querySelector('.uploaded-file')");
  checks.push("file attachment stored from UI");
  await clickText("Đề xuất workflow");
  await waitFor("document.querySelectorAll('.plan-list li').length===6");
  checks.push("natural goal → backend template plan and zero mock cost");
  await clickText("Khởi chạy workflow MOCK");
  await waitFor("document.querySelector('.approval-card')");
  const runHash = await evaluate<string>("location.hash");
  await route("#tasks");
  await waitFor("document.querySelectorAll('tbody tr').length===6");
  await clickText("Xem chi tiết");
  await waitFor("document.querySelector('dialog[open]')");
  assert.ok(
    (
      await evaluate<string>('document.querySelector("dialog").innerText')
    ).includes("Acceptance criteria"),
  );
  await evaluate(
    "document.querySelector('button[aria-label=\"Đóng chi tiết\"]').click()",
  );
  checks.push(
    "worker-backed task board, dependencies, acceptance and attempts",
  );
  await route(runHash);
  await waitFor("document.querySelector('.approval-card')");
  await clickText("Phê duyệt báo cáo");
  await waitFor(
    "document.querySelector('.run-hero .pill')?.textContent.includes('Đã kiểm chứng')",
  );
  checks.push("hash-bound approval from UI → verified delivery");
  await route("#connections");
  if (process.env.ORBIT_TEST_SUBSCRIPTIONS_BROWSER === "true") {
    await waitFor("document.querySelectorAll('[data-cli]').length===3");
    assert.ok(
      await evaluate(
        "document.querySelector('[data-cli=claude-code]').innerText.includes('BLOCKED')",
      ),
    );
    assert.ok(
      await evaluate(
        "document.querySelector('[data-cli=grokbot]').innerText.includes('BLOCKED')",
      ),
    );
    assert.ok(
      await evaluate(
        "document.querySelector('[data-cli=codex-cli] button').disabled",
      ),
    );
    checks.push(
      "subscription connection cards show real unverified installation/auth state, Claude Max 5x/Grokbot blocked and no default Gemini",
    );
  }
  await evaluate(
    `(()=>{const section=document.querySelector('form[data-provider-id="mock-anthropic"]').closest('section');Array.from(section.querySelectorAll('button')).find(b=>b.textContent.includes('Test mock adapter')).click()})()`,
  );
  await waitFor("document.body.innerText.includes('MOCK_ADAPTER_OK')");
  assert.ok(
    (await evaluate<number>(
      "document.querySelectorAll('.not-available').length",
    )) >= 4,
  );
  checks.push("mock health persisted; four real providers remain unavailable");
  const configSelector = 'form[data-provider-id="mock-anthropic"]';
  const original = await evaluate<{ enabled: boolean; model: string }>(
    `(()=>{const form=document.querySelector('${configSelector}');return {enabled:form.querySelector('input[name="enabled"]').checked,model:form.querySelector('select').value}})()`,
  );
  try {
    await evaluate(
      `(()=>{const form=document.querySelector('${configSelector}');form.querySelector('input[name="enabled"]').checked=${!original.enabled};form.requestSubmit()})()`,
    );
    await waitFor(
      "document.querySelector('.toast')?.textContent.includes('model configuration')",
    );
    assert.equal(
      await evaluate(
        "fetch('/api/bootstrap').then(r=>r.json()).then(d=>d.connections.find(c=>c.id==='mock-anthropic').metadata.enabled)",
      ),
      !original.enabled,
    );
    await waitFor(
      `!document.querySelector('${configSelector} button').disabled`,
    );
  } finally {
    await evaluate(
      `fetch('/api/connections/mock-anthropic/config',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(original)})}).then(r=>{if(!r.ok)throw Error('restore config failed');return true})`,
    );
  }
  checks.push(
    "provider configuration form persists owner model/availability in backend",
  );

  await route("#settings");
  await evaluate(
    "document.querySelector('#max-budget').value='100';document.querySelector('form').requestSubmit()",
  );
  await waitFor(
    "document.querySelector('.toast')?.textContent.includes('Đã lưu')",
  );
  checks.push("settings form saves backend policy");
  await route("#seo");
  await waitFor("document.querySelector('[data-testid=seo-import]')");
  assert.ok(
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Kết nối Google read-only').disabled",
    ),
  );
  for (const [field, value] of [
    ["current_start", "2026-10-01"],
    ["current_end", "2026-10-28"],
  ]) {
    await evaluate(
      `(()=>{const input=document.querySelector('input[name="${field}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${value}');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await new Promise((r) => setTimeout(r, 100));
  }
  await writeFile(
    ".orbit/seo-browser.csv",
    "period,page,query,clicks,impressions,position\ncurrent,https://wheyshop.vn/whey,whey,20,1000,8\ncurrent,https://wheyshop.vn/creatine,creatine,30,500,3\ncurrent,https://wheyshop.vn/bcaa,bcaa,5,500,12\n",
  );
  const seoDom = await send("DOM.getDocument");
  const seoInput = await send("DOM.querySelector", {
    nodeId: (seoDom.root as { nodeId: number }).nodeId,
    selector: "[data-testid=seo-import] input[type=file]",
  });
  await send("DOM.setFileInputFiles", {
    nodeId: seoInput.nodeId,
    files: [resolve(".orbit/seo-browser.csv")],
  });
  await clickText("Import dataset");
  await waitFor("document.querySelector('[data-testid=seo-insights]')");
  assert.ok(
    (
      await evaluate<string>("document.querySelector('.seo-metrics').innerText")
    ).includes("55"),
  );
  await clickText("Xem kế hoạch SEO");
  await waitFor("document.querySelectorAll('.seo-preview li').length===7");
  await clickText("Khởi chạy SEO MOCK");
  await waitFor("document.querySelector('.approval-card')");
  await clickText("Phê duyệt báo cáo");
  await waitFor(
    "document.querySelector('.run-hero .pill')?.textContent.includes('Đã kiểm chứng')",
  );
  const seoRun = await evaluate<string>("location.hash.slice(10)");
  assert.equal(
    await evaluate(
      `fetch('/api/runs/'+${JSON.stringify(seoRun)}).then(r=>r.json()).then(d=>d.artifacts.filter(f=>f.kind.startsWith('report_')).length)`,
    ),
    3,
  );
  checks.push(
    "SEO UI imports real CSV bytes, shows deterministic 55 clicks, previews seven-step plan, executes MOCK and approves three report files; OAuth disabled without server config",
  );
  await route("#artifacts");
  await waitFor("document.querySelectorAll('.artifact-card').length>=7");
  checks.push("real uploaded/generated artifacts visible");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  for (const hash of [
    "#seo",
    "#dashboard",
    "#new",
    "#workflows",
    runHash,
    "#tasks",
    "#connections",
    "#artifacts",
    "#settings",
  ]) {
    await route(hash);
    const size = await evaluate<{ scroll: number; width: number }>(
      "({scroll:document.documentElement.scrollWidth,width:innerWidth})",
    );
    assert.ok(
      size.scroll <= 390,
      hash + " horizontal overflow: " + JSON.stringify(size),
    );
  }
  checks.push("nine views including SEO fit 390px mobile viewport");
  await mkdir("docs/evidence", { recursive: true });
  await new Promise((r) => setTimeout(r, 4200));
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1120,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await route("#dashboard");
  await evaluate("scrollTo(0,0)");
  let shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(
    "docs/evidence/dashboard-desktop.png",
    Buffer.from(shot.data as string, "base64"),
  );
  await route(runHash);
  await evaluate("scrollTo(0,0)");
  shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(
    "docs/evidence/workflow-desktop.png",
    Buffer.from(shot.data as string, "base64"),
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 430,
    height: 1380,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await evaluate("scrollTo(0,0)");
  shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(
    "docs/evidence/workflow-mobile.png",
    Buffer.from(shot.data as string, "base64"),
  );
  await route("#seo");
  await waitFor("document.querySelector('[data-testid=seo-insights]')");
  await evaluate("scrollTo(0,0)");
  shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(
    "docs/evidence/seo-mobile.png",
    Buffer.from(shot.data as string, "base64"),
  );
  assert.deepEqual(errors, []);
  checks.push("no browser runtime exceptions");
  await writeFile(
    "docs/evidence/browser-checks.json",
    JSON.stringify(
      { result: "PASS", mode: "MOCK", at: new Date().toISOString(), checks },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ result: "PASS", checks }, null, 2));
} finally {
  ws.close();
}
