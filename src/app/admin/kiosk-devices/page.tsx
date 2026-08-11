import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { hasRole } from "@/lib/authz";
import { listKioskDevices } from "@/lib/kiosk";
import { KioskDeviceManager } from "@/components/KioskDeviceManager";

export default async function AdminKioskDevicesPage() {
  const viewer = await getViewer();
  if (!hasRole(viewer.role, "admin")) redirect("/login");
  const devices = await listKioskDevices();
  return (
    <main>
      <h1>Admin — Kiosk devices</h1>
      <p>Create a token, then enter it once on the shop tablet at <code>/kiosk/setup</code>.</p>
      <KioskDeviceManager devices={devices} />
    </main>
  );
}
