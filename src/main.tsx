import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/app/App";
import { FriendToastWindow } from "@/features/presence";
import "@/app/styles/index.css";

const params = new URLSearchParams(window.location.search);
const isFriendToast = params.get("window") === "friend-toast";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isFriendToast ? <FriendToastWindow /> : <App />}
  </React.StrictMode>,
);
