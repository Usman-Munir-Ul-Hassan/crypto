"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import AuthHero from "../components/AuthHero";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    // Manual login goes through NextAuth too -> same JWT session as Google.
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false, // handle the result here instead of a full-page redirect
    });
    setLoading(false);
    if (res?.ok) {
      router.push("/dashboard");
    } else if (res?.error && res.error !== "CredentialsSignin") {
      // Specific message thrown by authorize (e.g. Google-only account).
      setError(res.error);
    } else {
      // Wrong email or passkey -> deliberately generic.
      setError("Access denied — check identifier or passkey");
    }
  };

  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-2 bg-background">
      {/* Left: form */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Shield badge */}
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-primary/70 bg-surface shadow-glow">
            <svg
              className="h-6 w-6 text-primary"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>

          <h1 className="mt-6 font-display text-3xl font-black italic uppercase tracking-tight text-foreground">
            Access Terminal
          </h1>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
            Establish secure link / BitBash Sentry
          </p>

          <form onSubmit={handleSubmit} className="mt-10 space-y-6">
            <div>
              <label
                htmlFor="email"
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted"
              >
                Email Identifier
              </label>
              <div className="relative mt-2">
                <svg
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-10 6L2 7" />
                </svg>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@bitbash.io"
                  className="w-full rounded-lg border border-line bg-surface py-3 pl-11 pr-4 font-mono text-sm text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted"
              >
                Secure Passkey
              </label>
              <div className="relative mt-2">
                <svg
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-line bg-surface py-3 pl-11 pr-4 font-mono text-sm text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none"
                />
              </div>
            </div>

            {error && (
              <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-red-500">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full cursor-pointer rounded-lg bg-primary py-3.5 font-mono text-xs font-bold uppercase tracking-[0.2em] text-black shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Establishing link..." : "Initiate Login →"}
            </button>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-line" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              or
            </span>
            <div className="h-px flex-1 bg-line" />
          </div>

          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-line bg-surface py-3.5 font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground transition hover:border-primary/40"
          >
            <svg className="h-4 w-4" viewBox="0 0 48 48">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            Sign in with Google
          </button>

          <p className="mt-8 text-center font-mono text-xs text-muted">
            New operative?{" "}
            <Link
              href="/register"
              className="font-bold uppercase tracking-[0.15em] text-primary hover:underline"
            >
              Request Access
            </Link>
          </p>
        </div>
      </div>

      {/* Right: hero panel */}
      <AuthHero />
    </main>
  );
}
