import { redirect } from 'next/navigation';

export default function HomePage() {
  // Keep root public until a server-verified setup/landing decision is implemented.
  redirect('/login');
}
