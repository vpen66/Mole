import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { DashboardPage } from "@/pages/DashboardPage";
import { CleanPage } from "@/pages/CleanPage";
import { UninstallPage } from "@/pages/UninstallPage";
import { PurgePage } from "@/pages/PurgePage";
import { OptimizePage } from "@/pages/OptimizePage";
import { HistoryPage } from "@/pages/HistoryPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/clean" element={<CleanPage />} />
          <Route path="/uninstall" element={<UninstallPage />} />
          <Route path="/purge" element={<PurgePage />} />
          <Route path="/optimize" element={<OptimizePage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
