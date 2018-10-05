# Proof-of-Stake Bitcoin Sidechains

**Matt Bell ([@mappum](https://twitter.com/mappum))** - [Nomic Hodlings, Inc.](https://blog.nomic.io)

*October 4, 2018*

## Abstract

We present a design for a Bitcoin sidechain based on the [Tendermint](https://tendermint.com) consensus protocol, allowing the development of decentralized networks which coordinate to manage reserves of Bitcoin, allowing for custom application code and smart contracts which use Bitcoin as the native currency. We also avoid the long-range attack problem of proof-of-stake networks by periodically timestamping the sidechain on the Bitcoin blockchain, gaining the security of Bitcoin's proof-of-work in addition to the instant finality of BFT consensus protocols.

## Technical Overview

We assume there exists a Tendermint-based consensus network with a sufficiently secure validator set, which we call the **peg network**. The validators of this network become the signatories of the network's reserves, each with a known Bitcoin-compatible public key (e.g. on the secp256k1 curve) and an integer amount of voting power.

### Reserve Wallet

A **reserve** of Bitcoin is maintained in a decentralized way through use of multisig contracts. No individuals in the network are given custody of the Bitcoin in reserves, but instead the collective whole cooperates to hold or disburse the funds. The validators of the peg network become **signatories** of the reserve, since their signatures are required to control the funds on the Bitcoin blockchain.

To disburse funds from the reserve, more than two-thirds of the validator set must sign the Bitcoin transaction (weighted by voting power). This is enforced on the Bitcoin blockchain through the following Bitcoin script (the **reserve witness script**):

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

### Deposits

To move funds into the reserve pool, depositors can send a Bitcoin transaction which pays to the reserve witness script (derived based on the peg network's known validator set), along with a commitment to the desired destination address in the peg network ledger.

The **deposit transaction** must have exactly two outputs:

1. A pay-to-witness-script-hash with a scriptPubKey that pays to the hash of the reserve witness script. All the coins to be deposited into the reserve are paid into this output.
2. A script which commits to a destination address which will receive the pegged Bitcoin on the peg network ledger (`OP_RETURN <20-byte address>`). This output has an amount of zero.

Any valid Bitcoin transaction which has outputs matching the above description and is confirmed by the network (e.g. by some heuristic such as 6 confirmations deep) can be considered deposited. Relayers then broadcast a **deposit proof** to the peg network, which contains:

- the bytes of the complete deposit transaction data
- the hash of the Bitcoin block which contained the deposit transaction
- the Merkle branch proving the transaction was included in the Bitcoin block's Merkle tree

After the peg network receives a valid deposit proof, it will then mint pegged tokens on its ledger, paid out to the destination address committed to by the depositor. These pegged tokens represent claims on the Bitcoin in reserves, which can later be used to withdraw from the reserves to receive Bitcoin on the Bitcoin blockchain.

### Withdrawals

When an owner of pegged Bitcoin tokens wishes to withdraw from the reserves, or the network wants to disburse funds for any other reason, the pending withdrawal is added to a queue. This queue is processed in the next section as part of the checkpointing process, where all withdrawals will be settled on the main Bitcoin blockchain.

### Checkpoints

Periodically, the network will make transactions on the Bitcoin blockchain which spend from the reserve wallet. These transactions are called **checkpoints**, and serve the purpose of (1) collecting deposits, (2) updating the reserve script to reflect the latest validator set, (3) disbursing pending withdrawals, and (4) providing a way for light clients to verify the state of the peg network secured by the Bitcoin network's proof-of-work.

Each checkpoint is made up of 3 connected Bitcoin transactions, the **deposit collection** transaction, the **checkpoint** transaction, and the **disbursal** transaction.

#### Deposit Collection Transaction

A deposit collection transaction spends all sufficiently confirmed unspent deposit outputs and joins them into a single output. It has a variable number of inputs, depending on the number of pending deposits. It always has exactly one output, paying all the funds to the reserve witness script. If no deposits have been made, no deposit collection transaction will be made.

#### Checkpoint Transaction

A checkpoint transaction spends from unspent deposit collection outputs, and the output of the previous checkpoint transaction. It will have the following structure:

**Inputs:**
- The reserve output of the previous checkpoint transaction.
- *(If there have been deposits)* All unspent deposit collection outputs.

**Outputs:**
- The **reserve output**, equal to the amount of Bitcoin which are to be held in reserve. Paid to the updated reserve witness script based on the most recent validator set.
- *(If there are pending withdrawals)* The **disbursal output**, equal to the total amount of Bitcoin to be disbursed. Paid to the updated reserve witness script based on the most recent validator set.
- The **notary output**, which has a value of zero and pays to an `OP_RETURN` script containing the hash of the latest validator set.

#### Disbursal Transaction

Disbursal transactions spend the second output of the most recent checkpoint transaction, and pay to various outputs to settle any pending withdrawals. Each output pays its respective amount to the script specified in its withdrawal request. If no withdrawals are pending, this transaction does not have to be created.

#### Secure Proof-of-Stake Verification

A known issue of proof-of-stake consensus is the so-called *long-range attack*, where a client verifying the blockchain cannot safely sync if their most recent knowledge about the network is out of date (e.g. the validator set they last knew about may now have *nothing at stake* and can trick the client onto an alternate ledger).

This kind of issue can be solved out-of-band from the proof-of-stake network, e.g. by receiving new knowledge about the network from a trusted third party. However, the Bitcoin checkpointing mechanism allows clients to prevent long-range attacks by utilizing the proof-of-work security of the Bitcoin blockchain.

To securely sync through history to get the latest state of the proof-of-stake peg network, a client will first SPV-verify the headers of the Bitcoin blockchain, ensuring they are on the highest-work chain. After this, the client only needs to possess each checkpoint transaction and its Merkle branch proving its membership in the containing Bitcoin block. The client can securely verify that a checkpoint transaction is the successor of another by ensuring it spends the *reserve output* of the previous checkpoint transaction. By following this chain of checkpoint transactions, the client can ensure that a validator set is the correct one by comparing against the *notary output* of the most recent checkpoint transaction.

While the three transaction types described could be combined into one for simplicity and space savings, we separate these for the purpose of reducing the amount of data for a light client to follow the chain of checkpoints. If all deposits and withdrawals were also contained in the checkpoints, the light client would need to download all this data just to sync through history.

#### Process

Creating these transactions involves each of the signatories (the validators) to deterministically build the transaction, and make public their share of the multisig signature. This can be done by each signatory broadcasting their signature shares to the peg network in a *signature share transaction*, to be collected in the peg network's consensus state. Once at least two-thirds of the voting power are represented in valid signatures, the transactions can be constructed and treated as valid by the Bitcoin network once relayed.

To keep the signatory set as close to the validator set as possible, a checkpoint should be created every time the validator set changes by a certain threshold. Checkpoints can also be made on a certain time interval to decrease the processing time for withdrawals. The frequency can be set by the peg network, but will likely be on the scale of hours.

### Relaying

Whenever a new Bitcoin block is mined, a deposit transaction is broadcast, or a transaction is created in the checkpointing process, the data will need to be carried between the peg network and the Bitcoin network. This job is done by **relayer** nodes, which can be any node with knowledge of both networks.

To sync the Bitcoin block, relayers can broadcast **header transactions** to the peg network, containing Bitcoin blockchain headers. The nodes of the peg network SPV-verify these headers to ensure they know about the highest-work chain and store the resulting chain in their consensus state. In the event of a re-org, the consensus rules should be able to handle transitioning to a higher-work fork.

When a deposit transaction is confirmed in a Bitcoin block, the relay submits a **deposit proof transaction**, containing the data specified in the Deposits section of this document (namely a Merkle proof linking the transaction to a known Bitcoin block header).

When a *deposit collection transaction*, *checkpoint transaction*, or *disbursal transaction* are made, the relayer can submit this data to the Bitcoin gossip network and they will eventually be mined into a block by a Bitcoin miner.

### Safety Rules

To ensure the safety of the money held in reserve, signatories are expected to only sign the transactions detailed in this document, in a deterministic way based on the state of the peg network. If signatories with a sufficient amount of voting power colluded, they could sign a Bitcoin transaction moving the money to an arbitrary script (e.g. their own personal wallets).

While in both proof-of-work and proof-of-stake security models we assume a majority of the miners or validators are honest, we can hold these signatories accountable by creating a rule on the peg network to remove voting power and tokens from any signatory which has signed an unexpected transaction, also known as *slashing*. The likelihood of collusion is then reduced since potential colluders would be able to gain from reporting malicious signatures to the peg network in a **signatory fraud proof transaction**.


### Calculations

One issue is that the Bitcoin Core standardness rules at the time of this writing limit transaction outputs to 3,600 bytes, limiting the number of validators we can fit in the script. Since we require 6 bytes for the check against the two-thirds threshold and each validator uses 47 bytes (even the first one which has a slightly different script), assuming voting power values are 16-bits, we can fit 76 validators into the script.

If the validator set is larger than this limit, we can truncate the signatory set to include only the 76 validators with the most voting power. The other validators are not signatories of the reserve, but still maintain the consensus of the peg network.

Note that the Bitcoin consensus rules actually allow outputs of up to 10,000 bytes, they are only not relayed by full nodes unless mined in a block. So by establishing a relationship with miners to get them to accept non-standard transactions, the signatory set size limit can be raised from 76 to 201 (hitting the consensus limit of 201 signature operations).

#### Fees

Since the reserve witness script in size with the number of validators, it can end up becoming large and creating a high Bitcoin transaction fee cost. However, this is somewhat low since it is contained only in the transaction witness.

At the time of this writing, transactions are confirmed within a reasonable amount of time at a fee rate of 1 satoshi per byte. This means an input that spends the reserve witness script can cost as low as 3,600 satoshis, or a value of $0.24 at the time of this writing.

Only three of these fees are paid by the network per checkpoint, meaning the cost per checkpoint at the time of this writing is about $0.76 (adding in the roughly 200-byte overhead of the non-witness parts of the transactions, which are negligible compared to the reserve witness inputs), a cost sufficiently low to be subsidized by the peg network.

One of these reserve witness fees are also paid per deposit, but this cost can be paid by the depositor rather than subsidizing (by subtracting from the amount of peg tokens credited to the depositor's address in the peg network ledger).

The batching of the disbursal transaction means that all withdrawals share the cost of a single reserve witness fee, making the cost negligible.

### Enhancements

#### Schnorr Signatures

In the future, when the Bitcoin network adopts changes such as a script opcode that verifies Schnorr threshold signatures, the costs of checkpoints can be lowered by combining the signatures of the signatories into a single constant-size signature. This will also create the possibility of scaling to signatory sets much larger than supported today with no extra cost on the Bitcoin blockchain.

#### Emergency Disbursal

Another possible enhancement to the design described in this paper is to create an output path in the reserve witness script, which in the event of stalled consensus of the signatories can be redeemed to disburse all the reserves to their respective claim holders. This **emergency disbursal transaction** would only be valid in the rare event that the signatories are unable to reach consensus for some amount of time.
