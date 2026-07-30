// Route protection — runs on the server BEFORE any matched page renders.
// withAuth checks the NextAuth session cookie (JWT): valid -> page renders,
// missing/invalid -> redirect to /login?callbackUrl=<original url>.
import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login", // send strangers to our login page, not NextAuth's default
  },
});

// Guarded paths, straight from the API contract's "Auth Required" column:
// dashboard + profile + settings pages, the password route and all watchlist
// routes. Public stays public:
// /api/auth/* (signup/signin), /api/prices, /api/alerts, /login, /register, /market.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/watchlist/:path*",
    "/watchlist",
    "/alerts/:path*",
    "/alerts",
    "/profile/:path*",
    "/settings/:path*",
    "/api/password",
    "/api/watchlist/:path*",
    "/api/watchlist",
  ],
};
