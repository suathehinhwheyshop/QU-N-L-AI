import { config } from "dotenv";
import { writeFile, mkdir } from "node:fs/promises";
config({ path: ".env.local", quiet: true });
const report: Record<string, unknown> = {
  at: new Date().toISOString(),
  status: "BLOCKED",
  gsc_live_verified: false,
  ai_live_verification: "SEPARATE",
  paid_calls: false,
};
let pool: (typeof import("@orbit/database/client"))["pool"] | undefined;
try {
  const names = [
    "ORBIT_GSC_CLIENT_ID",
    "ORBIT_GSC_CLIENT_SECRET",
    "ORBIT_TOKEN_ENCRYPTION_KEY",
  ];
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    report.reason = "GSC_OAUTH_CONFIGURATION_REQUIRED";
    report.missing = missing;
    process.exitCode = 2;
  } else {
    pool = (await import("@orbit/database/client")).pool;
    const owner = (
      await pool.query("SELECT id FROM users WHERE email='owner@orbit.local'")
    ).rows[0]?.id;
    const { GscOAuth } = await import("@orbit/integrations/gsc-oauth");
    const status = await new GscOAuth().status(owner);
    const id = process.argv.find((a) => a.startsWith("--dataset="))?.slice(10);
    if (status.kind !== "GSC_API" || status.status !== "CONNECTED" || !id) {
      report.reason = "OFFICIAL_OAUTH_AND_DATASET_EXECUTION_REQUIRED";
      process.exitCode = 2;
    } else {
      const { loadDataset } = await import("@orbit/integrations/seo-data");
      const { data, row } = await loadDataset(owner, id);
      const job = (
        await pool.query(
          "SELECT j.*,r.status FROM gsc_jobs j JOIN runs r ON r.id=j.run_id WHERE j.id=$1 AND j.owner_id=$2",
          [row.job_id, owner],
        )
      ).rows[0];
      if (
        data.provenance.kind !== "GSC_API" ||
        job?.status !== "COMPLETED" ||
        job.dataset_id !== id
      )
        throw Error("GSC_EVIDENCE_NOT_OFFICIAL");
      const { LocalArtifactStore, digest, jsonBytes } =
        await import("@orbit/storage/store");
      const store = new LocalArtifactStore();
      const pages = job.checkpoint.pages as { key: string; sha256: string }[];
      if (
        !pages?.length ||
        pages.length !== data.provenance.source_hashes.length
      )
        throw Error("GSC_SOURCE_MISMATCH");
      for (const page of pages) {
        const body = JSON.parse(
          (await store.read(page.key, page.sha256)).toString(),
        );
        if (
          body.kind !== "GSC_API" ||
          !data.provenance.source_hashes.includes(page.sha256) ||
          digest(jsonBytes(body.spec)) !== digest(jsonBytes(data.spec))
        )
          throw Error("GSC_SOURCE_MISMATCH");
      }
      Object.assign(report, {
        status: "LIVE_VERIFIED_FROM_STORED_EXECUTION",
        gsc_live_verified: true,
        dataset_id: id,
        sha256: row.sha256,
        ingestion_run_id: job.run_id,
        captured_at: data.provenance.captured_at,
        source_pages: pages.length,
        notice:
          "Verified immutable official GSC execution artifacts; this command performs no new network or AI calls.",
      });
    }
  }
} catch (e) {
  report.status = "FAILED";
  report.reason =
    e instanceof Error && /^[A-Z_]+$/.test(e.message)
      ? e.message
      : "GSC_VERIFICATION_FAILED";
  process.exitCode = 1;
} finally {
  await pool?.end();
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/phase3-gsc-live.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
