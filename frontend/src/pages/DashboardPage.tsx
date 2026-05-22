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
          <h1 className="text-3xl font-semibold text-slate-950">BOA-first floorplan reconciliation</h1>
          <p className="text-sm text-slate-600">
            Upload the BOA statement and Dealertrack schedule, match by VIN6 + exact amount, and
            export a Hurst FP Rec-style workbook with Schedule Not on Statement and Statement Not on
            GL sections.
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
