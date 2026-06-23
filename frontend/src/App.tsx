import { useEffect, useState } from "react";

import { getMe, logout } from "./api/auth";
import { Layout } from "./components/Layout";
import { AccountsPage } from "./pages/AccountsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { ReportsPage } from "./pages/ReportsPage";
import type { CurrentUser } from "./types/auth";

type AppSection = "workspace" | "accounts" | "reports";

export default function App() {
  const [section, setSection] = useState<AppSection>("workspace");
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

  const sectionTitle =
    section === "workspace"
      ? "Floorplan reconciliation workbench"
      : section === "accounts"
        ? "Account close support"
        : "Month-end reports";
  const sectionContext =
    section === "workspace"
      ? "Station-based FP REC production for store/month floorplan reconciliation."
      : section === "accounts"
        ? "Operational account context for month-end close support."
        : "Month-end reporting output for reconciliation review.";

  return (
    <Layout>
      <section className="forge-page-stack">
        <header className="forge-product-header">
          <div className="forge-product-header-main">
            <div className="forge-brand-lockup">
              <span className="forge-brand-mark" aria-hidden="true">DR</span>
              <div className="forge-page-header">
                <p className="forge-brand-kicker">Forge Operations</p>
                <h1 className="forge-page-title">{sectionTitle}</h1>
                <p className="forge-copy max-w-3xl">{sectionContext}</p>
              </div>
            </div>
            <div className="forge-product-header-meta" aria-label="Workflow context">
              <span>Dealer-Recon v1</span>
              <span>Floorplan workstation</span>
              <span>Store/month stations</span>
            </div>
          </div>
          <nav className="forge-nav-bar" aria-label="Application sections">
            <NavButton
              active={section === "workspace"}
              label="Workspace"
              onClick={() => setSection("workspace")}
            />
            <NavButton
              active={section === "reports"}
              label="Artifacts"
              onClick={() => setSection("reports")}
            />
            <NavButton
              active={section === "accounts"}
              label="Tools"
              onClick={() => setSection("accounts")}
            />
            <details className="relative" open={section !== "workspace"}>
              <summary className="forge-nav-button cursor-pointer">
                Diagnostics
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
        </header>
        <div className="forge-context-strip flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <span className="forge-session-label">Operator session</span>
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

        {section === "workspace" ? <DashboardPage currentUser={currentUser} embedded /> : null}
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
      className={active ? "forge-nav-button forge-nav-button-active" : "forge-nav-button"}
      aria-current={active ? "page" : undefined}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}
