import type { AuthErrorDetails } from "@/lib/auth-errors";

export function AuthErrorAlert({ error }: { error: AuthErrorDetails }) {
  return <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
    <p>{error.message}</p>
    <p className="mt-1.5 text-[10px] text-red-200/80">
      Error code: <code className="font-mono">{error.code}</code>
      {error.requestId && <> · Reference ID: <code className="font-mono">{error.requestId}</code></>}
    </p>
  </div>;
}
