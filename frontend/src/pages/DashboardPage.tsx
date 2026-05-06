import { Layout } from "../components/Layout";
import { WorkflowDashboard } from "../components/WorkflowDashboard";

export function DashboardPage({ embedded = false }: { embedded?: boolean }) {
  const content = (
    <section className={embedded ? "grid gap-8" : "grid flex-1 content-start gap-8 py-8"}>
      {!embedded ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-cyan-700">Dealer Recon</p>
          <h1 className="text-3xl font-semibold text-slate-950">Floorplan reconciliation</h1>
        </div>
      ) : null}

      <WorkflowDashboard />
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
