import type { ModelDb } from '@hcengineering/core';
import type { AuthoringNativeDocument } from './authoring';
import { type AuthoringOutputEnvironment } from './authoring-outputs';
/** Returns the authoring block path for a compiled native document. */
export declare function authoringLayoutPath(doc: AuthoringNativeDocument): string;
/** Groups native documents into named processes, states, transitions and model sections. */
export declare function encodeAuthoringLayout(docs: readonly AuthoringNativeDocument[], environment?: AuthoringOutputEnvironment): Record<string, unknown>;
/** Restores native identities, ownership, operation ids and rank from readable block order. */
export declare function decodeAuthoringLayout(root: Record<string, unknown>, model?: ModelDb): AuthoringNativeDocument[];
//# sourceMappingURL=authoring-layout.d.ts.map