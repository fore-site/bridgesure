# Bridging BridgeSure to the public web: Vercel (frontend) + Render (backend)

Two apps, one pnpm monorepo, two hosts:

- **apps/web** (Next.js) -> **Vercel** (static/serverless frontend)
- **apps/api** (Node.js/Fastify) -> **Render** (long-running web service)

The web is a public browser client; it talks to the API over HTTPS. The API is the only
component that talks to Cleanverse, holds the signer key, and persists the trade registry.

> Both hosts build from the same repo. `dist/` for the `packages/*` workspace packages is
> gitignored, so **every build must compile `@bridgesure/domain` and `@bridgesure/cleanverse`
> first** before the app builds. The recipes below bake that in.

---

## 1. Cross-link the two hosts (do this first)

| Host | Set env var | Value |
| --- | --- | --- |
| **Render (API)** | `BRIDGESURE_WEB_ORIGIN` | your Vercel frontend URL, e.g. `https://my-app.vercel.app` |
| **Vercel (web)** | `NEXT_PUBLIC_BRIDGESURE_API_URL` | your Render service URL, e.g. `https://bridgesure-api.onrender.com` |

- `NEXT_PUBLIC_*` is baked into the web at **build** time — re-deploy Vercel after you know the
  Render URL.
- The API enforces CORS against `BRIDGESURE_WEB_ORIGIN` exactly; if these don't match, the
  browser will be silently blocked from calling the API. Use the full origin with no trailing slash.

---

## 2. Render — the backend (`apps/api`)

Create a **Web Service**, connect the GitHub/GitLab repo.

**Runtime**
- Environment: **Node**.
- Node version: keep the repo's `.nvmrc` (`24`). Render reads it. Node 22 also builds (it emits
  an "unsupported engine" warning only).

**Directories & commands** (Root Directory = repo root, `.`)

- **Install command:**
  `corepack enable && corepack prepare pnpm@11.20.0 --activate && pnpm install --frozen-lockfile`
- **Build command:** (compile the workspace packages the API imports; `dist/` is gitignored)
  `pnpm --filter @bridgesure/domain build && pnpm --filter @bridgesure/cleanverse build`
- **Start command:**
  `pnpm --filter @bridgesure/api start`
- **Health check path:** `/health`

> `apps/api/package.json#start` is `tsx src/main.ts`, so no API compile step is needed. The
> server binds `0.0.0.0` on `BRIDGESURE_PORT`.

**Port — important.** Render injects a `PORT` variable, but BridgeSure reads
`BRIDGESURE_PORT` (default `4000`). Set:

