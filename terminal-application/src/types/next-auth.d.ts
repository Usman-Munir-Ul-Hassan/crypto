import "next-auth";

// Extend NextAuth's built-in Session type so session.user.id type-checks.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
