import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import PublicPage from './routes/PublicPage';
import AdminPage from './routes/AdminPage';
import SalesPage from './routes/SalesPage';
import VendorPage from './routes/VendorPage';
import WakeButton from './components/WakeButton';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <WakeButton />
      <Routes>
        <Route path="/" element={<PublicPage />} />
        <Route path="/v/:code" element={<PublicPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/vendor" element={<VendorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
