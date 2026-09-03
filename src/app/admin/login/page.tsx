import { Suspense } from "react";
import { Shell, Wordmark } from "@/components/Brand";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Shell>
      <Wordmark />
      <h1 className="mt-6 text-2xl font-bold text-white">Organisers</h1>
      <p className="mt-2 text-sm text-muted">Two admins, one shared passcode.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </Shell>
  );
}
