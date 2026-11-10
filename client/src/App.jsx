import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { HomePage } from './pages/HomePage.jsx';
import { RulesPage } from './pages/RulesPage.jsx';
import { RoomPage } from './pages/RoomPage.jsx';
import { BrandMark } from './components/BrandMark.jsx';

export function App() {
  const { pathname } = useLocation();
  const inRoom = pathname.startsWith('/room/');
  return (
    <div className={`app ${inRoom ? 'app-room' : ''}`}>
      {!inRoom && (
        <header className="site-header">
          <Link to="/" className="brand">
            <BrandMark />
            Card Table
          </Link>
          <nav>
            <Link to="/rules">Rules</Link>
          </nav>
        </header>
      )}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/rules/:gameId" element={<RulesPage />} />
        <Route path="/room/:code" element={<RoomPage />} />
        <Route
          path="*"
          element={
            <main className="page narrow">
              <h1>Page not found</h1>
              <Link className="btn" to="/">
                Go home
              </Link>
            </main>
          }
        />
      </Routes>
    </div>
  );
}
