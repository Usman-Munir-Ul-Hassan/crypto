"use client";

import { useState } from "react";

// Shared auth request logic: loading + error state and the fetch call.
// Both login and register pages use this instead of duplicating it.
export function useAuthRequest() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const send = async (
    endpoint: string,
    body: { email: string; password: string },
    failMessage: string
  ): Promise<boolean> => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // store/send the session cookie
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Prefer the server's specific message (e.g. "linked to a Google
        // account") over the generic fallback.
        let message = failMessage;
        try {
          const data = await res.json();
          if (typeof data?.error === "string") message = data.error;
        } catch {
          // non-JSON response body -> keep the fallback
        }
        setError(message);
        return false;
      }
      return true;
    } catch {
      setError("Link failure — server unreachable");
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, setError, send };
}
