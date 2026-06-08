import { Layout } from "../components/Layout";
import { WorkflowDashboard } from "../components/WorkflowDashboard";
import type { CurrentUser } from "../types/auth";

export function DashboardPage({
  currentUser,
  embedded = false,
}: {
  currentUser?: CurrentUser;
  embedded?: boolean;
}) {
  const content = (
    <section className={embedded ? "grid gap-8" : "grid flex-1 content-start gap-8 py-8"}>
      {!embedded ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-cyan-700">Dealer Recon</p>
          <h1 className="text-3xl font-semibold text-slate-950">Monthly reconciliation workpaper</h1>
          <p className="text-sm text-slate-600">
            Upload your BOA statement and Dealertrack schedule, review what was removed and why,
            then generate the Hurst FP Rec workbook. Every excluded row is fully auditable.
          </p>
        </div>
      ) : null}

      <WorkflowDashboard currentUser={currentUser} />
    </section>
  );

  if (embedded) {
    return content;
  }

  return (
    <Layout>
      {content}
    </Layout>
  );
}
