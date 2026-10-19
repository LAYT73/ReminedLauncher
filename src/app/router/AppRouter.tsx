import { RouterProvider } from "react-router";
import { router } from "./routes";

export function AppRouter() {
  return <RouterProvider router={router} />;
}
