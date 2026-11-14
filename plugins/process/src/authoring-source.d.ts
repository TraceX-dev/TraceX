interface ParserState {
    position: number;
    result: unknown;
}
/** Retains parser positions without interpreting indentation or searching for repeated names. */
export declare class AuthoringSource {
    private readonly source;
    private readonly starts;
    private readonly positions;
    constructor(source: string);
    readonly listener: (event: "open" | "close", state: ParserState) => void;
    /** Points to the closest authored container, including missing properties and dotted keys. */
    location(root: unknown, path: string): {
        line: number;
        column: number;
    } | undefined;
}
export {};
//# sourceMappingURL=authoring-source.d.ts.map