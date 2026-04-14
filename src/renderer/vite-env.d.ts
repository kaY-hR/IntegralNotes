/// <reference types="vite/client" />

import type { IntegralNotesApi } from "../shared/workspace";

declare global {
  interface Window {
    integralNotes: IntegralNotesApi;
  }
}

export {};


