import Link from "next/link";

/**
 * Candidate portal landing (public). The read-only transparency portal is
 * f-137 — until it ships this page just explains what will live here. The
 * client principal + RLS paths already exist server-side.
 */
export default function PortalPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <span className="label">fyj</span>
        <h1 className="mt-2 text-xl font-semibold">Candidate portal</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          A read-only view of your application pipeline — every match, application and interview
          your operator runs on your behalf, with a feedback channel on each one. Coming soon;
          your operator will send an invite when it opens.
        </p>
        <Link
          href="/sign-in"
          className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
        >
          Operator sign-in →
        </Link>
      </div>
    </div>
  );
}
