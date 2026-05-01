import { Layout } from "../components/Layout";
import { FileUploader } from "../components/FileUploader";
import { ReconciliationSummary } from "../components/ReconciliationSummary";

export function DashboardPage() {
  return (
    <Layout>
      <section className="grid flex-1 content-start gap-8 py-8">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-cyan-700">Dealer Recon</p>
          <h1 className="text-3xl font-semibold tracking-normal text-slate-950">
            Transaction imports
          </h1>
        </div>

        <FileUploader />
        <ReconciliationSummary />
      </section>
    </Layout>
  );
}
