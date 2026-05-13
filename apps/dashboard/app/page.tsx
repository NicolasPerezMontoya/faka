import { redirect } from 'next/navigation';

// Phase 1: the only working page is /operacion. Other views (Hoy/Productos/
// Canales/Inteligencia) ship in F2+.
export default function HomePage() {
  redirect('/operacion');
}
