/** Uses concise YAML when lossless; otherwise preserves the complete native model in version 2. */
export declare function exportProcessYaml(documents: readonly unknown[], kind: 'card' | 'process'): string;
/** Exports a process draft and its existing field bindings for the UI editor. */
export declare function exportProcessYamlDraft(documents: readonly unknown[]): {
    source: string;
    bindings: Record<string, string>;
};
//# sourceMappingURL=authoring-export.d.ts.map