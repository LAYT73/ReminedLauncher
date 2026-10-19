import { useRouteError } from "react-router";

/** Last-resort screen when a route throws while rendering. */
export function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <section className="section">
      <h2 className="page-title">Something broke</h2>
      <p className="friends-lead">{message}</p>
      <button type="button" className="btn-mc ok" onClick={() => window.location.reload()}>
        Reload launcher
      </button>
    </section>
  );
}
