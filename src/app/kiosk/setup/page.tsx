import { KioskSetupForm } from "@/components/KioskBoard";

export default function KioskSetupPage() {
  return (
    <main>
      <h1>Kiosk setup</h1>
      <p>Enter the kiosk token from an admin (Admin → Kiosk devices) to register this tablet.</p>
      <KioskSetupForm />
    </main>
  );
}
