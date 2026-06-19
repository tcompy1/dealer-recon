import type { ReactNode } from "react";

type LayoutProps = {
  children: ReactNode;
};

export function Layout({ children }: LayoutProps) {
  return (
    <main className="forge-shell">
      <div className="forge-workspace">{children}</div>
    </main>
  );
}
