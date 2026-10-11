import type { AuthoringOutputEnvironment } from './authoring-contracts';
export interface AuthoringReferenceScope {
    slots: Record<string, unknown>;
    contexts: Record<string, unknown>;
    environment?: AuthoringOutputEnvironment;
}
/** Short class names are structural; literal dotted model ids use an explicit ref. */
export declare function authoringClassName(value: unknown, decode: boolean): unknown;
/** Resolves named references with explicit value/identity semantics, never parameter-name heuristics. */
export declare function decodeAuthoringReference(value: string, scope: AuthoringReferenceScope, path: string): string;
/** Translates params/query values, preserving literal reference-looking strings and objects. */
export declare function authoringReferenceValues(value: unknown, decode: boolean, scope: AuthoringReferenceScope, path: string): unknown;
/** Structural class/slot ownership references do not interpret ordinary text or expressions. */
export declare function authoringSlotReferences(value: unknown, decode: boolean, scope: AuthoringReferenceScope, path: string): unknown;
//# sourceMappingURL=authoring-references.d.ts.map