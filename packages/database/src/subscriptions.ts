const definitions = [
  ["codex-cli", "Codex CLI", "openai"],
  ["gemini-cli", "Gemini CLI", "google"],
];
export async function initializeSubscriptions(owner: string) {
  const { pool } = await import("./client");
  for (const [id, name, vendor] of definitions) {
    await pool.query(
      "INSERT INTO connections(id,name,mode,status,capabilities,models,metadata) VALUES($1,$2,'LIVE','DISCONNECTED','[]','[\"default\"]',$3) ON CONFLICT(id) DO NOTHING",
      [id, name, { kind: "subscription", vendor, method: "OFFICIAL_CLI" }],
    );
    await pool.query(
      "INSERT INTO provider_configs(owner_id,provider_id,enabled,model) VALUES($1,$2,true,'default') ON CONFLICT DO NOTHING",
      [owner, id],
    );
  }
}
