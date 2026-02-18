/* eslint-disable no-console */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type Step = { name: string; ok: boolean; detail?: string };

// Load via absolute path to avoid resolution edge-cases when invoked via `node -r ts-node/register -e ...`
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { environments } = require(path.join(process.cwd(), 'config', 'environments.ts'));

type Mode = {
  dryRun: boolean;
  ci: boolean;
  env: EnvironmentKey;
};

type EnvironmentKey = 'dev' | 'staging' | 'prod';

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length ? v.trim() : null;
}

function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function redact(text: string) {
  // Never print secrets. Best-effort redaction for common env var values.
  const secrets = [
    env('SUPABASE_DB_PASSWORD'),
    env('SUPABASE_ANON_KEY'),
    env('SUPABASE_SERVICE_ROLE_KEY'),
    env('SUPABASE_JWT_SECRET'),
  ].filter(Boolean) as string[];

  let out = text;
  for (const s of secrets) {
    if (!s) continue;
    out = out.split(s).join('***');
  }
  return out;
}

function run(cmd: string, args: string[], opts?: { cwd?: string }) {
  const res = spawnSync(cmd, args, {
    cwd: opts?.cwd ?? process.cwd(),
    stdio: 'pipe',
    shell: false,
    encoding: 'utf8',
  });

  if (res.error) throw res.error;
  if (res.status !== 0) {
    // Keep output minimal; redact secrets just in case.
    const out = redact(((res.stdout ?? '') + (res.stderr ?? '')).trim());
    const msg = out ? `${cmd} failed (exit ${res.status}). ${out}` : `${cmd} failed (exit ${res.status}).`;
    throw new Error(msg);
  }
  return (res.stdout ?? '').trim();
}

function hasCli(cmd: string, versionArgs = ['--version']) {
  try {
    const out = run(cmd, versionArgs);
    return { ok: true as const, version: out };
  } catch {
    return { ok: false as const, version: '' };
  }
}

function writeEnvFile(targetPath: string, content: string) {
  fs.writeFileSync(targetPath, content, { encoding: 'utf8' });
}

function safeEnvLine(key: string, value: string) {
  // Avoid newlines; keep it simple.
  const v = value.replace(/\r?\n/g, '');
  return `${key}=${v}`;
}

function userArgs(argv: string[]): string[] {
  const sep = argv.lastIndexOf('--');
  if (sep >= 0) return argv.slice(sep + 1);
  // When invoked via `node -e "require(...)"`, argv looks like: [node, ...userArgs]
  // When invoked via `node script.js`, argv looks like: [node, script, ...userArgs]
  const start = argv[1]?.startsWith('--') ? 1 : 2;
  return argv.slice(start);
}

function parseEnvArg(args: string[]): EnvironmentKey {
  const raw = args.find((a) => a.startsWith('--env='))?.split('=')[1]?.trim();
  if (!raw) return 'dev';
  if (raw === 'dev' || raw === 'staging' || raw === 'prod') return raw;
  throw new Error(`Invalid --env=${raw}. Expected dev|staging|prod.`);
}

function loadEnvFileIfPresent(envFile: string) {
  const p = path.join(process.cwd(), envFile);
  if (!fs.existsSync(p)) return false;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv');
  dotenv.config({ path: p, override: false });
  return true;
}

function parseArgs(argv: string[]): Mode {
  const args = userArgs(argv);
  const dryRun = args.includes('--dry-run');
  const ci = env('CI') === 'true';
  const envKey = parseEnvArg(args);
  return { dryRun, ci, env: envKey };
}

function wouldRun(cmd: string, args: string[]) {
  // Redact obvious sensitive flags (password value)
  const redacted = args.map((a, i) => {
    if (args[i - 1] === '--password') return '***';
    return a;
  });
  return `Would run: ${cmd} ${redacted.join(' ')}`;
}

