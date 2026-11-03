import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { GSC_SCOPE } from "@orbit/shared/seo";
import { OrbitError } from "@orbit/shared/contracts";
import { seal, unseal, encryptionReady } from "./token-crypto";
import { gscHttp, officialGsc, GscError, type GscTransport } from "./gsc-http";
const db = async () => (await import("@orbit/database/client")).pool;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export function oauthReady() {
  return (
    !!process.env.ORBIT_GSC_CLIENT_ID &&
    !!process.env.ORBIT_GSC_CLIENT_SECRET &&
    encryptionReady()
  );
}
function settings() {
  const clientId = process.env.ORBIT_GSC_CLIENT_ID,
    secret = process.env.ORBIT_GSC_CLIENT_SECRET,
    base = process.env.ORBIT_BASE_URL;
  if (!clientId || !secret || !base)
    throw new OrbitError("GSC_CONFIG_REQUIRED");
  const u = new URL(base);
  if (
    u.protocol !== "https:" &&
    !(u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname))
  )
    throw new OrbitError("GSC_CONFIG_REQUIRED");
  return {
    clientId,
    secret,
    redirect: new URL("/api/gsc/oauth/callback", base).href,
  };
}
const tokenSchema = z.object({
  access_token: z.string().min(1).max(16000),
  refresh_token: z.string().min(1).max(16000).optional(),
  expires_in: z.number().int().min(60).max(86400),
  token_type: z.string().refine((s) => s.toLowerCase() === "bearer"),
  scope: z.string().optional(),
});
function checkScope(scope: string | undefined) {
  if (scope && scope.trim() !== GSC_SCOPE)
    throw new OrbitError("GSC_SCOPE_REJECTED");
}
export class GscOAuth {
  constructor(readonly transport: GscTransport = officialGsc) {}
  async begin(owner: string, sessionHash?: string) {
    const cfg = settings(),
      state = randomBytes(32).toString("base64url"),
      browser = randomBytes(32).toString("base64url"),
      verifier = randomBytes(48).toString("base64url");
    const pool = await db();
    await pool.query("DELETE FROM gsc_oauth_states WHERE expires_at<now()");
    await pool.query(
      "INSERT INTO gsc_oauth_states(state_hash,owner_id,browser_hash,verifier_cipher,expires_at,session_hash) VALUES($1,$2,$3,$4,now()+interval '10 minutes',$5)",
      [
        hash(state),
        owner,
        hash(browser),
        seal(verifier, owner + ":oauth:" + hash(state)),
        sessionHash ?? null,
      ],
    );
    const url = new URL(this.transport.authorize);
    for (const [k, v] of Object.entries({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirect,
      response_type: "code",
      scope: GSC_SCOPE,
      state,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      code_challenge: hashChallenge(verifier),
      code_challenge_method: "S256",
    }))
      url.searchParams.set(k, v);
    return { url: url.href, browser };
  }
  async callback(
    state: string,
    browser: string,
    code: string,
    signal: AbortSignal,
  ) {
    if (
      !state ||
      !browser ||
      !code ||
      state.length > 200 ||
      browser.length > 200 ||
      code.length > 4096
    )
      throw new OrbitError("GSC_OAUTH_STATE");
    const pool = await db();
    const row = (
      await pool.query(
        "UPDATE gsc_oauth_states SET consumed_at=now() WHERE state_hash=$1 AND browser_hash=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING *",
        [hash(state), hash(browser)],
      )
    ).rows[0];
    if (!row) throw new OrbitError("GSC_OAUTH_STATE");
    if (row.session_hash) {
      const valid = (
        await pool.query(
          "SELECT s.user_id FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen>now()-interval '30 minutes' AND s.auth_version=u.auth_version AND u.is_active=true AND u.role='ADMIN' AND EXISTS(SELECT 1 FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE w.owner_id=u.id AND w.kind='seo' AND m.user_id=u.id AND m.role='ADMIN')",
          [row.session_hash, row.owner_id],
        )
      ).rows[0];
      if (!valid) throw new OrbitError("GSC_OAUTH_STATE");
    } else if (["staging", "production"].includes(process.env.ORBIT_ENV ?? ""))
      throw new OrbitError("GSC_OAUTH_STATE");

    const cfg = settings();
    const token = tokenSchema.parse(
      await gscHttp(
        this.transport,
        this.transport.token,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            client_id: cfg.clientId,
            client_secret: cfg.secret,
            redirect_uri: cfg.redirect,
            code_verifier: unseal(
              row.verifier_cipher,
              row.owner_id + ":oauth:" + row.state_hash,
            ),
          }).toString(),
        },
        signal,
      ),
    );
    checkScope(token.scope);
    if (!token.refresh_token)
      throw new OrbitError("GSC_REFRESH_TOKEN_REQUIRED");
    await pool.query(
      "INSERT INTO gsc_accounts(owner_id,status,kind,scope,access_cipher,refresh_cipher,expires_at) VALUES($1,'AUTHORIZED',$2,$3,$4,$5,$6) ON CONFLICT(owner_id) DO UPDATE SET status='AUTHORIZED',kind=excluded.kind,scope=excluded.scope,access_cipher=excluded.access_cipher,refresh_cipher=excluded.refresh_cipher,expires_at=excluded.expires_at,properties='[]',verified_at=NULL,error_code=NULL,updated_at=now()",
      [
        row.owner_id,
        this.transport.kind,
        GSC_SCOPE,
        seal(token.access_token, row.owner_id + ":access"),
        seal(token.refresh_token, row.owner_id + ":refresh"),
        new Date(Date.now() + token.expires_in * 1000).toISOString(),
      ],
    );
    return row.owner_id as string;
  }
  async access(owner: string, signal: AbortSignal, force = false) {
    const c = await (await db()).connect();
    try {
      await c.query("BEGIN");
      const row = (
        await c.query(
          "SELECT * FROM gsc_accounts WHERE owner_id=$1 FOR UPDATE",
          [owner],
        )
      ).rows[0];
      if (
        !row ||
        !row.access_cipher ||
        !row.refresh_cipher ||
        !["AUTHORIZED", "CONNECTED", "HTTP_STUB"].includes(row.status) ||
        row.kind !== this.transport.kind
      )
        throw new OrbitError(
          row?.status === "REVOKE_PENDING"
            ? "GSC_REVOKE_PENDING"
            : "GSC_DISCONNECTED",
        );
      if (!force && Date.parse(row.expires_at) > Date.now() + 60000) {
        const token = unseal(row.access_cipher, owner + ":access");
        await c.query("COMMIT");
        return token;
      }
      const cfg = settings();
      let body: unknown;
      try {
        body = await gscHttp(
          this.transport,
          this.transport.token,
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              client_id: cfg.clientId,
              client_secret: cfg.secret,
              refresh_token: unseal(row.refresh_cipher, owner + ":refresh"),
            }).toString(),
          },
          signal,
        );
      } catch (e) {
        if (e instanceof OrbitError && e.code === "GSC_REAUTH_REQUIRED") {
          await c.query(
            "UPDATE gsc_accounts SET status='REAUTH_REQUIRED',access_cipher=NULL,refresh_cipher=NULL,error_code=$2,updated_at=now() WHERE owner_id=$1",
            [owner, e.code],
          );
          await c.query("COMMIT");
        }
        throw e;
      }
      const token = tokenSchema.parse(body);
      checkScope(token.scope);
      await c.query(
        "UPDATE gsc_accounts SET access_cipher=$2,refresh_cipher=$3,expires_at=$4,error_code=NULL,updated_at=now() WHERE owner_id=$1",
        [
          owner,
          seal(token.access_token, owner + ":access"),
          token.refresh_token
            ? seal(token.refresh_token, owner + ":refresh")
            : row.refresh_cipher,
          new Date(Date.now() + token.expires_in * 1000).toISOString(),
        ],
      );
      await c.query("COMMIT");
      return token.access_token;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async authorized(
    owner: string,
    path: string,
    body: unknown,
    signal: AbortSignal,
  ) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.access(owner, signal, attempt === 1);
      try {
        return await gscHttp(
          this.transport,
          this.transport.api + path,
          {
            method: body === undefined ? "GET" : "POST",
            headers: {
              authorization: "Bearer " + token,
              "content-type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          },
          signal,
        );
      } catch (e) {
        if (e instanceof OrbitError && e.code === "GSC_UNAUTHORIZED") {
          if (attempt === 0) continue;
          await (
            await db()
          ).query(
            "UPDATE gsc_accounts SET status='REAUTH_REQUIRED',access_cipher=NULL,refresh_cipher=NULL,error_code='GSC_UNAUTHORIZED' WHERE owner_id=$1",
            [owner],
          );
        }
        throw e;
      }
    }
    throw new GscError("GSC_UNAUTHORIZED");
  }
  async revoke(owner: string, signal: AbortSignal) {
    const pool = await db();
    const row = (
      await pool.query(
        "UPDATE gsc_accounts SET status='REVOKE_PENDING',verified_at=NULL,properties='[]',updated_at=now() WHERE owner_id=$1 AND kind=$2 RETURNING *",
        [owner, this.transport.kind],
      )
    ).rows[0];
    if (!row) {
      if (
        (
          await pool.query(
            "SELECT owner_id FROM gsc_accounts WHERE owner_id=$1",
            [owner],
          )
        ).rowCount
      )
        throw new OrbitError("GSC_DISCONNECTED");
      return { status: "DISCONNECTED" };
    }
    const cipher = row.refresh_cipher ?? row.access_cipher;
    if (cipher)
      await gscHttp(
        this.transport,
        this.transport.revoke,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: unseal(
              cipher,
              owner + (row.refresh_cipher ? ":refresh" : ":access"),
            ),
          }).toString(),
        },
        signal,
      );
    const revoked = await pool.query(
      "UPDATE gsc_accounts SET status='REVOKED',access_cipher=NULL,refresh_cipher=NULL,expires_at=NULL,error_code=NULL,updated_at=now() WHERE owner_id=$1 AND status='REVOKE_PENDING' AND refresh_cipher IS NOT DISTINCT FROM $2 AND access_cipher IS NOT DISTINCT FROM $3",
      [owner, row.refresh_cipher, row.access_cipher],
    );
    if (revoked.rowCount !== 1) throw new OrbitError("CONFLICT");
    return { status: "REVOKED" };
  }
  async status(owner: string) {
    const row = (
      await (
        await db()
      ).query(
        "SELECT status,kind,scope,expires_at,properties,verified_at,error_code,updated_at FROM gsc_accounts WHERE owner_id=$1",
        [owner],
      )
    ).rows[0];
    return {
      configured: oauthReady(),
      ...(row ?? {
        status: "DISCONNECTED",
        kind: "UNVERIFIED",
        properties: [],
      }),
    };
  }
}
function hashChallenge(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}
