/* Route: /multi-agent — the Multi-Agent Review page (Configure run + results
   + disagreement panel). Thin route entry — the view, its fetch/state,
   styles, constants, helpers and i18n are colocated under
   _components/MultiAgentReviewPage, mirroring the /eval route. Wrapped in
   Suspense because the container reads useSearchParams() (Next 15 requires a
   Suspense boundary around any client-hook usage of it during static
   rendering). */
import React from "react";
import { MultiAgentReviewPage } from "./_components/MultiAgentReviewPage";

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <MultiAgentReviewPage />
    </React.Suspense>
  );
}
