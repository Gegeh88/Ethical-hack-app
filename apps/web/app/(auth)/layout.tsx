export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="terminal-grid flex min-h-screen items-center justify-center bg-void p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <span className="font-display text-2xl font-bold uppercase tracking-widest text-onSurface">
            HAX<span className="text-pulse">VIBE</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
