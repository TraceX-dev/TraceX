import { type AuthoringOutputEnvironment } from './authoring-contracts';
export type { AuthoringOutputEnvironment } from './authoring-contracts';
/** Generates the same wiring used by native action contexts; no operation-specific handlers. */
export declare function publishAuthoringOutput(value: unknown, action: Record<string, unknown>, producer: string, contexts: Record<string, unknown>, environment: AuthoringOutputEnvironment, path: string): void;
/** Compacts only faithfully reproducible contexts; unusual native metadata remains explicit. */
export declare function compactAuthoringOutput(action: Record<string, unknown>, producer: string, contexts: Record<string, unknown>, environment: AuthoringOutputEnvironment, remaining: Record<string, unknown>): unknown | undefined;
//# sourceMappingURL=authoring-outputs.d.ts.map