- `BRIDGESURE_PORT=10000` (Render's default exposed port for web services)

**Environment variables** — the API **requires** these to boot (config is zod-validated; a
missing one exits on startup):

| Variable | Value |
| --- | --- |
| `CLEANVERSE_API_ID`, `CLEANVERSE_API_KEY` | REQUIRED even in demo mode (a placeholder works for demo; real values for live) |
| `BRIDGESURE_CLEANVERSE_MODE` | `demo` (default; no network) or `live` (real Cleanverse) |
| `BRIDGESURE_IMPORTER_ADDRESS` | `0x4aa29d0188d81A39cBd2BF11C1791aF3fF294E3A` |
| `BRIDGESURE_EXPORTER_ADDRESS` | `0xaABb93dA3999765dD48a40d70054190AE3361506` |
| `BRIDGESURE_ADMIN_ADDRESS` | `0x13cd068321C624d63C4A1d0eA2eBd806c22B9FA7` |
| `BRIDGESURE_ATOKEN_ADDRESS` | `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` (aUSDC) |
| `BRIDGESURE_VALIDATOR_ADDRESS` | `0xaC7e5179C2C7f03f209136886c172eb34F161792` |
| `BRIDGESURE_RELEASE_SIGNER_PRIVATE_KEY` | a demo signer key (`0x` + 64 hex). Generate with `cast wallet new`; never commit it. |
| `NEXT_PUBLIC_...`s are NOT needed on Render | — |

**Persistence (recommended):** Render's disk is ephemeral. The default SQLite registry
(`./data/bridgesure.sqlite`) works for a demo but resets on redeploy. For a durable audit
trail, add a Postgres connection string (Render Postgres, Supabase, Neon) and set one of:

- `DATABASE_URL=postgresql://...` — selects the postgres driver automatically (TLS auto-enabled
  for Supabase hosts / `sslmode=require`), or
- `BRIDGESURE_DB_URL=...` (alternative name).

Optional live-only keys (only if you run real on-chain writes from the sandbox): `BRIDGESURE_ESCROW_ADDRESS`,
`BRIDGESURE_VALIDATOR_POOL_ADDRESS`, `BRIDGESURE_DEPLOYER_PRIVATE_KEY`, `BRIDGESURE_IMPORTER_PRIVATE_KEY`,
`BRIDGESURE_VALIDATOR_OWNER_PRIVATE_KEY`. Leave unset for a read-only/demo deployment.

Defaults you can leave alone: `BRIDGESURE_CHAIN_ID=10143`, `BRIDGESURE_RPC_URL=https://testnet-rpc.monad.xyz`,
`BRIDGESURE_TRADE_ID`, milestone amounts, `BRIDGESURE_AUTO_FUND_ENABLED=/BRIDGESURE_AUTO_RELEASE_ENABLED=true`.

Verify: the service boots, `/health` returns `{ "ok": true }`, and `https://<api>.onrender.com/trades`
returns the seeded trade list.

---

## 3. Vercel — the frontend (`apps/web`)

Import the repo into Vercel. It is a pnpm workspace, so Vercel must target the `apps/web` app
and build the `domain` package it imports types from (`dist/` is gitignored).

- **Framework preset:** Next.js (auto-detected)
- **Root Directory:** `apps/web`
- **Install command:** `pnpm install --frozen-lockfile` (Vercel installs at the workspace root)
- **Build command:** `pnpm --filter @bridgesure/domain build && next build`
- **Output/Start:** `next start` (default for Next.js preset)
- **Node version:** `24` (Vercel sets from `.nvmrc`/settings). `22` also works with a warning.

**Environment variables (build-time):**

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_BRIDGESURE_API_URL` | your Render API URL (e.g. `https://bridgesure-api.onrender.com`) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | optional — enables WalletConnect so the dashboard can connect a wallet |

Because the app reads `NEXT_PUBLIC_BRIDGESURE_API_URL` at build time, update it and re-deploy
whenever the Render URL or a custom domain changes.

Verify: `https://<app>.vercel.app` loads the landing page, and the dashboard/trades views reach
the Render API (open devtools -> network; the request to the Render origin must return CORS `allow`
headers from `BRIDGESURE_WEB_ORIGIN`).

---

## 4. Cheat sheet

| Concern | Vercel (web) | Render (api) |
| --- | --- | --- |
| Root Directory | `apps/web` | `.` (repo root) |
| Install | `pnpm install --frozen-lockfile` | `corepack ... && pnpm install --frozen-lockfile` |
| Build | `pnpm --filter @bridgesure/domain build && next build` | `pnpm --filter @bridgesure/domain build && pnpm --filter @bridgesure/cleanverse build` |
| Start | `next start` | `pnpm --filter @bridgesure/api start` |
| Port | n/a | `BRIDGESURE_PORT=10000` |
| Key env | `NEXT_PUBLIC_BRIDGESURE_API_URL` | `BRIDGESURE_WEB_ORIGIN`, `CLEANVERSE_API_ID/KEY`, party/validator addresses, `BRIDGESURE_RELEASE_SIGNER_PRIVATE_KEY`, optional `DATABASE_URL` |
| Health | — | `/health` |

**Golden rule:** Render's `BRIDGESURE_WEB_ORIGIN` and Vercel's `NEXT_PUBLIC_BRIDGESURE_API_URL`
must point at each other, else the browser-to-API trust boundary is silently broken.