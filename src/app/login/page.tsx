import { GoogleSignInButton } from "@/components/GoogleSignInButton";
// import { StudentLoginForm } from "@/components/StudentLoginForm"; // Student ID login hidden during internal-tool rollout
import { AccountRequestForm } from "@/components/AccountRequestForm";
import { EmailOtpForm } from "@/components/EmailOtpForm";

export default function LoginPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 py-8">
      <div className="text-center">
        <div className="eyebrow">1741 · Team Hub</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Sign in</h1>
      </div>
      <div className="card flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="eyebrow">Email</h2>
          <EmailOtpForm />
        </section>
        <hr style={{ border: 0, borderTop: "1px solid var(--hair)" }} />
        <section className="flex flex-col gap-3">
          <h2 className="eyebrow">Students</h2>
          {/* <StudentLoginForm /> Student ID login hidden during internal-tool rollout */}
          <details className="text-sm">
            <summary className="cursor-pointer font-medium" style={{ color: "var(--red)" }}>
              New student? Request an account
            </summary>
            <div className="mt-3">
              <AccountRequestForm />
            </div>
          </details>
        </section>
        <hr style={{ border: 0, borderTop: "1px solid var(--hair)" }} />
        <section className="flex flex-col gap-3">
          <h2 className="eyebrow">Mentors</h2>
          <GoogleSignInButton />
        </section>
        {process.env.NODE_ENV !== "production" && (
          <>
            <hr style={{ border: 0, borderTop: "1px solid var(--hair)" }} />
            <section className="flex flex-col gap-3">
              <h2 className="eyebrow">Dev only</h2>
              <div className="flex flex-col gap-2">
                <form action="/api/auth/dev-login?role=student" method="POST">
                  <button type="submit" className="btn w-full">
                    Log in as Student
                  </button>
                </form>
                <form action="/api/auth/dev-login?role=mentor" method="POST">
                  <button type="submit" className="btn w-full">
                    Log in as Mentor
                  </button>
                </form>
                <form action="/api/auth/dev-login?role=admin" method="POST">
                  <button type="submit" className="btn w-full">
                    Log in as Admin
                  </button>
                </form>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
