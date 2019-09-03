import test from 'ava'
import {
  getVotingPowerThreshold,
  createWitnessScript,
  buildOutgoingTx
} from '../src/reserve'
let seed = require('random-bytes-seed')
let randomBytes = seed('seed')

const validatorMap = {
  'aOSx00CgYJ3/WGNgioJEs91irUHNvy+bV20hRTby7ak=': 10,
  'bbbx00CgYJ3/WGNgioJEs91irUHNvy+bV20hRTby7ak=': 10
}

const signatoryMap = {
  'aOSx00CgYJ3/WGNgioJEs91irUHNvy+bV20hRTby7ak=': randomBytes(32),
  'bbbx00CgYJ3/WGNgioJEs91irUHNvy+bV20hRTby7ak=': randomBytes(32)
}

test('voting power threshold calculation is 2/3 of total', function(t) {
  let signatorySet = [{ votingPower: 30 }, { votingPower: 30 }]
  let votingPowerThreshold = getVotingPowerThreshold(signatorySet)
  t.is(votingPowerThreshold, 40)
})
