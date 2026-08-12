import { KioskSetupForm } from "@/components/KioskBoard";

export default function KioskSetupPage() {
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="card flex w-full max-w-md flex-col gap-4 shadow-lg">
        <div className="eyebrow">Team Hub · Kiosk</div>
        <h1 className="text-2xl font-bold tracking-tight">Kiosk setup</h1>
        <p className="text-sm text-[var(--color-muted-fg)]">
          Enter the kiosk token from an admin (Admin → Kiosk devices) to register this tablet.
        </p>
        <KioskSetupForm />
      </div>
    </main>
  );
}
