import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'haxvibe — AI-alapú sérülékenységvizsgálat',
  description: 'Etikus hacker a weboldaladért, automata módban',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hu" className="theme">
      <body>{children}</body>
    </html>
  );
}
