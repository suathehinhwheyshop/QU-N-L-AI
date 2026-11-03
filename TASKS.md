# ORBIT — checklist triển khai

## Baseline và kiến trúc

- [x] HEAD `b6bb1fc`, branch Phase 2 và working tree sạch được xác minh trước sửa.
- [x] Baseline chạy lại 19 unit/19 integration/typecheck/build/E2E; archive docs/evidence/phase2-baseline.
- [x] Branch riêng orbit/phase3-gsc-seo-workflow, không merge main.
- [x] Giữ 7 packages và Phase 1–2 engine; không tạo queue khác hoặc phụ thuộc Claude Code.
- [x] Giữ mock providers và toàn bộ Foundation/Phase 2 regressions.

## Phase 3 implementation

- [x] OAuth read-only, PKCE/state/browser nonce/TTL/replay prevention.
- [x] Token encryption AES-256-GCM/AAD/key riêng, không secrets client/log.
- [x] Row-locked refresh, 401 một lần, invalid_grant reauthorize; revoke/pending/version guard.
- [x] Property discovery, Search Analytics filters/date range, bounded pagination, 403/429/timeout handling.
- [x] Ingestion chạy qua engine tool task, page checkpoint + fence, restart/retry/duplicate jobs.
- [x] Immutable normalized dataset, raw import checksum/API page hashes, provenance/timezone/warnings.
- [x] CSV/JSON import và equal nonoverlapping period comparison.
- [x] Deterministic CTR/weighted position/counts/deltas và bounded evidence facts.
- [x] AI1 + AI2 khác provider dùng schemas không cho số liệu tự tạo; code validation + synthesis.
- [x] Task Board/evidence/criteria, hash-bound human approval, MD/CSV/JSON artifacts.
- [x] Backend/UI connection/property/datasets/insights/execution/reports; OAuth controls honest khi chưa có config.
- [x] Không website write/publish hoặc paid AI call trong lượt này.

## Kiểm chứng

- [x] 25 unit/protocol tests PASS.
- [x] 31 PostgreSQL integration tests PASS (19 regression + 11 Phase 3 + 1 teardown reliability).
- [x] Typecheck/production build PASS.
- [x] E2E API–worker–database, OAuth/GSC HTTP_STUB và app+worker restart ở pagination checkpoint PASS.
- [x] Browser 11 nhóm, 9 views ở mobile 390 px; không runtime exceptions.
- [x] Report checksums/ownership/approval integrity, source mismatch, invented values, expired state/token, refresh/revoke/429/timeout/duplicate jobs được kiểm tra.
- [x] Live verifiers trả BLOCKED/exit 2 rõ nguyên nhân, không coi đó là passed LIVE test.
- [x] README/architecture/schema/roadmap/tasks và docs/PHASE3_VALIDATION.md + evidence.

## LIVE gates chưa đạt

- [ ] Google OAuth client ID/secret thật, consent/property read grant.
- [ ] Publish/apply egress + secure server config; GSC_API snapshot qua worker và official source evidence.
- [ ] Ít nhất hai AI API keys/quota/model/pricing, probes và paid-call permission riêng.
- [ ] SEO multi-AI LIVE → validation → human approval → artifacts, evidence GSC/AI riêng.
- [x] Phase 4 continuation: làm các phần auth/staging/hardening độc lập với credentials; giữ LIVE gates riêng.

CODE COMPLETE và HTTP_STUB TESTED không đồng nghĩa LIVE VERIFIED. Commit/push được xác nhận bằng Git khi bàn giao; không dự đoán SHA trong tài liệu.

## Phase 4

- [x] Baseline 1def13b, regression cũ và branch riêng, giữ 7 packages/engine/UI.
- [x] Real provisioned accounts; hashed opaque sessions, expiry/logout/reset, server RBAC/workspace isolation.
- [x] CSRF, bounded bodies, nonce CSP, protected credentials/settings/downloads/worker operations.
- [x] Docker/Compose non-root web/worker, PostgreSQL, TLS local, migrations/grants, persistent storage, health/drain/restart.
- [x] Local production-build HTTPS E2E và desktop/mobile 390 px; fresh + Phase 3 upgrade migrations.
- [x] Dual-key token rotation; scheduled encrypted pg_dump/artifact backup + real restore/tamper test.
- [x] Integrity/retention, request IDs, operations checks/alerts JSON, limits/quota/budgets, security/deploy/recovery docs.
- [x] Local CI-equivalent gates thực thi; GitHub Actions workflow chuẩn bị (không auto deploy).
- [ ] Public host/domain/DNS/ACME và quyền publish; không tạo paid resources tự động.
- [ ] Offsite backup và fresh-host recovery; đo RPO/RTO trên dữ liệu thật.
- [ ] External alert delivery, OS image CVE scan và independent security review.
- [ ] Remote CI run, production acceptance; GSC LIVE và hai AI LIVE vẫn BLOCKED.
