// Dev-only API route for CLI-first provisioning checks.
// Expo Router API routes use the `+api.ts` convention (not Next.js `route.ts`).
//
// This runs only on the local dev server (web). It must never execute in production builds.

type CmdResult = {
  ok: boolean;
  durationMs: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  missingCli?: boolean;
  timedOut?: boolean;
};

function isDevOnly() {
  return process.env.NODE_ENV === 'development';
}

function redactOutput(text: string) {
  // Best-effort redaction: never return keys/tokens/passwords from CLI output.
  let out = text ?? '';

  // Redact obvious key/value lines
  out = out.replace(/^(.*(?:anon|service[_-]?role|jwt|secret|password|token|api key|apikey).*)(:|\s)\s*(.+)$/gim, '$1$2 ***');

  // Redact JWT-like strings
  out = out.replace(/eyJ[a-zA-Z0-9_-]+?\.[a-zA-Z0-9_-]+?\.[a-zA-Z0-9_-]+/g, '***JWT***');

  // Redact Clerk keys in case they appear
  out = out.replace(/\b(pk|sk)_(live|test)_[a-zA-Z0-9]+/g, '***KEY***');

  return out;
}

async function run(cmd: string, timeoutMs: number): Promise<CmdResult> {
  const startedAt = Date.now();
  try {
    const childProcess = await import('node:child_process');
    const util = await import('node:util');
    const exec = util.promisify(childProcess.exec);

    const { stdout, stderr } = await exec(cmd, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 512 * 1024,
      cwd: process.cwd(),
      env: process.env,
    });

    return {
      ok: true,
      durationMs: Date.now() - startedAt,
      stdout: redactOutput(String(stdout ?? '')),
      stderr: redactOutput(String(stderr ?? '')),
    };
  } catch (e) {
    const err = e as any;
    const durationMs = Date.now() - startedAt;
    const code = err?.code;
    const signal = err?.signal;

    const missingCli = code === 'ENOENT' || (typeof err?.message === 'string' && err.message.toLowerCase().includes('not recognized'));
    const timedOut = code === 'ETIMEDOUT' || signal === 'SIGTERM' || String(err?.message ?? '').toLowerCase().includes('timed out');

    return {
      ok: false,
      durationMs,
      exitCode: typeof err?.code === 'number' ? err.code : undefined,
      stdout: redactOutput(String(err?.stdout ?? '')),
      stderr: redactOutput(String(err?.stderr ?? '')),
      error: typeof err?.message === 'string' ? err.message : 'command_failed',
      missingCli,
      timedOut,
    };
  }
}

function parseSupabaseFunctionsList(stdout: string) {
  const lines = stdout
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean);

  // Very defensive parsing: just collect token-ish segments that look like function names.
  // We never rely on exact CLI formatting.
  const names = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^([a-z0-9][a-z0-9_-]{2,})\b/i);
    if (m) names.add(m[1]);
  }
  return [...names];
}

export async function GET() {
  if (!isDevOnly()) {
    return Response.json({ cliAvailable: false, devOnly: true }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  // Tight timeouts; this is a UI helper, not a provisioning runner.
  const timeoutMs = 4000;

  const supabaseStatus = await run('supabase status', timeoutMs);
  const supabaseFunctions = await run('supabase functions list', timeoutMs);
  const clerkStatus = await run('clerk status', timeoutMs);

  const supabaseInstalled = !supabaseStatus.missingCli && !supabaseFunctions.missingCli;
  const clerkInstalled = !clerkStatus.missingCli;
  const cliAvailable = supabaseInstalled && clerkInstalled;

  if (!cliAvailable) {
    return Response.json({ cliAvailable: false }, { headers: { 'cache-control': 'no-store' } });
  }

  // Required functions for this repo.
  const functionNames = supabaseFunctions.ok ? parseSupabaseFunctionsList(supabaseFunctions.stdout ?? '') : [];
  const requiredFunctions = ['clerk-jwt-verify', 'bootstrap-system', 'bootstrap-status'];
  const functionsPresent = requiredFunctions.every((n) => functionNames.includes(n));

  return Response.json(
    {
      cliAvailable: true,
      devOnly: true,
      supabase: {
        status: { ok: supabaseStatus.ok, durationMs: supabaseStatus.durationMs, exitCode: supabaseStatus.exitCode },
        functions: {
          ok: supabaseFunctions.ok,
          durationMs: supabaseFunctions.durationMs,
          exitCode: supabaseFunctions.exitCode,
          requiredFunctions,
          functionsPresent,
          detected: functionNames,
        },
      },
      clerk: {
        status: { ok: clerkStatus.ok, durationMs: clerkStatus.durationMs, exitCode: clerkStatus.exitCode },
      },
      // Include redacted output for debugging in the logs modal (no secrets).
      output: {
        supabaseStatus: { stdout: supabaseStatus.stdout, stderr: supabaseStatus.stderr, error: supabaseStatus.error },
        supabaseFunctions: { stdout: supabaseFunctions.stdout, stderr: supabaseFunctions.stderr, error: supabaseFunctions.error },
        clerkStatus: { stdout: clerkStatus.stdout, stderr: clerkStatus.stderr, error: clerkStatus.error },
      },
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}

