# Phase 4 decisions

Verified parent 1def13be3d90c5df7c339d944fdb37197abee27f; baseline 25 unit/31 integration/build/typecheck/E2E/browser passed. Keep seven packages, engine and SEO numbers. No existing hosting/deployment files or cloud identity. No Internet deploy or paid resources authorized.

Milestone A first: admin-provisioned password authentication (Node scrypt; no public signup, default account or environment-password fallback), opaque hashed DB sessions with idle/absolute expiry/revocation/auth-version, PostgreSQL rate limits, server roles + workspace membership. Owner-private workspaces remain private; no cross-owner sharing in this release. OAuth state binds to the initiating authenticated session. Nonce CSP, secure cookies and Origin/Fetch-Metadata CSRF checks.

Staging: immutable Docker image, web + worker + PostgreSQL + Caddy TLS, private DB/network, distinct migrator/app/worker DB roles, migrations before serve, persistent artifacts/db, heartbeats/readiness, loopback-only ingress by default. Local Caddy CA explicitly trusted for tests; no certificate-validation bypass. No public URL until hosting/domain approval. Existing credential-less MOCK workflows remain usable.

After local staging proof: encrypted scheduled pg_dump/artifact backup + fresh-target restore drill, key rotation, integrity/orphan-retention tool, structured audit/metrics/alerts and rollback runbook. Public staging, live Google/AI verification and independently audited production readiness remain separate gates.
