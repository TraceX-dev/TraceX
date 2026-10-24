import type { AuthoringNativeDocument, ProcessAuthoringResult } from './authoring';
import type { Hierarchy, ModelDb } from '@hcengineering/core';
/** Validates native model structure without maintaining operation/property allowlists. */
export declare function compileAuthoringModel(root: Record<string, unknown>, model?: ModelDb): ProcessAuthoringResult;
/** Serializes all native data; newly introduced classes, operations and properties are retained. */
export declare function exportAuthoringModel(documents: readonly unknown[], kind: 'card' | 'process', catalog?: Record<string, unknown>): string;
/** Rebinds model references and native context expressions, preserving literal text. */
export declare function remapAuthoringReferences(documents: readonly AuthoringNativeDocument[], mapping: ReadonlyMap<string, string>, isLiteral?: (doc: AuthoringNativeDocument, path: readonly string[]) => boolean): AuthoringNativeDocument[];
/** Collects identities owned by a process graph, including published results and user requests. */
export declare function getAuthoringProcessIdentities(documents: readonly AuthoringNativeDocument[]): Set<string>;
/** Lists the installed contracts for authors; catalogs never install or redefine operations. */
export declare function getAuthoringCatalog(model: ModelDb): Record<string, unknown>;
/** Resolves operations through the installed model before applying a full definition. */
export declare function validateAuthoringModelOperations(documents: readonly AuthoringNativeDocument[], model: ModelDb, hierarchy: Hierarchy): void;
//# sourceMappingURL=authoring-model.d.ts.map