import { Tx, TxUpdateDoc } from '@hcengineering/core/types/tx';
import { SelectedContext } from './types';
import { Card } from '@hcengineering/card';
export declare function parseContext(value: any): SelectedContext | undefined;
export declare function isUpdateTx(etx: Tx): etx is TxUpdateDoc<Card>;
//# sourceMappingURL=utils.d.ts.map