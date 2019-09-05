import { Output, Input } from 'bitcoinjs-lib/types/transaction'

/**
 * Lotion-style map of validator public key to voting power.
 */
export interface ValidatorMap {
  [index: string]: number
}

export enum KeyType {
  Ed25519 = 'tendermint/PrivKeyEd25519'
}

export interface LightClient {
  send(tx: BitcoinPegTx): Promise<any>
  state: any
  validators: Array<{
    address: string
    pub_key: { value: string; type: KeyType }
    voting_power: number
  }>
}

export type BitcoinNetwork = 'regtest' | 'testnet' | 'mainnet'

/**
 * Maps validator public key (base64) to signatory public key (buffer)
 */

export interface SignatoryKeyMap {
  [index: string]: Buffer
}

export interface ValidatorKey {
  priv_key: {
    type: KeyType
    value: string
  }
  pub_key: {
    type: KeyType
    value: string
  }
  address: string
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
export interface MerkleProof {
  flags: number[]
  hashes: Buffer[]
  merkleRoot: Buffer
  numTransactions: number
}

export interface SignatorySet {
  utxos: UTXO[]
  signatoryKeys: SignatoryKeyMap
  validators: {
    [pubkey: string]: number
  }
  prevSignedTx: SignedTx | null
  signingTx: SigningTx | null
  signedTx: SignedTx | null
}
export interface BitcoinPegState {
  chain: Header[]
  processedTxs: {
    [txid: string]: true
  }
  currentP2ssAddress: string
  withdrawals: Withdrawal[]
  signatorySets: {
    [p2ssAddress: string]: SignatorySet
  }
}

export interface BitcoinPegHeadersTx {
  headers: Header[]
}
export function isHeadersTx(tx: any): tx is BitcoinPegHeadersTx {
  return tx.headers instanceof Array
}
export interface BitcoinPegDepositTx {
  transactions: []
  height: number
  proof: MerkleProof
}
export function isDepositTx(tx: any): tx is BitcoinPegDepositTx {
  return tx.transactions instanceof Array
}
export interface BitcoinPegSignatoryCommitmentTx {
  signatoryKey: Buffer
  signatoryIndex: number
  signature: Buffer
}
export function isSignatoryCommitmentTx(
  tx: any
): tx is BitcoinPegSignatoryCommitmentTx {
  return Buffer.isBuffer(tx.signatoryKey)
}

export interface BitcoinPegSignatureTx {
  signatures: Buffer[]
  signatoryIndex: number
}
export function isSignatureTx(tx: any): tx is BitcoinPegSignatureTx {
  return tx.signatures instanceof Array
}

export type BitcoinPegTx = (
  | BitcoinPegHeadersTx
  | BitcoinPegDepositTx
  | BitcoinPegSignatoryCommitmentTx
  | BitcoinPegSignatureTx) & { type: 'bitcoin' }

export type BitcoinPegContext = any

// RPC types
export interface RPCTransaction {
  address: string
  category: 'receive' | 'send' // others?
  amount: number
  label: string
  vout: number
  confirmations: number
  blockhash: string
  blockindex: number
  blocktime: number
  txid: string
  time: number
  timereceived: number
}
export interface RPCHeader {
  hash: string
  confirmations: number
  height: number
  version: number
  versionHex: string
  merkleroot: string
  time: number
  mediantime: number
  nonce: number
  bits: string
  difficulty: string
  chainwork: string
  nTx: number
  previousblockhash: string
  nextblockhash: string
}

export interface RPCBlockTx {
  txid: string
  hash: string
  version: number
  size: number
  vsize: number
  weight: number
  locktime: number
  vin: [{ coinbase: string; sequence: number }]
  vout: {
    value: number
    n: number
    scriptPubKey: Array<{
      asm: string
      hex: string
      reqSigs: number
      type: 'scripthash' | 'nulldata'
      addresses: string[]
    }>
  }

  hex: string
}

export interface RPCBlock {
  hash: string
  confirmations: number
  strippedsize: number
  size: number
  weight: number
  height: number
  version: number
  versionHex: string
  merkleroot: string
  tx: RPCBlockTx[]
}

export interface BitcoinRPC {
  listTransactions(
    label?: string,
    count?: number,
    skip?: number,
    includeWatchOnly?: boolean
  ): RPCTransaction[]

  getBlock(blockHash: string, verbosity?: number): RPCBlock
  getBlockHeader(blockHash: string): RPCHeader

  getBestBlockHash(): string
  importAddress(
    addressOrScript: string,
    label?: string,
    rescan?: boolean,
    p2sh?: boolean
  ): void

  sendRawTransaction(txHex: string): string
}
