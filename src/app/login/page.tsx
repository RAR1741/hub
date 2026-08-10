import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { StudentLoginForm } from "@/components/StudentLoginForm";
import { AccountRequestForm } from "@/components/AccountRequestForm";

export default function LoginPage() {
  return (
    <main>
      <h1>Team Hub — Sign in</h1>
      <section>
        <h2>Students</h2>
        <StudentLoginForm />
        <details>
          <summary>New student? Request an account</summary>
          <AccountRequestForm />
        </details>
      </section>
      <section>
        <h2>Mentors</h2>
        <GoogleSignInButton />
      </section>
    </main>
  );
}
