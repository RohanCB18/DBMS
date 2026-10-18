import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/toast";
import Overview from "./pages/Overview";
import LiveData from "./pages/LiveData";
import HistoryPage from "./pages/History";
import DiffPage from "./pages/Diff";
import TimeTravel from "./pages/TimeTravel";
import Lineage from "./pages/Lineage";
import VerifyPage from "./pages/Verify";
import TamperLab from "./pages/TamperLab";
import Prove from "./pages/Prove";
import MergePage from "./pages/Merge";
import SqlConsole from "./pages/SqlConsole";
import FraudRings from "./pages/FraudRings";
import Auditor from "./pages/Auditor";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 2000 } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/audit" element={<Auditor />} />
            <Route element={<Layout />}>
              <Route index element={<Overview />} />
              <Route path="live" element={<LiveData />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="diff" element={<DiffPage />} />
              <Route path="time-travel" element={<TimeTravel />} />
              <Route path="lineage" element={<Lineage />} />
              <Route path="verify" element={<VerifyPage />} />
              <Route path="tamper" element={<TamperLab />} />
              <Route path="prove" element={<Prove />} />
              <Route path="merge" element={<MergePage />} />
              <Route path="sql" element={<SqlConsole />} />
              <Route path="fraud" element={<FraudRings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
