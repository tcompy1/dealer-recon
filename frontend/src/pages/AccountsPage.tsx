import { useEffect, useState } from "react";

import { getAccountDetail, listAccountSummaries } from "../api/accounts";
import type { AccountDetail, AccountSummary, AccountTransaction } from "../types/account";

type AccountDetailSection = "boa" | "dealertrack" | "exceptions";

const accountDetailSections: Array<{ id: AccountDetailSection; label: string }> = [
  { id: "boa", label: "BOA" },
  { id: "dealertrack", label: "Dealertrack" },
  { id: "exceptions", label: "Unresolved exceptions" },
];

export function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AccountDetail | null>(null);
  const [loadingAccount, setLoadingAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadInitialAccounts() {
      setError(null);
      try {
        const summaries = await listAccountSummaries();
        setAccounts(summaries);
        if (summaries[0]) {
          setLoadingAccount(summaries[0].account_identifier);
          setSelectedAccount(await getAccountDetail(summaries[0].account_identifier));
          setLoadingAccount(null);
        }
      } catch (loadError) {
        setLoadingAccount(null);
        setError(loadError instanceof Error ? loadError.message : "Accounts could not be loaded.");
      }
    }

    void loadInitialAccounts();
  }, []);

  async function loadAccountDetail(accountIdentifier: string) {
    setLoadingAccount(accountIdentifier);
    setError(null);
    try {
      setSelectedAccount(await getAccountDetail(accountIdentifier));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Account detail could not be loaded.");
    } finally {
      setLoadingAccount(null);
    }
  }

  return (
    <section className="grid gap-6">
      {error ? <ErrorBanner message={error} /> : null}
      <section className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-950">Accounts</h2>
        </div>
        <AccountsSummaryTable
          accounts={accounts}
          loadingAccount={loadingAccount}
          selectedAccountIdentifier={selectedAccount?.account_identifier ?? null}
          onSelect={(accountIdentifier) => void loadAccountDetail(accountIdentifier)}
        />
      </section>

      {selectedAccount ? <AccountDetailPanel account={selectedAccount} /> : null}
    </section>
  );
}

