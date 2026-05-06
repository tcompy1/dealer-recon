import { useState } from "react";

import { Layout } from "./components/Layout";
import { AccountsPage } from "./pages/AccountsPage";
import { DashboardPage } from "./pages/DashboardPage";

type AppSection = "reconciliation" | "accounts";

export default function App() {
  const [section, setSection] = useState<AppSection>("reconciliation");

  return (
    <Layout>
      <section className="grid flex-1 content-start gap-8 py-8">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-cyan-700">Dealer Recon</p>
            <h1 className="text-3xl font-semibold text-slate-950">
              {section === "reconciliation" ? "Floorplan reconciliation" : "Account close support"}
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
          </nav>
        </div>

        {section === "reconciliation" ? <DashboardPage embedded /> : <AccountsPage />}
      </section>
    </Layout>
  );
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
