# Secure Runtime Expo + Clerk + Supabase Foundation

[![Version](https://img.shields.io/badge/version-1.0.0-blue)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

A **production-oriented** Expo foundation for Clerk authentication + Supabase data isolation with a secure, clone-ready pattern:
**runtime secrets** (no `.env` in the app), deterministic identity mapping, stateless JWT federation, and RLS-enforced multi-tenant isolation.

## Key features

- **Runtime secrets UI** (Expo SecureStore / web localStorage) — no secrets committed in code
- **Clerk auth** with custom email/password UI (works in Expo Go + Web)
- **Deterministic identity mapping** (UUIDv5) from Clerk user IDs
- **Custom JWT federation**: Clerk JWT verified → Supabase JWT minted → `auth.uid()` works with RLS
- **Auto bootstrap**: Edge function can install required DB structure via a permission-restricted RPC
- **Health validation**: CLI script checks Edge + RPC + DB readiness

## Quick start

### 1) Clone & install

```bash
git clone <your-repo-url>
cd clerk-expo-starter
npm install
```

### 2) Supabase setup

- Create a project in Supabase
- Install Supabase CLI and login
- Link the project (optional) and **push migrations**:

```bash
supabase db push
```

#### Edge Functions env vars (Supabase Dashboard)

Set (Project Settings → Functions → Environment variables):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `CLERK_JWT_ISSUER`
- `CLERK_EXPECTED_AUDIENCE`

Optional:
- `CLERK_JWKS_URL`

### 3) Clerk setup

- Create a Clerk project
- Enable **Native** application support
- Copy the **Publishable key** (used in-app at runtime)
- Create/verify a **JWT Template** with an **audience** matching `CLERK_EXPECTED_AUDIENCE`

### 4) Deploy Edge Functions

```bash
supabase functions deploy clerk-jwt-verify --no-verify-jwt
supabase functions deploy bootstrap-system --no-verify-jwt
```

### 5) Run the app

```bash
npx expo start
```

In the app, open the **Setup** screen and enter runtime secrets:

- Supabase URL
- Supabase Anon key
- Clerk Publishable key

Then click **Validate & Authorize**.

## Validate foundation (CLI)

Create a local `.env` for the validator only:

```bash
cp .env.template .env
```

Fill in **Supabase** values (do not commit `.env`), then run:

```bash
npm run validate
```

Exit codes:
- `0` when `bootstrap_status.ready === true`
- `1` otherwise

## Common errors

- **`bootstrap_rpc_missing: run supabase db push`**
  - Your DB migrations weren’t applied yet. Run `supabase db push` and retry validation.

## Security notes

- Do not commit real secrets (use `.env.template` only).
- Edge bootstrap is permission-restricted: RPC execution is granted only to `service_role`.

