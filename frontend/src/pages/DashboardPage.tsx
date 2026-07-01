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
        <header className="forge-product-header">
          <div className="forge-product-header-main">
            <div className="forge-brand-lockup">
              <span className="forge-brand-mark" aria-hidden="true">DR</span>
              <div className="forge-page-header">
                <p className="forge-brand-kicker">Forge Operations</p>
                <h1 className="forge-page-title">Store/month floorplan workflow</h1>
                <p className="forge-copy max-w-3xl">
                  Upload raw BOA and Dealertrack files, process the selected store's workflow,
                  then download that run's merged spreadsheet and FP REC.
                </p>
              </div>
            </div>
            <div className="forge-product-header-meta" aria-label="Workflow context">
              <span>Dealer-Recon v1</span>
              <span>Floorplan workstation</span>
              <span>Five-step flow</span>
            </div>
          </div>
        </header>
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
