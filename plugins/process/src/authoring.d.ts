import type { Doc, ModelDb } from '@hcengineering/core';
import type { AuthoringValidation } from './authoring-validation';
export { ProcessAuthoringError } from './authoring-validation';
/** Native import documents omit runtime transaction metadata. */
export interface AuthoringNativeDocument {
    _id: string;
    _class: string;
    space: string;
    [key: string]: unknown;
}
export interface ProcessAuthoringResult {
    kind: 'card' | 'process';
    version?: 1 | 2;
    docs: AuthoringNativeDocument[];
    fields: Record<string, string>;
}
/** Compiles versioned YAML authoring documents into native card modules or portable process templates. */
export declare function compileProcessYaml(source: string, model?: ModelDb): ProcessAuthoringResult;
/** Reads existing native JSON unchanged, or compiles YAML for the requested import route. */
export declare function parseProcessImport(source: string, kind: 'card' | 'process', model?: ModelDb): Doc[];
/** Validates source for the authoring UI without writing model documents. */
export declare function validateProcessYaml(source: string, kind?: 'card' | 'process', model?: ModelDb): AuthoringValidation;
//# sourceMappingURL=authoring.d.ts.map