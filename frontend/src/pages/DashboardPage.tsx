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
    <section className={embedded ? "grid gap-5" : "forge-page-stack"}>
      {!embedded ? (
        <div className="forge-page-header">
          <p className="forge-eyebrow">Dealer Recon</p>
          <h1 className="forge-page-title">Store/month floorplan workflow</h1>
          <p className="forge-copy max-w-3xl">
            Upload raw BOA and Dealertrack files, process the selected store's workflow, then download
            that run's merged spreadsheet and FP REC.
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
