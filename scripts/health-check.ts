/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');

// Use require() so this works with `node -r ts-node/register -e "require('./scripts/health-check.ts')"`
// (ts-node/register hooks CommonJS, not Node ESM resolution).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runDiagnostics } = require('../services/diagnostics-engine');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { environments } = require(path.join(process.cwd(), 'config', 'environments.ts'));

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length ? v.trim() : null;
}

function userArgs(argv: string[]) {
  const sep = argv.lastIndexOf('--');
  if (sep >= 0) return argv.slice(sep + 1);
  const start = argv[1]?.startsWith('--') ? 1 : 2;
  return argv.slice(start);
}

function parseEnvArg(argv: string[]) {
  const args = userArgs(argv);
  const raw = args.find((a) => a.startsWith('--env='))?.split('=')[1]?.trim();
  const envKey = raw || 'dev';
  if (envKey !== 'dev' && envKey !== 'staging' && envKey !== 'prod') {
    throw new Error(`Invalid --env=${envKey}. Expected dev|staging|prod.`);
  }
  return envKey;
}

function loadDotEnvIfPresent(envFile: string) {
  const rootEnv = path.join(process.cwd(), envFile);
  if (!fs.existsSync(rootEnv)) return false;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv');
  dotenv.config({ path: rootEnv });
  return true;
}

async function main() {
  let envKey: 'dev' | 'staging' | 'prod' = 'dev';
  try {
    envKey = parseEnvArg(process.argv);
  } catch {
    console.log(`Supabase Host: FAIL`);
    console.log(`Edge Function: FAIL`);
    console.log(`RPC: FAIL`);
    console.log(`System Ready: NO`);
    process.exit(1);
  }

  const envProfile = environments[envKey];
  loadDotEnvIfPresent(envProfile.envFile);

  const supabaseUrl = env('SUPABASE_URL');
  const supabaseAnonKey = env('SUPABASE_ANON_KEY');
  const clerkTestJwt = env('CLERK_TEST_JWT');

  if (!supabaseUrl || !supabaseAnonKey || !clerkTestJwt) {
    console.log(`Supabase Host: FAIL`);
    console.log(`Edge Function: FAIL`);
    console.log(`RPC: FAIL`);
    console.log(`System Ready: NO`);
    process.exit(1);
  }

  const diag = await runDiagnostics({
    supabaseUrl,
    supabaseAnonKey,
    clerkToken: clerkTestJwt,
  });

  const hostOk = diag.checks.host.ok;
  const edgeOk = diag.checks.edgeClerkVerify.ok && diag.checks.edgeBootstrapSystem.ok;
  const rpcOk = diag.checks.rpcStatus.ok;
  const ready = diag.connection && diag.schemaReady && diag.rpcInstalled && diag.bridgeReady;

  console.log(`Supabase Host: ${hostOk ? 'OK' : 'FAIL'}`);
  console.log(`Edge Function: ${edgeOk ? 'OK' : 'FAIL'}`);
  console.log(`RPC: ${rpcOk ? 'OK' : 'FAIL'}`);
  console.log(`System Ready: ${ready ? 'YES' : 'NO'}`);

  process.exit(ready ? 0 : 1);
}

main().catch(() => {
  console.log(`Supabase Host: FAIL`);
  console.log(`Edge Function: FAIL`);
  console.log(`RPC: FAIL`);
  console.log(`System Ready: NO`);
  process.exit(1);
});

