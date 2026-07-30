// Turns whatever the session/DB gives us into a display name + avatar initials.
// Credentials users have no `name` (we only store email), so we fall back to the
// email's local part; Google users usually carry a real name. Pure functions —
// safe to use in both Server and Client components.

type NameSource = { name?: string | null; email?: string | null };

export function operatorName(user?: NameSource | null): string {
  const name = user?.name?.trim();
  if (name) return name;
  const local = user?.email?.split("@")[0]?.trim();
  return local && local.length > 0 ? local : "Operator";
}

export function operatorInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return displayName.slice(0, 2).toUpperCase();
}