async function main() {
  const steps: Step[] = [];
  const push = (s: Step) => steps.push(s);

  const mode = parseArgs(process.argv);
  const envProfile = environments[mode.env];

  // Load selected env file (if present) so provisioning can be per-environment.
  // Never prints the file contents.
  const loaded = loadEnvFileIfPresent(envProfile.envFile);
  push({
    name: `load env file: ${envProfile.envFile}`,
    ok: true,
    detail: loaded ? 'loaded' : 'not found (using process.env)',
  });

  if (mode.dryRun) {
    console.log('[DRY RUN]');
    console.log(`- Target env: ${mode.env} (${envProfile.envFile})`);
    console.log('- ' + wouldRun('supabase', ['link', '--project-ref', env('SUPABASE_PROJECT_REF') ?? '<SUPABASE_PROJECT_REF>', '--password', '***']));
    console.log('- ' + wouldRun('supabase', ['db', 'push']));
    console.log('- Would deploy: clerk-jwt-verify');
    console.log('- Would deploy: bootstrap-system');
    console.log('- Would deploy: bootstrap-status');
    console.log(`- Would generate: ${envProfile.envFile} (skipped in dry-run)`);
    process.exit(0);
  }

  const supabase = hasCli('supabase', ['--version']);
  push({ name: 'Supabase CLI installed', ok: supabase.ok, detail: supabase.ok ? supabase.version : 'Install: https://supabase.com/docs/guides/cli' });
  if (!supabase.ok) return finish(steps, 1);

  const clerk = hasCli('clerk', ['--version']);
  push({
    name: 'Clerk CLI installed',
    ok: clerk.ok,
    detail: clerk.ok ? clerk.version : 'Install: https://clerk.com/docs (CLI)',
  });
  // Clerk CLI is optional for now; we validate issuer/audience via env.

  let projectRef: string;
  let dbPassword: string;
  let clerkIssuer: string;
  let clerkAudience: string;

  try {
    projectRef = requireEnv('SUPABASE_PROJECT_REF');
  } catch {
    push({ name: 'env: SUPABASE_PROJECT_REF', ok: false, detail: 'Missing SUPABASE_PROJECT_REF' });
    return finish(steps, 1);
  }
  try {
    dbPassword = requireEnv('SUPABASE_DB_PASSWORD');
  } catch {
    push({ name: 'env: SUPABASE_DB_PASSWORD', ok: false, detail: 'Missing SUPABASE_DB_PASSWORD' });
    return finish(steps, 1);
  }
  try {
    clerkIssuer = requireEnv('CLERK_JWT_ISSUER');
  } catch {
    push({ name: 'env: CLERK_JWT_ISSUER', ok: false, detail: 'Missing CLERK_JWT_ISSUER' });
    return finish(steps, 1);
  }
  try {
    clerkAudience = requireEnv('CLERK_EXPECTED_AUDIENCE');
  } catch {
    push({ name: 'env: CLERK_EXPECTED_AUDIENCE', ok: false, detail: 'Missing CLERK_EXPECTED_AUDIENCE' });
    return finish(steps, 1);
  }

  // Basic validation (no secrets printed)
  try {
    // eslint-disable-next-line no-new
    new URL(clerkIssuer);
    push({ name: 'Clerk JWT issuer valid URL', ok: true });
  } catch {
    push({ name: 'Clerk JWT issuer valid URL', ok: false, detail: 'CLERK_JWT_ISSUER is not a valid URL' });
    return finish(steps, 1);
  }

  push({ name: 'Clerk expected audience present', ok: !!clerkAudience });

  // Link (non-interactive)
  try {
    run('supabase', ['link', '--project-ref', projectRef, '--password', dbPassword]);
    push({ name: 'supabase link', ok: true });
  } catch (e) {
    push({ name: 'supabase link', ok: false, detail: (e as Error).message });
    return finish(steps, 1);
  }

  // Push migrations
  try {
    run('supabase', ['db', 'push']);
    push({ name: 'supabase db push', ok: true });
  } catch (e) {
    push({ name: 'supabase db push', ok: false, detail: (e as Error).message });
    return finish(steps, 1);
  }

  // Deploy edge functions (no-verify-jwt because we validate ourselves)
  const functions = ['clerk-jwt-verify', 'bootstrap-system', 'bootstrap-status'];
  for (const fn of functions) {
    try {
      run('supabase', ['functions', 'deploy', fn, '--no-verify-jwt']);
      push({ name: `deploy function: ${fn}`, ok: true });
    } catch (e) {
      push({ name: `deploy function: ${fn}`, ok: false, detail: (e as Error).message });
      return finish(steps, 1);
    }
  }

  // Generate .env (for local dev only; do not commit)
  if (mode.ci) {
    push({ name: `generate ${envProfile.envFile}`, ok: true, detail: 'skipped (CI=true)' });
    return finish(steps, 0);
  }

  const repoRoot = process.cwd();
  const envPath = path.join(repoRoot, envProfile.envFile);
  const already = fs.existsSync(envPath);
  const outPath = already ? path.join(repoRoot, `${envProfile.envFile}.generated`) : envPath;

  const publishableKey = env('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY') ?? 'pk_test_...';
  const supabaseUrl = env('SUPABASE_URL') ?? 'https://YOUR-PROJECT-REF.supabase.co';
  const supabaseAnonKey = env('SUPABASE_ANON_KEY') ?? 'YOUR_SUPABASE_ANON_KEY';

  const content = [
    '# Generated by scripts/setup-project.ts',
    '# Do not commit this file.',
    '',
    safeEnvLine('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY', publishableKey),
    '',
    safeEnvLine('SUPABASE_URL', supabaseUrl),
    safeEnvLine('SUPABASE_ANON_KEY', supabaseAnonKey),
    '',
    safeEnvLine('CLERK_JWT_ISSUER', clerkIssuer),
    safeEnvLine('CLERK_EXPECTED_AUDIENCE', clerkAudience),
    '',
  ].join('\n');

  try {
    writeEnvFile(outPath, content);
    push({
      name: `generate ${path.basename(outPath)}`,
      ok: true,
      detail: already ? `Existing ${envProfile.envFile} detected; wrote ${path.basename(outPath)} instead.` : undefined,
    });
  } catch (e) {
    push({ name: 'generate .env', ok: false, detail: (e as Error).message });
    return finish(steps, 1);
  }

  return finish(steps, 0);
}

function finish(steps: Step[], exitCode: number) {
  for (const s of steps) {
    const icon = s.ok ? '✔' : '✖';
    const suffix = s.detail ? ` — ${s.detail}` : '';
    console.log(`${icon} ${s.name}${suffix}`);
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('✖ setup-project: unexpected error');
  console.error((e as Error).message);
  process.exit(1);
});

