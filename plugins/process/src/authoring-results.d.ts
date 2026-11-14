/** Uses verified platform type constructors; unknown types retain their full model properties. */
export declare function decodeAuthoringType(value: unknown, path: string): Record<string, unknown>;
/** A shorthand is emitted only if decoding reproduces every type property. */
export declare function encodeAuthoringType(value: unknown): unknown;
/** Generates the same typed context metadata as the engine's result synchronization. */
export declare function publishAuthoringResults(value: unknown, action: Record<string, unknown>, producer: string, contexts: Record<string, unknown>, path: string, resolve: (value: unknown, path: string) => unknown): void;
/** Returns named results only when every associated context can be reconstructed exactly. */
export declare function compactAuthoringResults(action: Record<string, unknown>, producer: string, contexts: Record<string, unknown>, remaining: Record<string, unknown>): Record<string, unknown> | undefined;
//# sourceMappingURL=authoring-results.d.ts.map