function AccountsSummaryTable({
  accounts,
  selectedAccountIdentifier,
  loadingAccount,
  onSelect,
}: {
  accounts: AccountSummary[];
  selectedAccountIdentifier: string | null;
  loadingAccount: string | null;
  onSelect: (accountIdentifier: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 font-semibold">Account</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold">Source totals</th>
            <th className="px-3 py-2 font-semibold">Net difference</th>
            <th className="px-3 py-2 font-semibold">Unresolved</th>
            <th className="px-3 py-2 font-semibold">Selection</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {accounts.length === 0 ? (
            <tr>
              <td className="px-3 py-3 text-slate-600" colSpan={6}>
                No account activity.
              </td>
            </tr>
          ) : (
            accounts.map((account) => {
              const isLoading = loadingAccount === account.account_identifier;
              const isSelected = selectedAccountIdentifier === account.account_identifier;
              return (
                <tr
                  className={isSelected ? "bg-cyan-50" : ""}
                  key={`${account.account_identifier}-${account.account_type}`}
                >
                  <td className="px-3 py-2 font-medium text-slate-950">
                    {account.account_identifier}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{formatLabel(account.account_type)}</td>
                  <td className="px-3 py-2 text-slate-700">
                    <SourceTotals totals={account.source_totals} />
                  </td>
                  <td className="px-3 py-2">
                    <span className={differenceClassName(account.net_difference_amount_cents)}>
                      {formatCurrency(account.net_difference_amount_cents)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {account.unresolved_exception_count}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      className={
                        isSelected
                          ? "inline-flex h-9 items-center justify-center rounded-md border border-cyan-300 bg-cyan-50 px-3 text-sm font-semibold text-cyan-900"
                          : "inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                      }
                      disabled={isLoading || isSelected}
                      type="button"
                      onClick={() => onSelect(account.account_identifier)}
                    >
                      {isLoading ? "Opening..." : isSelected ? "Selected" : "Open"}
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function AccountDetailPanel({ account }: { account: AccountDetail }) {
  const [activeSection, setActiveSection] = useState<AccountDetailSection>("boa");
  const boaTransactions = account.transactions_by_source_type.boa ?? [];
  const dealertrackTransactions = account.transactions_by_source_type.dealertrack ?? [];

  function sectionCount(section: AccountDetailSection) {
    if (section === "boa") {
      return boaTransactions.length;
    }
    if (section === "dealertrack") {
      return dealertrackTransactions.length;
    }
    return account.unresolved_exceptions.length;
  }

  return (
    <section className="grid gap-5 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-950">{account.account_identifier}</h2>
        <p className="text-sm text-slate-600">{formatLabel(account.account_type)}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Net difference" value={formatCurrency(account.net_difference_amount_cents)} />
        <Metric label="Unresolved" value={account.unresolved_exception_count} />
        <Metric label="Sources" value={account.source_totals.length} />
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Account detail sections">
        {accountDetailSections.map((section) => {
          const isActive = activeSection === section.id;
          return (
            <button
              aria-selected={isActive}
              className={
                isActive
                  ? "inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white"
                  : "inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              }
              key={section.id}
              role="tab"
              type="button"
              onClick={() => setActiveSection(section.id)}
            >
              {section.label} ({sectionCount(section.id)})
            </button>
          );
        })}
      </div>

      {activeSection === "boa" ? (
        <SourceTransactionsSection title="BOA" transactions={boaTransactions} />
      ) : null}
      {activeSection === "dealertrack" ? (
        <SourceTransactionsSection title="Dealertrack" transactions={dealertrackTransactions} />
      ) : null}
      {activeSection === "exceptions" ? (
        <UnresolvedExceptions exceptions={account.unresolved_exceptions} />
      ) : null}
    </section>
  );
}

function SourceTransactionsSection({
  title,
  transactions,
}: {
  title: string;
  transactions: AccountTransaction[];
}) {
  return (
    <div className="grid gap-2" role="tabpanel">
      <h3 className="text-base font-semibold text-slate-950">{title}</h3>
      <TransactionsTable
        transactions={transactions}
        emptyMessage={`No ${title} transactions.`}
      />
    </div>
  );
}

function TransactionsTable({
  transactions,
  emptyMessage,
}: {
  transactions: AccountTransaction[];
  emptyMessage: string;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 font-semibold">Date</th>
            <th className="px-3 py-2 font-semibold">Amount</th>
            <th className="px-3 py-2 font-semibold">Reference</th>
            <th className="px-3 py-2 font-semibold">Stock</th>
            <th className="px-3 py-2 font-semibold">VIN</th>
            <th className="px-3 py-2 font-semibold">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {transactions.length === 0 ? (
            <tr>
              <td className="px-3 py-3 text-slate-600" colSpan={6}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td className="px-3 py-2 text-slate-700">
                  {transaction.transaction_date ?? transaction.post_date ?? "n/a"}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {formatCurrency(transaction.amount_cents)}
                </td>
                <td className="px-3 py-2 text-slate-700">{transaction.reference_number ?? "n/a"}</td>
                <td className="px-3 py-2 text-slate-700">{transaction.stock_number ?? "n/a"}</td>
                <td className="px-3 py-2 text-slate-700">{transaction.vin ?? "n/a"}</td>
                <td className="px-3 py-2 text-slate-700">{transaction.description ?? "n/a"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function UnresolvedExceptions({ exceptions }: { exceptions: AccountDetail["unresolved_exceptions"] }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-base font-semibold text-slate-950">Unresolved exceptions</h3>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-semibold">Placement</th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Amount</th>
              <th className="px-3 py-2 font-semibold">Research prompt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {exceptions.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-slate-600" colSpan={4}>
                  No unresolved exceptions.
                </td>
              </tr>
            ) : (
              exceptions.map((exception) => (
                <tr key={exception.exception_id}>
                  <td className="px-3 py-2 font-medium text-slate-950">
                    {formatExceptionPlacement(exception)}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{exception.source_type.toUpperCase()}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {formatCurrency(exception.transaction.amount_cents)}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{neutralExceptionPrompt(exception)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function exceptionPlacement(
  exception: AccountDetail["unresolved_exceptions"][number],
): "statement" | "schedule" | "manual_review" {
  if (
    exception.exception_type === "needs_review_vin6_only" ||
    exception.exception_category === "vin6_match_amount_mismatch"
  ) {
    return "manual_review";
  }
  if (exception.exception_type === "missing_in_dealertrack" || exception.source_type === "boa") {
    return "statement";
  }
  return "schedule";
}

function formatExceptionPlacement(exception: AccountDetail["unresolved_exceptions"][number]) {
  const placement = exceptionPlacement(exception);
  if (placement === "statement") {
    return "On statement-not on GL";
  }
  if (placement === "schedule") {
    return "On schedule-not on statement";
  }
  return "Needs manual review";
}

function neutralExceptionPrompt(exception: AccountDetail["unresolved_exceptions"][number]) {
  const placement = exceptionPlacement(exception);
  if (placement === "statement") {
    return "BOA statement row with no matching Dealertrack/GL row";
  }
  if (placement === "schedule") {
    return "Dealertrack/GL row with no matching BOA statement row";
  }
  return "VIN appears on both sides but amount differs; review manually";
}

function SourceTotals({ totals }: { totals: AccountSummary["source_totals"] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {totals.map((total) => (
        <span
          className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
          key={total.source_type}
        >
          {total.source_type.toUpperCase()} {formatCurrency(total.amount_cents)}
        </span>
      ))}
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
