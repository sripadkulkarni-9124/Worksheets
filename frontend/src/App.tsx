import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Evaluate from './pages/Evaluate'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/evaluate/:id" element={<Evaluate />} />
    </Routes>
  )
}
