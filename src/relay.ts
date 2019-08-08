interface RelayOptions {
  bitcoinRPC: any
  lotionLightClient: any
  pollIntervalSeconds?: number
}

/**
 * Watches a Bitcoin full node for deposits to the signatory address.
 *
 * The Relay will poll its Bitcoin full node at regular
 * intervals to check for deposits to the signatory address.
 *
 * When it finds a Bitcoin deposit transaction, the Relay will first ensure
 * that the peg zone has received a chain of Bitcoin headers up to the block containing
 * the deposit transaction, then create and transmit a peg zone deposit transaction.
 *
 */
export class Relay {
  private bitcoinRPC: any
  private pollIntervalSeconds: number = 10
  private lotionLightClient: any

  constructor(relayOpts: RelayOptions) {
    this.bitcoinRPC = relayOpts.bitcoinRPC
    if (relayOpts.pollIntervalSeconds) {
      this.pollIntervalSeconds = relayOpts.pollIntervalSeconds
    }
    this.lotionLightClient = relayOpts.lotionLightClient
  }
  start() {}

  /**
   * Process all actions required by state updates on the peg zone or Bitcoin.
   *
   * Returns a promise which resolves when all necessary actions (such as relaying deposits) have been completed.
   */
  async step() {
    // Check for Bitcoin deposits
    let rpc = this.bitcoinRPC
    let lc = this.lotionLightClient
    // Get current weighted multisig address

    console.log(rpc)
  }
}
