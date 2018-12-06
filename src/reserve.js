'use strict'

let { script } = require('bitcoinjs-lib')

const MAX_SIGNATORIES = 76

const firstSignatory = ({ pubkey, votingPower }) => `
  OP_PUSHDATA1 ${pubkey} OP_CHECKSIG
  OP_IF
    ${uint16(votingPower)}
  OP_ELSE
    OP_0
  OP_ENDIF
`

const nthSignatory = ({ pubkey, votingPower }) => `
  OP_SWAP
  OP_PUSHDATA1 ${pubkey} OP_CHECKSIG
  OP_IF
    ${uint16(votingPower)}
    OP_ADD
  OP_ENDIF
`

const compare = (threshold) => `
  ${uint16(threshold)}
  OP_GREATERTHAN
`

function uint16 (n) {
  if (!Number.isInteger(n)) {
    throw Error('Number must be an integer')
  }
  if (n > 0xffff || n < 0) {
    throw Error('Number must be >= 0 and < 65536')
  }
  return `OP_PUSHDATA1 ${n.toString(16).padStart(4, '0')}`
}

function createWitnessScript (signatories) {
  let totalVotingPower = signatories.reduce((sum, s) => sum + s.votingPower, 0)
  let twoThirdsVotingPower = Math.ceil(totalVotingPower * 2 / 3)

  let asm = `
    ${firstSignatory(signatories[0])}
    ${signatories
        .slice(1)
        .map(nthSignatory)
        .join('\n')}
    ${compare(twoThirdsVotingPower)}
  `

  return script.fromASM(trim(asm))
}

function trim (s) {
  return s
    .split(/\s/g)
    .filter((s) => !!s)
    .join(' ')
}

// gets the array of validators who are in the signatory set.
// note that each will commit to a separate secp256k1 signatory
// key for bitcoin transactions.
function getSignatorySet (validators) {
  let entries = Object.entries(validators)
  entries.sort((a, b) => {
    // sort by voting power, breaking ties with pubkey
    let cmp = b[1] - a[1]
    if (cmp === 0) {
      cmp = b[0] < a[0] ? 1 : -1
    }
    return cmp
  })
  return entries
    .map(([ validatorKey, votingPower ]) =>
      ({ validatorKey, votingPower }))
    .slice(0, MAX_SIGNATORIES)
}

module.exports = {
  createWitnessScript,
  getSignatorySet
}
