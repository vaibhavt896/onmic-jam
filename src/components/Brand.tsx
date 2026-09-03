export function Wordmark() {
  return <p className="mono text-flare">On Mic</p>;
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-9 pb-10 sm:max-w-lg">
      {children}
    </main>
  );
}
