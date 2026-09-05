import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { initObservability } from "./observability/rum";
import { ThemeProvider } from "./theme/theme";
import { AuthProvider } from "./auth";
import App from "./App";
import "./theme/tokens.css";
import "./styles.css";

initObservability();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
