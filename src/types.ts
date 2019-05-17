/**
 * Lotion-style map of validator public key to voting power.
 */
export interface ValidatorMap {
  [index: string]: number
}

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
}
