import { useT } from "@/shared/i18n";
import { useRouteError } from "react-router";

/** Last-resort screen when a route throws while rendering. */
export function RouteError() {
  const t = useT();
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <section className="section">
      <h2 className="page-title">{t("shell.routeError.title")}</h2>
      <p className="friends-lead">{message}</p>
      <button type="button" className="btn-mc ok" onClick={() => window.location.reload()}>
        {t("shell.routeError.reload")}
      </button>
    </section>
  );
}
