import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        // Unknown email -> same generic failure as a wrong password;
        // never reveal which field was wrong.
        if (!user) return null;
        // Google-only account: never compare against a null hash —
        // block explicitly with a clear redirect message instead.
        if (!user.password_hash) {
          throw new Error(
            "This account uses Google Sign-In. Please continue with Google."
          );
        }
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;
        return { id: user.id, email: user.email };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        // Google account without an email -> refuse; email is our linking key.
        if (!user.email) return false;
        try {
          // Look up by EMAIL (single source of truth), not google_id:
          // a manual user (google_id null) signing in with Google gets
          // their Google account LINKED instead of a P2002 duplicate-email crash.
          await prisma.user.upsert({
            where: { email: user.email },
            update: {
              // existing user (manual or returning Google) -> attach/refresh the link
              google_id: account.providerAccountId,
            },
            create: {
              email: user.email,
              google_id: account.providerAccountId,
              // password_hash stays null -> Google-only account
            },
          });
        } catch (err) {
          console.error("Google user sync failed:", err);
          return false; // block sign-in if we couldn't persist the user
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      // `user` exists only at the moment of login -> one DB lookup per login,
      // stamping our Prisma cuid into the token (token.sub holds Google's id).
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
        });
        if (dbUser) {
          token.dbId = dbUser.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.dbId) {
        // Frontend gets the Prisma cuid, so watchlist queries actually match.
        session.user.id = token.dbId as string;
      }
      return session;
    },
  },
};
