import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your TaskFlow account.',
};

export default function LoginPage() {
  return (
    /*
     * LoginForm reads `?next=` with useSearchParams, which opts a component out
     * of prerendering unless it sits behind a Suspense boundary. The boundary
     * keeps the shell (brand panel, header) static and streams only the card.
     */
    <Suspense
      fallback={
        <div className="tf-auth__pending" role="status" aria-label="Loading the sign-in form" />
      }
    >
      <LoginForm />
    </Suspense>
  );
}
