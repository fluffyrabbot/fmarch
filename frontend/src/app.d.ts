declare global {
  namespace App {
    interface Locals {
      principalUserId: string | null;
      resolvedCapabilities: unknown[];
    }
  }
}

export {};
