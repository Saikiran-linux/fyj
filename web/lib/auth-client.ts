"use client";

import { createAuthClient } from "better-auth/react";
import { API_URL } from "./api";

/**
 * Better Auth browser client. baseURL is the Worker origin; the client appends
 * /api/auth/* itself. Sign-in/up/out + useSession come from here.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: { credentials: "include" },
});

export const { signIn, signUp, signOut, useSession } = authClient;
