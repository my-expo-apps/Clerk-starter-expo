# Clerk Starter Expo  SaaS Foundation Evolution (v1.1.0)

Production-ready reference repo that shows how to evolve an Expo + Clerk starter into a full SaaS auth/data foundation.

> **Version:** `v1.1.0`
> 
> This repository is intentionally organized as an architectural progression across branches, from a minimal mobile auth starter to stateless Clerkג†’Supabase federation with RLS-safe data access and release packaging.

---

## What this repository is

This project starts as a lightweight Expo Router app using Clerk authentication, then grows into a hardened SaaS foundation with:

- deterministic app-user identity mapping (UUIDv5)
- custom JWT federation from Clerk to Supabase
- RPC-driven bootstrap on first sign-in
- Postgres schema designed for Row Level Security (RLS)
- CLI validation to verify end-to-end auth/data wiring
- public release packaging for external consumption

If you are building a React Native/Expo SaaS app and want a practical path from "starter" to "production architecture", this repo is designed for exactly that.

---

## Branch evolution map

### `main` ג€” simple starter baseline

Use this branch if you only want to ship Expo + Clerk authentication quickly.

Typical characteristics:

- Expo Router app with auth/home routing
- ClerkProvider and token cache setup
- sign-in/sign-up flows and session handling
- minimal environment configuration (`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`)

Best for:

- prototypes
- internal tools
- teams not yet integrating a database with strict RLS policies

---

### `feat/supabase-prep` ג€” production auth/data foundation

This branch introduces the architectural jump from simple auth to robust identity + data access.

Core additions:

1. **Deterministic identity mapping (UUIDv5)**
   - Converts external auth identity (Clerk user) into a stable internal DB user UUID.
   - Same input always produces the same UUID, so mapping is reproducible and stateless.

2. **Custom JWT federation (Clerk ג†’ Supabase)**
   - Clerk-issued context is transformed into a JWT claim set Supabase can trust.
   - Supabase receives identity + role/subject metadata in a predictable format.

3. **RPC-based bootstrap**
   - First authenticated session triggers server-side initialization via Postgres RPC.
   - Ensures required profile/tenant/membership defaults are created once and idempotently.

4. **RLS-aligned schema design**
   - Tables and ownership relationships are modeled for straightforward RLS policies.
   - Policies can directly rely on authenticated JWT claims and deterministic user IDs.

5. **Validation tooling**
   - CLI validator checks that Clerk, JWT federation, Supabase schema/RPC, and RLS assumptions are aligned.

Best for:

- teams preparing production deployment
- systems requiring strict data isolation and auditable auth paths

---

### `feat/public-release-packaging` ג€” public OSS/release polish

This branch focuses on making the stack consumable by outside developers and teams.

Typical additions:

- release-ready docs and onboarding flow
- environment templates and safer defaults
- repository packaging/cleanup for public usage
- clearer developer UX for setup, bootstrap, and validation

Best for:

- publishing the project publicly
- internal platform handoff
- onboarding multiple teams to the same foundation

---

## Architecture progression (simple explanation)

## 1) Basic Clerk + Expo setup

The app starts with Clerk handling identity and session lifecycle in Expo.

- User signs in via Clerk UI/API.
- App obtains authenticated session state.
- UI routes based on `isSignedIn`.

This is excellent for authentication, but by itself it does not solve DB-side identity modeling and RLS integration for multi-tenant SaaS.

## 2) Deterministic identity mapping (UUIDv5)

In production systems, DB users should usually be represented by UUIDs you control.

UUIDv5 mapping means:

- input: stable external identifier (e.g., Clerk user ID)
- namespace + input ג†’ deterministic UUID output
- same user always maps to same internal UUID

Why this matters:

- no mutable mapping table required for core identity translation
- bootstrap and policy logic become deterministic
- easier interoperability across services/jobs

## 3) Stateless Clerk ג†’ Supabase federation

Instead of maintaining per-session server state, federation is claim-based:

- Clerk identity is converted to a JWT payload Supabase understands.
- Supabase validates token and derives auth context from claims.
- RLS policies use that context directly.

Why this matters:

- scalable and stateless
- transparent policy inputs
- fewer moving parts than custom session stores

## 4) RPC bootstrap

On first successful auth for a user, bootstrap RPC initializes required records (idempotently), such as:

- user profile row
- default tenant/workspace relationship
- baseline membership/roles

Why this matters:

- app clients remain thin
- initialization logic lives near the data
- retries are safe when bootstrap is idempotent

## 5) RLS-aligned data model

The schema is designed so each row is naturally attributable to an authenticated actor/tenant.

This enables simple policies like:

- "user can read rows where `owner_user_id = auth.user_id`"
- "tenant member can read rows where row tenant matches JWT tenant claim"

Why this matters:

- strong data isolation by default
- fewer fragile, ad-hoc authorization checks in app code

## 6) CLI validator

A CLI validator provides fast confidence checks, typically validating:

- environment variables exist and are coherent
- Clerk token claims shape matches Supabase expectations
- required RPCs/tables/policies are present
- bootstrap and identity derivation assumptions hold

Why this matters:

- catches integration drift early
- makes CI/CD gating possible
- improves onboarding for new contributors

---

