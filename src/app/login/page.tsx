import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { StudentLoginForm } from "@/components/StudentLoginForm";
import { AccountRequestForm } from "@/components/AccountRequestForm";

export default function LoginPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 py-8">
      <h1 className="text-center text-2xl font-bold tracking-tight">
        Team Hub — Sign in
      </h1>
      <div className="card flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted-fg)]">
            Students
          </h2>
          <StudentLoginForm />
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-[var(--color-brand)]">
              New student? Request an account
            </summary>
            <div className="mt-3">
              <AccountRequestForm />
            </div>
          </details>
        </section>
        <hr className="border-[var(--color-border)]" />
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted-fg)]">
            Mentors
          </h2>
          <GoogleSignInButton />
        </section>
      </div>
    </main>
  );
}
