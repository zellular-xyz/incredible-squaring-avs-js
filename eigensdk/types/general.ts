// export type MapOf<T0 extends string | number | symbol, T1> = {
// 	[key in T0]: T1;
// };
export type Uint32 = number;
export type Uint8 = number;
export type OperatorId = string;
export type BlockNumber = Uint32;
export type QuorumNum = Uint8;
export type TaskIndex = Uint32;
export type Exception = {message: string, code: number};
export type LocalAccount = { address: string; privateKey: string }