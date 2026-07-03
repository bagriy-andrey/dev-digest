import { AppShell } from "@/components/app-shell";
import { ConventionsPage } from "./_components/ConventionsPage";

export default function ConventionsRoute() {
  const crumb = [{ label: "Skills Lab" }, { label: "Conventions" }];
  return (
    <AppShell crumb={crumb}>
      <ConventionsPage />
    </AppShell>
  );
}
