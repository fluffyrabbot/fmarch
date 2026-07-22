import type { AuthKitAuth } from "@workos/authkit-sveltekit";

declare global {
  namespace App {
    interface Locals {
      auth: AuthKitAuth;
      principalUserId: string | null;
      resolvedCapabilities: unknown[];
    }
  }
}

export {};
