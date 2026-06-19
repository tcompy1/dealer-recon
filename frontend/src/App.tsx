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
          <p className="forge-copy font-semibold">Checking session...</p>
        </section>
      </Layout>
    );
  }

  if (!currentUser) {
    return <LoginPage onLogin={setCurrentUser} />;
  }

  return (
    <Layout>
      <section className="forge-page-stack">
        <div className="grid gap-3">
          <div className="forge-page-header">
            <p className="forge-eyebrow">Dealer Recon</p>
            <h1 className="forge-page-title">
              {section === "reconciliation"
                ? "Store/month floorplan workflow"
                : section === "accounts"
                  ? "Account close support"
                  : "Month-end reports"}
            </h1>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Application sections">
            <NavButton
              active={section === "reconciliation"}
              label="Reconciliation"
              onClick={() => setSection("reconciliation")}
            />
            <details className="relative" open={section !== "reconciliation"}>
              <summary className="forge-button-secondary cursor-pointer">
                Advanced tools
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
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
              </div>
            </details>
          </nav>
        </div>
        <div className="forge-context-strip flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <span className="forge-eyebrow text-slate-500">Signed in</span>
            <span className="text-sm font-semibold text-slate-900">{currentUser.email}</span>
            <span className="text-xs text-slate-600">{formatRole(currentUser.role)}</span>
          </div>
          <button
            className="forge-button-secondary"
            type="button"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>

        {section === "reconciliation" ? <DashboardPage currentUser={currentUser} embedded /> : null}
        {section === "accounts" ? <AccountsPage /> : null}
        {section === "reports" ? <ReportsPage currentUser={currentUser} /> : null}
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
      className={active ? "forge-button-primary" : "forge-button-secondary"}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}
