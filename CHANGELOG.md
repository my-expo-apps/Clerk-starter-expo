# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-18

### Added

- Expo Router app scaffold with a unified, themed auth screen (sign-in/sign-up tabs) compatible with Expo Go and Web.
- Runtime secrets layer (SecureStore on native + localStorage on web) so app secrets are not bundled at build time.
- Supabase Edge functions for Clerk JWT verification and automated bootstrap.
- Database bootstrap RPCs:
  - `public.bootstrap_install()` to safely install required tables, RLS, policies, triggers, and indexes.
  - `public.bootstrap_status()` to provide stable, structured introspection for health checks.

### Security

- Deterministic identity mapping (UUIDv5) and stateless Custom JWT federation (no magic links/OTP).
- RLS-first data model aligned with `auth.uid()` for tenant isolation.
- Bootstrap RPCs are **permission-restricted** (EXECUTE only for `service_role`).

### Developer Experience

- `npm run validate` CLI validator with clear ✔/✖ report and non-zero exit code when not ready.
- Public release docs: `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE`, `CODE_OF_CONDUCT.md`.
- `.env.template` for local validation setup (no real secrets).

