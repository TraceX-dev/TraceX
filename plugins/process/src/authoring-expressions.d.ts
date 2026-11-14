export interface AuthoringField {
    name: string;
    type: 'string' | 'number' | 'employee' | 'choice';
    choices?: string[];
    multiple: boolean;
    readonly: boolean;
}
export interface CompiledExpression {
    value: string | number;
    type: AuthoringField['type'];
    dependencies: string[];
}
/** Compiles field references, number(field), and multiplication without executing scripts. */
export declare function compileExpression(source: string, fields: Record<string, AuthoringField>, path: string): CompiledExpression;
export interface CompiledCondition {
    field: string;
    query: Record<string, number> | number;
}
/** Compiles a single numeric comparison to a native card match predicate. */
export declare function compileCondition(source: string, fields: Record<string, AuthoringField>, path: string): CompiledCondition;
/** Compiles readable conjunctions of verified native predicate operators. */
export declare function compileMatch(value: unknown, fields: Record<string, AuthoringField>, path: string): Record<string, unknown>;
//# sourceMappingURL=authoring-expressions.d.ts.map