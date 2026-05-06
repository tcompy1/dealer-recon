import { useMemo, useState } from "react";

import { getMonthEndReport, getMonthEndReportCsvUrl } from "../api/reports";
import type { MonthEndReport, MonthEndReportAccount } from "../types/report";

export function ReportsPage() {
  const [startDate, setStartDate] = useState(defaultStartDate());
  const [endDate, setEndDate] = useState(defaultEndDate());
  const [report, setReport] = useState<MonthEndReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const csvUrl = useMemo(
    () => getMonthEndReportCsvUrl({ startDate, endDate }),
    [startDate, endDate],
  );

  async function handleGenerateReport() {
    setIsLoading(true);
    setError(null);
    try {
      setReport(await getMonthEndReport({ startDate, endDate }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Report could not be generated.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="grid gap-6">
      <section className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-950">Month-end reports</h2>
        </div>

        <div className="grid gap-3 md:grid-cols-[180px_180px_auto_auto] md:items-end">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Start date
            <input
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            End date
            <input
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-100"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <button
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={isLoading || !startDate || !endDate}
            type="button"
            onClick={() => void handleGenerateReport()}
          >
            {isLoading ? "Generating..." : "Generate report"}
          </button>
          <a
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            download
            href={csvUrl}
          >
            Download CSV
          </a>
        </div>

        {error ? <ErrorBanner message={error} /> : null}
      </section>

      {report ? <ReportResult report={report} /> : null}
    </section>
  );
}

function ReportResult({ report }: { report: MonthEndReport }) {
  return (
    <section className="grid gap-5 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-950">
          {report.reporting_period.start_date} to {report.reporting_period.end_date}
        </h2>
        <p className="text-sm text-slate-600">
          Generated {formatDateTime(report.generated_at)} /{" "}
          {report.reconciliation_runs_included.length} reconciliation runs
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Accounts" value={report.account_summaries.length} />
        <Metric label="Unresolved" value={sumStatus(report.account_summaries, "unresolved")} />
        <Metric label="Net difference" value={formatCurrency(sumNetDifference(report.account_summaries))} />
      </div>

      <ReportTable accounts={report.account_summaries} />
      <IncludedRuns runs={report.reconciliation_runs_included} />
    </section>
  );
}

function ReportTable({ accounts }: { accounts: MonthEndReportAccount[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 font-semibold">Account</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold">BOA</th>
            <th className="px-3 py-2 font-semibold">Dealertrack</th>
            <th className="px-3 py-2 font-semibold">Net difference</th>
            <th className="px-3 py-2 font-semibold">Unresolved</th>
            <th className="px-3 py-2 font-semibold">Resolved</th>
            <th className="px-3 py-2 font-semibold">Ignored</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {accounts.length === 0 ? (
            <tr>
              <td className="px-3 py-3 text-slate-600" colSpan={8}>
                No account activity for this period.
              </td>
            </tr>
          ) : (
            accounts.map((account) => (
              <tr key={`${account.account_identifier}-${account.account_type}`}>
                <td className="px-3 py-2 font-medium text-slate-950">
                  {account.account_identifier}
                </td>
                <td className="px-3 py-2 text-slate-700">{formatLabel(account.account_type)}</td>
                <td className="px-3 py-2 text-slate-700">
                  {formatCurrency(sourceTotal(account, "boa"))}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {formatCurrency(sourceTotal(account, "dealertrack"))}
                </td>
                <td className="px-3 py-2">
                  <span className={differenceClassName(account.net_difference_amount_cents)}>
                    {formatCurrency(account.net_difference_amount_cents)}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {account.unresolved_exception_count}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {account.resolved_exception_count}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {account.ignored_exception_count}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function IncludedRuns({ runs }: { runs: MonthEndReport["reconciliation_runs_included"] }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-base font-semibold text-slate-950">Reconciliation runs included</h3>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Run</th>
              <th className="px-3 py-2 font-semibold">BOA file</th>
              <th className="px-3 py-2 font-semibold">Dealertrack file</th>
              <th className="px-3 py-2 font-semibold">Exceptions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {runs.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-slate-600" colSpan={4}>
                  No reconciliation runs for this period.
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr key={run.reconciliation_run_id}>
                  <td className="px-3 py-2 font-medium text-slate-950">
                    {run.reconciliation_run_id}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{run.boa_filename}</td>
                  <td className="px-3 py-2 text-slate-700">{run.dealertrack_filename}</td>
                  <td className="px-3 py-2 text-slate-700">{run.exception_count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-950">
      {message}
    </div>
  );
}

function sourceTotal(account: MonthEndReportAccount, sourceType: "boa" | "dealertrack") {
  return account.source_totals.find((total) => total.source_type === sourceType)?.amount_cents ?? 0;
}

function sumNetDifference(accounts: MonthEndReportAccount[]) {
  return accounts.reduce((sum, account) => sum + account.net_difference_amount_cents, 0);
}

function sumStatus(accounts: MonthEndReportAccount[], status: "unresolved" | "resolved" | "ignored") {
  return accounts.reduce((sum, account) => sum + account[`${status}_exception_count`], 0);
}

function differenceClassName(amountCents: number) {
  const base = "inline-flex rounded-md px-2 py-1 text-sm font-semibold";
  if (amountCents === 0) {
    return `${base} bg-emerald-100 text-emerald-900`;
  }
  return `${base} bg-amber-100 text-amber-900`;
}

function formatCurrency(amountCents: number) {
  return (amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function defaultStartDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
}

function defaultEndDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
}
