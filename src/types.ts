import { Output, Input } from 'bitcoinjs-lib/types/transaction'

/**
 * Lotion-style map of validator public key to voting power.
 */
export interface ValidatorMap {
  [index: string]: number
}

export type BitcoinNetwork = 'regtest' | 'testnet' | 'mainnet'

/**
 * Maps validator public key (base64) to signatory public key (buffer)
 */

export interface SignatoryMap {
  [index: string]: Buffer
}

export enum KeyType {
  Ed25519 = 'tendermint/PrivKeyEd25519'
}

export interface ValidatorKey {
  priv_key: {
    type: KeyType
    value: string
  }
  pub_key?: {
    type: KeyType
    value: string
  }
  address?: string
}

export interface TxInput {
  txid: Buffer
  index: number
  amount: number
}
export interface TxOutput {
  amount: number
  script: Buffer
}

export interface SignedTx {
  inputs: TxInput[]
  outputs: TxOutput[]
  signedVotingPower: number
  signatures: Array<Array<Buffer>>
}

export type SigningTx = SignedTx

export interface Header {
  height: number
  version: number
  prevHash: Buffer
  merkleRoot: Buffer
  timestamp: number
  bits: number
  nonce: number
}
export interface UTXO {
  txid: Buffer
  amount: number
  index: number
}
export interface Withdrawal {
  amount: number
  script: Buffer
}

export interface BitcoinPegState {
  chain: Header[]
  signatoryKeys: SignatoryMap
  processedTxs: {
    [txid: string]: true
  }
  utxos: UTXO[]
  withdrawals: Withdrawal[]
  signingTx: SigningTx | null
  signedTx: SignedTx | null
  prevSignedTx: SignedTx | null
}

export type BitcoinPegTx = any
export type BitcoinPegContext = any
