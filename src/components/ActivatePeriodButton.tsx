"use client";

import { useRouter } from "next/navigation";

export function ActivatePeriodButton({ periodId }: { periodId: string }) {
  const router = useRouter();
  async function activate() {
    const res = await fetch(`/api/admin/periods/${periodId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "activate" }),
    });
    if (res.ok) router.refresh();
  }
  return <button onClick={activate}>Make active</button>;
}
