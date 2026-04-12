import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'haxvibe — AI Vulnerability Scanner',
  description: 'Automatizált, AI-asszisztált etikus sérülékenységvizsgálat magyar KKV-knak.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu" className="dark">
      <body className="min-h-screen bg-void text-onSurface antialiased">
        <div className="noise-overlay" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
