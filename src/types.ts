/**
 * Lotion-style map of validator public key to voting power.
 */
export interface ValidatorMap {
  [index: string]: number
}

export interface SignatoryMap {
  [index: string]: Buffer
}
