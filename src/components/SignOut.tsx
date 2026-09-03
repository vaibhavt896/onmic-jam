"use client";

/**
 * The session lasts 30 days on what is often a volunteer's personal phone.
 * Being able to end it is the minimum that makes a shared passcode defensible.
 */
export function SignOut() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        window.location.href = "/admin/login";
      }}
      className="ml-auto shrink-0 rounded-lg px-3 py-2 text-sm text-dim"
      data-testid="sign-out"
    >
      Sign out
    </button>
  );
}
