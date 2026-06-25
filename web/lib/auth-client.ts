"use client";

import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { API_URL } from "./api";

/**
 * Better Auth browser client. baseURL is the Worker origin; the client appends
 * /api/auth/* itself. Staff sign in with a username (the `username` plugin);
 * public sign-up is closed, so we only expose signIn/signOut/useSession.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: { credentials: "include" },
  plugins: [usernameClient()],
});

export const { signIn, signOut, useSession } = authClient;
