import { useEffect, useState } from "react";

import { getMe, logout } from "./api/auth";
import { Layout } from "./components/Layout";
import { AccountsPage } from "./pages/AccountsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { ReportsPage } from "./pages/ReportsPage";
import type { CurrentUser } from "./types/auth";

type AppSection = "reconciliation" | "accounts" | "reports";

export default function App() {
  const [section, setSection] = useState<AppSection>("reconciliation");
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    let isMounted = true;
    getMe()
      .then((response) => {
        if (isMounted) {
          setCurrentUser(response.user);
        }
      })
      .catch(() => {
        if (isMounted) {
          setCurrentUser(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleLogout() {
    await logout();
    setCurrentUser(null);
  }

  if (isCheckingSession) {
    return (
      <Layout>
        <section className="grid flex-1 place-items-center py-8">
          <p className="text-sm font-semibold text-slate-600">Checking session...</p>
        </section>
      </Layout>
    );
  }

  if (!currentUser) {
    return <LoginPage onLogin={setCurrentUser} />;
  }

  return (
    <Layout>
      <section className="grid flex-1 content-start gap-8 py-8">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-cyan-700">Dealer Recon</p>
            <h1 className="text-3xl font-semibold text-slate-950">
              {section === "reconciliation"
                ? "Monthly reconciliation workpaper"
                : section === "accounts"
                  ? "Account close support"
                  : "Month-end reports"}
            </h1>
          </div>
          <nav className="flex flex-wrap gap-2">
            <NavButton
              active={section === "reconciliation"}
              label="Reconciliation"
              onClick={() => setSection("reconciliation")}
            />
            <NavButton
              active={section === "accounts"}
              label="Accounts"
              onClick={() => setSection("accounts")}
            />
            <NavButton
              active={section === "reports"}
              label="Month-end"
              onClick={() => setSection("reports")}
            />
          </nav>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="grid gap-1">
            <span className="text-xs font-semibold uppercase text-slate-500">Signed in</span>
            <span className="text-sm font-semibold text-slate-900">{currentUser.email}</span>
            <span className="text-xs text-slate-600">{formatRole(currentUser.role)}</span>
          </div>
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            type="button"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>

        {section === "reconciliation" ? <DashboardPage currentUser={currentUser} embedded /> : null}
        {section === "accounts" ? <AccountsPage /> : null}
        {section === "reports" ? <ReportsPage /> : null}
      </section>
    </Layout>
  );
}

function formatRole(value: string) {
  return value.replace(/_/g, " ");
}

function NavButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={
        active
          ? "inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white"
          : "inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
      }
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}
