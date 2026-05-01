import { Layout } from "../components/Layout";

export function DashboardPage() {
  return (
    <Layout>
      <section className="flex flex-1 flex-col justify-center gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-cyan-700">
            Dealer Recon
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-normal text-slate-950">
            Reconciliation workspace
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            Upload-based accounting reconciliation for dealer groups. The scaffold is ready for
            file ingestion, exception review, and close support workflows.
          </p>
        </div>
      </section>
    </Layout>
  );
}
