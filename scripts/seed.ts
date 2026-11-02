import { db, pool } from "../src/db/client";
import {
  users,
  settings,
  workspaces,
  connections,
  providerConfigs,
} from "../src/db/schema";
import { providers, realProviders } from "../src/providers/registry";
import { integrations } from "../src/integrations/registry";
import { workspaceModules } from "@orbit/workspaces/registry";
export async function seed() {
  const [owner] = await db
    .insert(users)
    .values({ email: "owner@orbit.local", name: "Dũng Nguyễn" })
    .onConflictDoUpdate({ target: users.email, set: { name: "Dũng Nguyễn" } })
    .returning();
  await db
    .insert(settings)
    .values({ owner_id: owner.id })
    .onConflictDoNothing();
  for (const module of workspaceModules)
    await db
      .insert(workspaces)
      .values({
        owner_id: owner.id,
        slug: module.kind,
        name: module.name,
        kind: module.kind,
      })
      .onConflictDoNothing();
  for (const adapter of providers) {
    const d = adapter.descriptor;
    await db
      .insert(connections)
      .values({
        id: d.id,
        name: `${realProviders.find((p) => p.id === d.vendor)?.name ?? d.id} · MOCK`,
        mode: "MOCK",
        status: "MOCK",
        capabilities: d.capabilities,
        models: [d.model],
        metadata: {
          kind: "provider",
          vendor: d.vendor,
          dataPolicy: d.dataPolicy,
          latencyMs: d.latencyMs,
          costCents: d.costCents,
        },
      })
      .onConflictDoNothing();
    await db
      .insert(providerConfigs)
      .values({
        owner_id: owner.id,
        provider_id: d.id,
        enabled: true,
        model: d.model,
      })
      .onConflictDoNothing();
  }
  await pool.query(
    `UPDATE connections SET metadata=metadata || '{"archived":true}'::jsonb WHERE id IN ('mock-orion','mock-lyra')`,
  );
  for (const p of realProviders)
    await db
      .insert(connections)
      .values({
        ...p,
        mode: "LIVE",
        status: "DISCONNECTED",
        capabilities: [],
        models: [],
        metadata: {
          kind: "provider",
          reason: "PHASE_2_NOT_IMPLEMENTED",
          permission: "none",
        },
      })
      .onConflictDoNothing();
  for (const tool of integrations)
    await db
      .insert(connections)
      .values({
        id: tool.id,
        name: tool.name,
        mode: tool.mode,
        status: "MOCK",
        capabilities: tool.scopes,
        models: [],
        metadata: {
          kind: "tool",
          permission: "fixture.read",
          scopes: tool.scopes,
        },
      })
      .onConflictDoNothing();
  await db
    .insert(connections)
    .values({
      id: "gsc",
      name: "Google Search Console",
      mode: "LIVE",
      status: "DISCONNECTED",
      capabilities: [],
      models: [],
      metadata: {
        kind: "tool",
        permission: "none",
        required_scopes: ["webmasters.readonly"],
        reason: "PHASE_3_NOT_IMPLEMENTED",
      },
    })
    .onConflictDoNothing();
  return owner;
}
if (process.argv[1]?.endsWith("seed.ts"))
  try {
    await seed();
    console.log("Seed complete; credentials are not stored in the database.");
  } finally {
    await pool.end();
  }
