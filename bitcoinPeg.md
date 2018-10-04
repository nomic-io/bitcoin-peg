# Proof-of-Stake Bitcoin Sidechains

**Matt Bell ([@mappum](https://twitter.com/mappum))** - [Nomic Hodlings, Inc.](https://blog.nomic.io)

*October 4, 2018*

## Abstract

We present a design for a Bitcoin sidechain based on the [Tendermint](https://tendermint.com) consensus protocol, allowing the development of decentralized networks which coordinate to manage reserves of Bitcoin, allowing for custom application code and smart contracts which use Bitcoin as the native currency. We also avoid the long-range attack problem of proof-of-stake networks by periodically timestamping the sidechain on the Bitcoin blockchain, gaining the security of Bitcoin's proof-of-work in addition to the instant finality of BFT consensus protocols.

## Technical Overview

We assume there exists a Tendermint-based consensus network with a sufficiently secure validator set, which we call the **peg network**. The validators of this network become the signatories of the network's reserves, each with a known Bitcoin-compatible public key (e.g. on the secp256k1 curve) and an integer amount of voting power.

### Reserve Wallet

A **reserve** of Bitcoin is maintained in a decentralized way through use of multisig contracts. No individuals in the network are given custody of the Bitcoin in reserves, but instead the collective whole cooperates to hold or disburse the funds.

To disburse funds from the reserve, more than `2 / 3` of the validator set must sign the Bitcoin transaction (weighted by voting power). This is enforced on the Bitcoin blockchain through the following Bitcoin script (the **reserve witness script**):

```
<pubkey1> OP_CHECKSIG
OP_IF
  <voting_power1>
OP_ELSE
  0
OP_ENDIF

OP_SWAP
<pubkey2> OP_CHECKSIG
OP_IF
  <voting_power2>
  OP_ADD
OP_ENDIF

OP_SWAP
<pubkey...> OP_CHECKSIG
OP_IF
  <voting_power...>
  OP_ADD
OP_ENDIF

OP_SWAP
<pubkeyN> OP_CHECKSIG
OP_IF
  <voting_powerN>
  OP_ADD
OP_ENDIF

<two_thirds_of_total_voting_power>
OP_GREATERTHAN
```

Note that this script does not require any new functionality to be added to the Bitcoin protocol, and so can already be deployed and accepted by the Bitcoin network at the time of this writing.

The validators in this script are given a canonical ordering: descending by their respective amounts of voting power, and when voting power is equal, ordered ascending lexicographically by public key.

**TODO:** calculations about script size restrictions, etc.

### Deposits

To move funds into the reserve pool, depositors can send a Bitcoin transaction which pays to the reserve witness script (derived based on the peg network's known validator set), along with a commitment to the desired destination address in the peg network ledger.

The **deposit transaction** must have exactly two outputs:

1. A pay-to-witness-script-hash with a scriptPubKey that pays to the hash of the reserve witness script. All the coins to be deposited into the reserve are paid into this output.
2. A script which commits to a destination address which will receive the pegged Bitcoin on the peg network ledger (`OP_RETURN <20-byte address>`). This output has an amount of zero.

Any valid Bitcoin transaction which has outputs matching the above description and is confirmed by the network (e.g. by some heuristic such as 6 confirmations deep) can be considered deposited. Relayers then broadcast a **deposit proof** to the peg network, which contains:

- the bytes of the complete deposit transaction data
- the hash of the Bitcoin block which contained the deposit transaction
- the Merkle branch proving the transaction was included in the Bitcoin block's Merkle tree

After the peg network receives a valid deposit proof, it will then mint pegged Bitcoin tokens on its ledger, paid out to the destination address committed to by the depositor. These pegged tokens represent claims on the Bitcoin in reserves, which can later be used to withdraw from the reserves to receive Bitcoin on the Bitcoin blockchain.

### Withdrawals

### Checkpoints

### Relaying

### Safety Rules
