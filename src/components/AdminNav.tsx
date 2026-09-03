import Link from "next/link";
import { SignOut } from "./SignOut";

const LINKS = [
  { href: "/admin", label: "Home" },
  { href: "/admin/verify", label: "Verify" },
  { href: "/admin/floor", label: "Floor" },
  { href: "/admin/money", label: "Money" },
  { href: "/admin/people", label: "People" },
  { href: "/admin/event", label: "Event" },
];

export function AdminNav({ active }: { active: string }) {
  return (
    <nav className="-mx-5 mb-6 flex gap-1 overflow-x-auto px-5 pb-1">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${
            l.href === active ? "bg-brand text-ink" : "bg-card text-muted"
          }`}
        >
          {l.label}
        </Link>
      ))}
      <SignOut />
    </nav>
  );
}

export function AdminShell({ active, children }: { active: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-6">
      <AdminNav active={active} />
      {children}
    </main>
  );
}
