import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ServiceProvider } from "./platform/react.js";
import { createWebServices } from "./services/registry.js";
import { App } from "./App.js";
import "./styles.css";

const services = createWebServices();
const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

createRoot(root).render(
  <StrictMode>
    <ServiceProvider services={services}>
      <App />
    </ServiceProvider>
  </StrictMode>,
);
