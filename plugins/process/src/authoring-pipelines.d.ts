import { type AuthoringOutputEnvironment } from './authoring-contracts';
type Resolve = (value: unknown, path: string) => unknown;
/** Composes registered functions without executing code or assigning guessed parameter semantics. */
export declare function decodeAuthoringPipeline(value: unknown, environment: AuthoringOutputEnvironment, resolve: Resolve, path: string): string;
/** Keeps noncanonical and legacy strings intact; exported YAML must restore the exact stored expression. */
export declare function encodeAuthoringPipeline(source: string, resolve: Resolve, environment?: AuthoringOutputEnvironment): unknown | undefined;
export {};
//# sourceMappingURL=authoring-pipelines.d.ts.map