import { rpc } from "@/lib/db";
import type { Person } from "@/lib/types";
import { AdminShell } from "@/components/AdminNav";
import { PersonRow } from "@/components/PersonRow";

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const people = await rpc<Person[]>("app_people", { p_q: q.trim().slice(0, 60) });

  return (
    <AdminShell active="/admin/people">
      <h1 className="text-lg font-bold tracking-widest text-white uppercase">People</h1>

      <form method="GET" className="mt-4 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          className="field"
          placeholder="Name, phone, pass, UTR or coupon"
          data-testid="people-search"
        />
        <button type="submit" className="btn btn-ghost w-auto px-4">
          Search
        </button>
      </form>

      <p className="mt-3 text-xs text-dim">
        {people.length} {people.length === 1 ? "person" : "people"}
        {q ? ` matching “${q}”` : ""}
      </p>

      <ul className="mt-3 overflow-hidden rounded-xl border border-line" data-testid="people-list">
        {people.map((p) => (
          <PersonRow key={p.id} person={p} />
        ))}
        {people.length === 0 && <li className="p-4 text-sm text-dim">Nobody yet.</li>}
      </ul>
    </AdminShell>
  );
}
