import { IntlString } from '@hcengineering/platform';
import { ExecutionError, Transition } from '.';
import { Ref } from '@hcengineering/core';
export declare class ProcessError extends Error {
    readonly error: string;
    readonly message: IntlString;
    readonly props: Record<string, any>;
    readonly intlProps: Record<string, IntlString>;
    readonly shouldLog: boolean;
    constructor(error: string, message: IntlString, props: Record<string, any>, intlProps: Record<string, IntlString>, shouldLog?: boolean);
}
export declare function processError(message: IntlString, props?: Record<string, any>, intlProps?: Record<string, IntlString>, shouldLog?: boolean): ProcessError;
export declare function parseError(err: ProcessError, transition: Ref<Transition> | undefined): ExecutionError;
//# sourceMappingURL=errors.d.ts.map