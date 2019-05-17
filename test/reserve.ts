import test from 'ava'
import { getVotingPowerThreshold } from '../src/reserve'

test('voting power threshold calculation is 2/3 of total', function(t) {
  let signatorySet = [{ votingPower: 30 }, { votingPower: 30 }]
  let votingPowerThreshold = getVotingPowerThreshold(signatorySet)
  t.is(votingPowerThreshold, 40)
})
