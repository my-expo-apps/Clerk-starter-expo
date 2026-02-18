import type { DiagnosticResult } from '@/services/diagnostics-engine';
import { initializeDatabase, validateSystemConnection, type ValidationLogEntry } from '@/services/connection-validator';

export type AutoFixIssue =
  | { code: 'host_unreachable'; message: string; fixable: false }
  | { code: 'edge_not_deployed'; message: string; fixable: false }
  | { code: 'rpc_missing'; message: string; fixable: true }
  | { code: 'schema_missing'; message: string; fixable: true }
  | { code: 'bridge_not_authorized'; message: string; fixable: true };

export type AutoFixProgress =
  | { kind: 'info'; message: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

export type AutoFixResult = {
  attempted: boolean;
  fixed: boolean;
  remainingIssues: AutoFixIssue[];
};

type AutoFixOptions = {
  clerkConnected: boolean;
  onProgress?: (p: AutoFixProgress) => void;
  onLog?: (entry: ValidationLogEntry) => void;
};

function progress(opts: AutoFixOptions | undefined, p: AutoFixProgress) {
  opts?.onProgress?.(p);
}

function isReady(d: DiagnosticResult) {
  return d.connection && d.schemaReady && d.rpcInstalled && d.bridgeReady;
}

function classifyIssues(d: DiagnosticResult, clerkConnected: boolean): AutoFixIssue[] {
  const issues: AutoFixIssue[] = [];

  if (!d.connection) {
    issues.push({ code: 'host_unreachable', message: 'Supabase host unreachable (DNS/network).', fixable: false });
    return issues;
  }

  const edgeNotDeployed =
    d.checks.edgeBootstrapSystem?.kind === 'not_deployed' || d.checks.edgeClerkVerify?.kind === 'not_deployed';
  if (edgeNotDeployed) {
    issues.push({ code: 'edge_not_deployed', message: 'Edge Functions not deployed.', fixable: false });
    return issues;
  }

  if (!d.rpcInstalled) issues.push({ code: 'rpc_missing', message: 'Bootstrap RPC missing.', fixable: true });
  if (!d.schemaReady) issues.push({ code: 'schema_missing', message: 'Schema missing.', fixable: true });
  if (!d.bridgeReady && clerkConnected) issues.push({ code: 'bridge_not_authorized', message: 'Bridge not authorized.', fixable: true });

  return issues;
}

export async function autoFix(diagnostics: DiagnosticResult, opts?: AutoFixOptions): Promise<AutoFixResult> {
  const remainingIssues = classifyIssues(diagnostics, opts?.clerkConnected ?? false);

  if (isReady(diagnostics)) {
    return { attempted: false, fixed: true, remainingIssues: [] };
  }

  if (remainingIssues.length === 0) {
    // Nothing we can act on from current info.
    return { attempted: false, fixed: false, remainingIssues };
  }

  // If first issue is non-fixable, stop early with instructions.
  if (remainingIssues.some((i) => i.fixable === false)) {
    return { attempted: false, fixed: false, remainingIssues };
  }

  progress(opts, { kind: 'info', message: 'Starting auto-fix…' });

  let attempted = false;

  // Fix schema/RPC via bootstrap-system (idempotent)
  if (!diagnostics.rpcInstalled || !diagnostics.schemaReady) {
    attempted = true;
    progress(opts, { kind: 'info', message: 'Installing schema / RPC…' });
    const boot = await initializeDatabase({ onLog: opts?.onLog });
    if (!boot.ok) {
      progress(opts, { kind: 'error', message: boot.errorMessage ?? 'Bootstrap failed.' });
      const after = await validateSystemConnection({ onLog: opts?.onLog });
      const remaining = classifyIssues(
        {
          connection: after.connection,
          schemaReady: after.schemaReady,
          rpcInstalled: after.rpcInstalled,
          bridgeReady: after.bridgeReady,
          errorCode: after.errorCode,
          errorMessage: after.errorMessage,
          // checks may be missing if validation failed early; treat unknown
          checks: (after.checks as any) ?? {
            host: { ok: after.connection, ms: 0 },
            edgeClerkVerify: { ok: false, ms: 0 },
            edgeBootstrapSystem: { ok: false, ms: 0 },
            rpcStatus: { ok: after.rpcInstalled, ms: 0 },
            supabaseJwt: { ok: after.bridgeReady, ms: 0 },
          },
        } as DiagnosticResult,
        opts?.clerkConnected ?? false
      );
      return { attempted, fixed: false, remainingIssues: remaining };
    }
    progress(opts, { kind: 'done', message: 'Schema / RPC installed.' });
  }

  // Re-run bridge authorization if Clerk is connected (this is just another validation pass)
  if (!diagnostics.bridgeReady && (opts?.clerkConnected ?? false)) {
    attempted = true;
    progress(opts, { kind: 'info', message: 'Validating bridge…' });
    const after = await validateSystemConnection({ onLog: opts?.onLog });
    if (after.bridgeReady) {
      progress(opts, { kind: 'done', message: 'Bridge authorized.' });
    } else {
      progress(opts, { kind: 'error', message: after.errorMessage ?? 'Bridge validation failed.' });
    }
  }

  // Final check (no secrets)
  const final = await validateSystemConnection({ onLog: opts?.onLog });
  const fixed = final.connection && final.schemaReady && final.rpcInstalled && final.bridgeReady;

  const finalRemaining = classifyIssues(
    {
      connection: final.connection,
      schemaReady: final.schemaReady,
      rpcInstalled: final.rpcInstalled,
      bridgeReady: final.bridgeReady,
      errorCode: final.errorCode,
      errorMessage: final.errorMessage,
      checks: (final.checks as any) ?? {
        host: { ok: final.connection, ms: 0 },
        edgeClerkVerify: { ok: false, ms: 0 },
        edgeBootstrapSystem: { ok: false, ms: 0 },
        rpcStatus: { ok: final.rpcInstalled, ms: 0 },
        supabaseJwt: { ok: final.bridgeReady, ms: 0 },
      },
    } as DiagnosticResult,
    opts?.clerkConnected ?? false
  );

  return { attempted, fixed, remainingIssues: fixed ? [] : finalRemaining };
}

