import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Evaluate from './pages/Evaluate'
import AppBackground from './components/AppBackground'
import './styles/background.css'

export default function App() {
  return (
    <>
      <AppBackground />
      <div style={{ position: 'relative', zIndex: 10, minHeight: '100dvh' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/evaluate/:id" element={<Evaluate />} />
        </Routes>
      </div>
    </>
  )
}
