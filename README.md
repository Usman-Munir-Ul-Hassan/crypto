# BitBash Sentry — Crypto Surveillance Terminal

A tactical-terminal-styled crypto monitoring platform built with **Next.js (App Router) + NextAuth + Prisma + PostgreSQL (Supabase)**, plus a standalone **surveillance engine** (Express) for price polling.

```
crytpoproject/
├── terminal-application/   # Next.js app: auth, UI, API routes
│   ├── prisma/             # schema + migrations
│   └── src/app/
│       ├── api/auth/signup/route.ts          # manual registration endpoint
│       ├── api/auth/[...nextauth]/route.ts   # NextAuth catch-all handler
│       ├── lib/auth.ts                       # authOptions: providers + callbacks
│       ├── hooks/useAuthRequest.ts           # shared fetch + loading/error state
│       ├── login/page.tsx                    # /login
│       └── register/page.tsx                 # /register
└── surveillance-engine/    # Express price-polling engine
```

---

## Authentication Architecture

Two doors, one hallway: **manual credentials** and **Google OAuth** are different identity checks, but both funnel into the **same `jwt` callback** and the **same HttpOnly session cookie**. The rest of the app never needs to know how someone logged in.

```
Manual register:  form → POST /api/auth/signup → bcrypt.hash → INSERT      (no session)
Manual login:     signIn("credentials") ──▶ authorize() ──┐
                                                          ├─▶ jwt() ─▶ same HttpOnly
Google (both):    signIn("google") ─▶ OAuth ─▶ signIn cb ─┘            cookie ─▶ in
                                       (upsert by email)
```

### User model rules

| Account type | `password_hash` | `google_id` |
|---|---|---|
| Manual only | filled | `null` |
| Google only | `null` | filled |
| Linked (manual + Google) | filled | filled |

- **Email is the single source of truth** for identity — normalized (`trim().toLowerCase()`) everywhere.
- Sessions are **stateless JWTs** signed with `NEXTAUTH_SECRET`, delivered as an `HttpOnly` cookie. Nothing is stored server-side.

---

## Flow 1 — Manual Register (`/register`)

**Files:** `register/page.tsx` → `hooks/useAuthRequest.ts` → `api/auth/signup/route.ts`

```
BROWSER                                    SERVER
─────────────────────────────────          ─────────────────────────────
1. user clicks "Request Access →"
2. React calls handleSubmit(e)
3. client-side gate checks
4. send(...) from useAuthRequest
5. fetch POST /api/auth/signup  ────────▶  6. POST(req) in route.ts
                                           7. validate → hash → create
11. res.ok → true               ◀────────  10. 201 { message }
12. router.push("/login")
```

1. **Click** → form `submit` event → React calls `handleSubmit(e)` → `e.preventDefault()` stops the browser's default full-page reload.
2. **Client-side gates**: `passkeyStrong` (8+ chars, upper, lower, number, symbol via `rules.every(...)`) and `password === confirm`. If either fails → `setError(...)` and **no network request happens**.
3. `handleSubmit` calls `send("/api/auth/signup", { email, password }, ...)` from `useAuthRequest` — flips `loading` (button shows "Transmitting..."), then runs `fetch`. Note: `confirm` is **not** sent — it's a pure client-side UX check.
4. Next.js maps the URL to `api/auth/signup/route.ts` and calls the exported `POST(req)` (folder path = URL: the App Router contract).
5. Inside `POST`, in order:
   - `req.json()` — bad JSON → 400.
   - Normalize email: `trim().toLowerCase()` so `Bob@X.com` = `bob@x.com`.
   - **Re-validate** email format + passkey strength. The browser checks can be bypassed with curl/DevTools; this server mirror cannot.
   - `prisma.user.findUnique({ where: { email } })`, then three branches:
     - Google-only account (`google_id` set, `password_hash` null) → 400 *"Sign in with Google"* (password-setting must happen behind an authenticated settings flow, never a public form).
     - Password account exists → 400 *"Account already exists"*.
     - Nobody → continue.
   - `bcrypt.hash(password, 10)` — plaintext dies here; only the hash survives.
   - `prisma.user.create(...)` → row with `password_hash` filled, `google_id: null` → **201**.
   - Race-condition safety: concurrent duplicate signups hit the DB unique constraint (`P2002`) and are routed into the normal "already exists" 400 instead of a raw 500.
6. Back in `send`: `res.ok` → `return true`; `finally` clears `loading`. `handleSubmit` then runs `router.push("/login")`.

> **Critical detail:** signup returns **no cookie, no session**. It only creates a row — that's why the redirect goes to `/login`, not the dashboard.

---

## Flow 2 — Manual Login (`/login`)

**Files:** `login/page.tsx` → `api/auth/[...nextauth]/route.ts` (NextAuth engine) → `lib/auth.ts` (`authorize` → `jwt`)

```
BROWSER                                    SERVER (NextAuth engine)
─────────────────────────────────          ─────────────────────────────
1. handleSubmit(e)
2. signIn("credentials", {...})
   ├─ GET /api/auth/csrf       ────────▶   returns CSRF token
   └─ POST /api/auth/callback/credentials ▶ 3. CSRF verified
                                           4. authorize(credentials)
                                           5. jwt({ token, user })
                                           6. sign JWT, Set-Cookie
7. res.ok → router.push("/")   ◀────────   { ok: true }
```

1. Submit → `handleSubmit(e)` → `signIn("credentials", { email, password, redirect: false })`. Under the hood this is **two requests**:
   - `GET /api/auth/csrf` — fetches a CSRF token (proof the POST comes from your page, not a malicious auto-submitting form).
   - `POST /api/auth/callback/credentials` with email, password, and that token.
