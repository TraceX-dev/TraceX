/** A YAML authoring diagnostic identifying the invalid property. */
export declare class ProcessAuthoringError extends Error {
    readonly path: string;
    readonly line?: number | undefined;
    readonly column?: number | undefined;
    constructor(path: string, message: string, line?: number | undefined, column?: number | undefined);
}
export interface AuthoringDiagnostic {
    message: string;
    path: string;
    line?: number;
    column?: number;
}
export interface AuthoringValidation {
    valid: boolean;
    diagnostic?: AuthoringDiagnostic;
}
export declare function fail(path: string, message: string): never;
export declare function object(value: unknown, path: string, keys?: string[]): Record<string, unknown>;
export declare function text(value: unknown, path: string): string;
export declare function identifier(value: unknown, path: string): string;
export declare function flag(value: unknown, path: string, fallback: boolean): boolean;
export declare function list(value: unknown, path: string): unknown[];
export declare function assertTree(value: unknown, path?: string): void;
/** Compares plain model data independent of object property order. */
export declare function authoringDataEqual(left: unknown, right: unknown): boolean;
//# sourceMappingURL=authoring-validation.d.ts.map