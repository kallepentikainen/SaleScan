import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// No StrictMode: its double-mounted effects would open the microphone twice
// and send duplicate (billed) analysis requests in development.
createRoot(document.getElementById("root")!).render(<App />);
