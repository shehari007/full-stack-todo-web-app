import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { getPublicSettings } from '@/lib/server-api';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Create a TaskFlow account and start organising your work.',
};

export default async function RegisterPage() {
  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;

  /*
   * Resolved on the server so a closed installation renders the "registration
   * is closed" screen in the first paint, instead of showing a full sign-up
   * form that would be pulled away a moment later.
   */
  return <RegisterForm registrationEnabled={settings.features.registrationEnabled} />;
}
