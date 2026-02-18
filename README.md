# Supabase-Prep — Secure SaaS Auth Foundation (Expo + Clerk + Supabase)

A clone-ready SaaS authentication foundation built on:

- **Runtime secret isolation**
- **Clerk authentication**
- **Deterministic identity mapping (UUIDv5)**
- **Stateless Custom JWT federation**
- **RLS-enforced data isolation**

This is **not** a demo starter.  
It is a production-grade auth blueprint.

## Quick Start

### 1) Clone & install

```bash
git clone <your-repo-url>
cd supabase-prep
npm install
```

### 2) Create Supabase project

Create a new project at [Supabase](https://supabase.com).

Copy:
- **Project URL**
- **Anon public key**

Go to **Project Settings → API** and copy:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`

### 3) Create Clerk project

Create a project at [Clerk](https://clerk.com).

Copy:
- **Publishable key**
- **JWT issuer URL**

In Clerk Dashboard → **JWT Templates**:
- Ensure **audience** is defined (used as `CLERK_EXPECTED_AUDIENCE`)

### 4) Configure Supabase Edge Function env

Set these environment variables in Supabase (Dashboard → Project Settings → Functions → Environment variables):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `CLERK_JWT_ISSUER`
- `CLERK_EXPECTED_AUDIENCE`

Optional:
- `CLERK_JWKS_URL`

### 5) Deploy Edge Function

From project root (requires Supabase CLI):

```bash
supabase functions deploy clerk-jwt-verify --no-verify-jwt
```

For local development:

```bash
supabase functions serve clerk-jwt-verify --no-verify-jwt
```

### 6) Run the app

```bash
npx expo start
```

Open in Expo Go / simulator.

### 7) Configure runtime secrets (inside the app)

Open **Supabase setup** screen.

Enter:
- Supabase URL
- Supabase Anon key
- Clerk Publishable key

Click **Validate & Authorize** and ensure all status badges are green.

### 8) Run RLS bootstrap

In Supabase SQL Editor, run:

```sql
-- file: supabase/bootstrap/rls_base.sql
```

This enables:
- `auth.uid()`-based policies
- Full CRUD isolation
- `updated_at` triggers
- `user_id` indexing

## How it works

### Identity mapping

`supabaseUserId = UUIDv5(clerkUserId)`

Properties:
- Deterministic
- No duplication
- Stateless

### Federation model

- Clerk JWT verified via JWKS
- UUIDv5 derived
- Supabase JWT minted (HS256)
- `auth.uid()` resolves to deterministic UUID

No magic links. No OTP. No email-based identity.

## Security guarantees

- No runtime secret leakage
- Cryptographic JWT verification
- Deterministic identity mapping
- Stateless federation
- RLS fully aligned with JWT
- No email identity assumptions

## Result

- Expo Runtime
- Clerk Auth
- Secure Runtime Secrets
- Deterministic Identity
- Custom JWT Federation
- RLS-Enforced Isolation

**A production-ready SaaS security foundation.**

