declare global {
  namespace App {
    interface Locals {
      principalId: string | null;
      resolvedCapabilities: unknown[];
    }
  }
}

export {};
