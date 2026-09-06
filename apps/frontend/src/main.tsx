
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  // Before the first render: it decides the language and loads the
  // catalogue, and a component asking for a phrase before this ran would
  // get the key back instead.
  import "./lib/i18n";
  import "./styles/index.css";

  createRoot(document.getElementById("root")!).render(<App />);
  