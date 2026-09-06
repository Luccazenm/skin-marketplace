
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  // Before the first render: it decides the language and loads the
  // catalogue, and a component asking for a phrase before this ran would
  // get the key back instead.
  import "./lib/i18n";
  import { CurrencyProvider } from "./lib/use-currency";
  import "./styles/index.css";

  // Outside App rather than inside it: every screen draws prices, and a
  // provider nested in one of them would leave the others formatting in
  // dollars regardless of the picker.
  createRoot(document.getElementById("root")!).render(
    <CurrencyProvider>
      <App />
    </CurrencyProvider>,
  );
