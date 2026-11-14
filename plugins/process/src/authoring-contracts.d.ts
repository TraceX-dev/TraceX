import type { ModelDb } from '@hcengineering/core';
export interface AuthoringOutputEnvironment {
    model?: ModelDb;
    catalog?: Record<string, unknown>;
}
/** Installed definitions are authoritative; catalogs supply offline contracts only. */
export declare function authoringOperationContract(id: string, kind: 'methods' | 'triggers' | 'functions', environment: AuthoringOutputEnvironment): Record<string, unknown> | undefined;
/** Checks only requirements declared by the model, without inventing types or defaults. */
export declare function validateAuthoringParameters(definition: Record<string, unknown> | undefined, params: unknown, path: string): void;
//# sourceMappingURL=authoring-contracts.d.ts.map