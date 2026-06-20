import type { ReactNode } from "react";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ICaptureService } from "../../services/captureService.js";
import { CaptureCard } from "./CaptureCard.js";

export function PendingPanel(): ReactNode {
  const { t } = useTranslation();
  const captureService = useService(ICaptureService);
  const captures = useStore(captureService.captures);

  return (
    <section className="panel">
      <h2>{t("pendingTitle")}</h2>
      {captures.length === 0 ? (
        <div className="empty">{t("emptyPending")}</div>
      ) : (
        captures.map((capture) => <CaptureCard key={capture.id} capture={capture} />)
      )}
    </section>
  );
}