2. The catch-all `[...nextauth]/route.ts` (6 lines — `NextAuth(authOptions)` builds one handler owning every `/api/auth/*` route) verifies CSRF **before** any custom code runs.
3. Engine sees provider `"credentials"` → calls `authorize(credentials)`:
   - Normalize email → `prisma.user.findUnique`.
   - Unknown email → `return null` → **generic failure** (never reveal which field was wrong).
   - `password_hash` is null (Google-only account) → `throw new Error("This account uses Google Sign-In...")` — never compare against a null hash; surface a clear redirect message instead.
   - `bcrypt.compare(password, user.password_hash)` — wrong → `return null`.
   - Match → `return { id, email }` — this becomes the `user` passed to the next callback.
4. Engine calls `jwt({ token, user })`. `user` exists **only at login**, so this runs **one DB lookup per login** and stamps `token.dbId = dbUser.id` (the Prisma cuid — `token.sub` holds the provider id). On all later requests `user` is `undefined` → token returned untouched, zero DB hits.
5. Engine signs the JWT with `NEXTAUTH_SECRET` and responds with `Set-Cookie: next-auth.session-token=<JWT>; HttpOnly`. HttpOnly = JS can't read it; the browser attaches it automatically. **This cookie is the session** — nothing stored server-side.
6. Because of `redirect: false`, `signIn` resolves with `{ ok, error }` and `handleSubmit` branches:
   - `res.ok` → `router.push("/")`.
   - `res.error !== "CredentialsSignin"` → show the custom thrown message (e.g. Google-only account) as-is.
   - Otherwise → generic *"Access denied — check identifier or passkey"*.

---

## Flow 3 — Google OAuth (register AND login: same button, same flow)

**Files:** either page's Google button → Google's servers → NextAuth engine → `signIn` callback → **same** `jwt` callback

```
BROWSER                    GOOGLE                   YOUR SERVER
──────────────────         ─────────────            ─────────────────────────
1. signIn("google")
2. full redirect ────────▶ consent screen
3.        ◀── redirect with ?code=...
4. GET /api/auth/callback/google?code=... ────────▶ 5. engine: code → tokens
                                                      (server-to-server, uses
                                                       CLIENT_SECRET)
                                                    6. signIn callback
                                                       → prisma.upsert
                                                    7. Google tokens DISCARDED
                                                    8. SAME jwt callback
                                                    9. SAME Set-Cookie
10. redirected to "/" with session cookie ◀────────
```

1. Click → `signIn("google", { callbackUrl: "/" })` → **full-page redirect** to `accounts.google.com` carrying `GOOGLE_CLIENT_ID` + a `state` value (OAuth's CSRF equivalent). The user types their Google password **on Google's page, never yours**.
2. User approves → Google redirects back to `/api/auth/callback/google?code=xyz&state=...`. The `code` is a one-time claim ticket — useless without your secret.
3. Engine exchanges the code **server-to-server**: `code + GOOGLE_CLIENT_SECRET → profile` (email, name, `sub` = Google's user id). The secret never touches the browser.
4. Engine calls the `signIn({ user, account })` callback — the veto point. For `account.provider === "google"`:
   - Google account has no email → `return false` (email is the linking key; without it, refuse).
   - `prisma.user.upsert({ where: { email } })` — **one query, three outcomes**:
     | DB state | Result |
     |---|---|
     | Email not found | **create** row with `google_id`, `password_hash: null` → Google "registration" |
     | Manual user exists (`google_id` null) | **update** attaches `google_id` → account **linking** (avoids the P2002 duplicate-email crash a naive `create` would cause) |
     | Returning Google user | update refreshes the same value → no-op |
   - DB write throws → `return false` (block login rather than admit a ghost user).
   - `return true` → engine proceeds.

   > The upsert keys on **email, not google_id** — email is the single source of truth for "who is this person". That one decision is what lets manual + Google coexist in one `User` row.
5. Google's access/refresh tokens are **discarded** — no later Google API calls are made, so storing them would be pure liability.
6. **Convergence point:** the engine runs the exact same `jwt` callback as Flow 2 (`user.email` is set at login-time → lookup → stamp `token.dbId`), signs the same JWT, sets the same cookie.
7. `callbackUrl: "/"` → engine responds with a real HTTP redirect to `/` (no `redirect: false` here — the page was already left in step 1).

---

## After login: how the cookie becomes `session.user.id`

On every request the browser attaches the HttpOnly cookie. When a page reads the session, NextAuth verifies the JWT signature and runs the `session({ session, token })` callback, which copies `token.dbId` into `session.user.id` — so the frontend gets the **Prisma cuid** and watchlist/alert queries match real rows. No DB query is needed to validate a session.

## Security decisions at a glance

- **Validation is mirrored** client + server; the server mirror is the real gate.
- **Generic login errors** — never reveal whether email or password was wrong.
- **Null-hash guard** — Google-only accounts can't be brute-forced through the credentials form.
- **bcrypt (cost 10)** for password storage; plaintext never persisted.
- **CSRF token** on credentials POST; **`state` param** on OAuth.
- **HttpOnly JWT cookie** — immune to `document.cookie` theft via XSS.
- **P2002 race handling** — duplicate concurrent signups degrade gracefully to a 400.

---

## Getting Started

```bash
# Terminal app (Next.js) — http://localhost:3000
cd terminal-application
npm install
npx prisma generate
npm run dev

# Surveillance engine (Express)
cd surveillance-engine
npm install
node index.js
```

Required env vars in `terminal-application/.env`:

```
DATABASE_URL=          # Supabase PostgreSQL connection string
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=       # openssl rand -base64 32
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```
