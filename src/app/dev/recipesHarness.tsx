import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router";
import { RecipesPage } from "@/pages/recipes";
import { setLocale } from "@/shared/i18n";
import { useVersionStore } from "@/entities/game-version";
import "@/app/styles/index.css";

const params = new URLSearchParams(window.location.search);
const lang = params.get("lang");
if (lang === "en" || lang === "ru") setLocale(lang);

/** Fakes the sidebar selection: the page follows the vanilla version pick (fixture packs vanilla-1.21.1 / vanilla-1.20.1). */
const pick = (v: string) => useVersionStore.getState().select("vanilla", v);
pick(params.get("pack") ?? "1.21.1");

function Harness() {
  const picked = useVersionStore((s) => s.by.vanilla.pick);
  return (
    <main className="content" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "fixed", right: 8, bottom: 8, zIndex: 999, display: "flex", gap: 4 }}>
        {["1.21.1", "1.20.1", "1.19.4"].map((v) => (
          <button key={v} type="button" className={`btn-mc${picked === v ? " ok" : ""}`} onClick={() => pick(v)}>
            {v}
          </button>
        ))}
      </div>
      <RecipesPage />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MemoryRouter initialEntries={["/vanilla/recipes"]}>
      <Harness />
    </MemoryRouter>
  </React.StrictMode>,
);