## Quick start (starter branch flow)

> Use this when beginning from the simplest app experience.

### Prerequisites

- Node.js 20+
- npm
- Expo tooling (`npx expo` is sufficient)
- Clerk account and application

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment

Create `.env` in repository root:

```env
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Never commit secrets. Expo client apps should only use publishable client keys.

### 3) Run app

```bash
npm run start
```

Then open Android, iOS, or Web from Expo CLI.

---

## Recommended Setup Flow (CLI First)

Provisioning is recommended via CLI (repeatable + non-interactive) rather than from the app UI.

### 1) Set provisioning env vars (local shell / CI)

Required:

- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`
- `CLERK_JWT_ISSUER`
- `CLERK_EXPECTED_AUDIENCE`

Optional (used only to generate your local `.env` / `.env.generated`):

- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

### 2) Run provisioning script

```bash
npm run setup-project
```

This will:

- verify Supabase CLI is installed
- `supabase link` (non-interactive via env vars)
- `supabase db push`
- deploy edge functions:
  - `clerk-jwt-verify`
  - `bootstrap-system`
  - `bootstrap-status`
- generate a local `.env` (or `.env.generated` if `.env` already exists)

### 3) Validate (optional)

```bash
npm run validate
```

---

## CLI Modes

### Normal

```bash
npm run setup-project
```

- **Exit 0** on success
- **Exit 1** on any failure

### Dry Run

```bash
npm run setup-project -- --dry-run
```

- Prints what would run
- Does not execute commands
- Does not generate `.env`
- **Exit 0**

### CI Mode

```bash
CI=true npm run setup-project
```

- Non-interactive
- Fails fast on missing requirements / any step failure
- Does **not** generate `.env`
- **Exit 0** on success, **1** on failure

### Health Check

```bash
npm run health-check
```

- Minimal output:
  - Supabase Host: OK/FAIL
  - Edge Function: OK/FAIL
  - RPC: OK/FAIL
  - System Ready: YES/NO
- **Exit 0** if ready, **1** otherwise

---

## Environment Modes

- **dev** → local development
- **staging** → pre-production testing
- **prod** → production deployment

### Env files

Copy `.env.template` to one of:

- `.env.dev`
- `.env.staging`
- `.env.prod`

Then fill in values for that environment.

### CLI usage

- **Setup provisioning for an environment** (default is `dev`):

```bash
npm run setup-project -- --env=staging
```

- **Dry run** (no commands executed, no env files written):

```bash
npm run setup-project -- --env=prod --dry-run
```

- **Health check** against a specific environment:

```bash
npm run health-check -- --env=prod
```

### Expo switching

Set the environment at build/run time:

```env
EXPO_PUBLIC_ENV=dev
```

Your app can later read it via:

- `process.env.EXPO_PUBLIC_ENV`

---

## Advanced setup (Supabase-prep and beyond)

> Follow these steps when moving to the production branch path.

### A) Supabase project setup

1. Create a new Supabase project.
2. Apply the branch SQL migrations/schema.
3. Enable RLS for protected tables.
4. Deploy required bootstrap RPC functions.

### B) Clerk setup for federation

1. Configure JWT template/claims expected by your Supabase verification layer.
2. Ensure required identity claims are present (subject, mapped UUID, tenant/role where applicable).
3. Verify token audience/issuer values match Supabase configuration.

### C) Environment configuration

Add branch-specific env vars (names may vary by branch implementation), commonly:

- Clerk publishable key
- Supabase URL
- Supabase anon key
- JWT/federation settings
- optional namespace/salt identifiers for deterministic UUID mapping

### D) Bootstrap run

1. Sign in as a fresh user.
2. Trigger bootstrap flow.
3. Confirm profile/tenant/membership rows were created once.
4. Re-run to verify idempotency.

### E) Validation

Run the branch CLI validator to confirm end-to-end alignment:

```bash
# Example (use exact command from the target branch)
npm run validate
```

If the validator passes, your identity federation, bootstrap, and RLS assumptions are likely consistent.

---

## How to move from simple ג†’ advanced safely

Recommended adoption path:

1. Start on `main` and verify mobile auth UX.
2. Move to `feat/supabase-prep` to introduce deterministic IDs and data-layer auth.
3. Add/verify RPC bootstrap and RLS policies.
4. Run CLI validation until clean.
5. Move to `feat/public-release-packaging` for docs/release hardening.

This staged approach reduces migration risk and keeps auth/data concerns understandable at each step.

---

## Security notes

- Do not commit `.env` files or secret keys.
- Keep Clerk secret/server keys outside client bundles.
- Prefer short-lived, validated JWTs for federation.
- Treat RLS policies as the final authorization gate.

---

## Suggested developer workflow

1. Implement schema/policy changes in SQL migrations.
2. Run bootstrap path with a new test user.
3. Run validator locally.
4. Smoke test sign-in and protected reads/writes from the app.
5. Promote changes branch-by-branch.

---

## Repository status

- Public release target: **v1.0.0**
- Architecture focus: **Clerk-authenticated Expo SaaS with Supabase RLS alignment**
- Delivery model: **progressive branch evolution from starter to production foundation**

---

## License

Add your preferred OSS/commercial license file and update this section as needed.
