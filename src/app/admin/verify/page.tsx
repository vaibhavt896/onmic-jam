import { AdminShell } from "@/components/AdminNav";
import { VerifyScreen } from "@/components/VerifyScreen";

export const dynamic = "force-dynamic";

export default function VerifyPage() {
  return (
    <AdminShell active="/admin/verify">
      <VerifyScreen />
    </AdminShell>
  );
}
