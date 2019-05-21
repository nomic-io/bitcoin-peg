module.exports = function(wallaby) {
  return {
    env: {
      type: 'node',
      runner: 'node'
    },
    files: ['src/*.ts'],
    tests: ['test/*.ts'],
    testFramework: 'ava',
    workers: {
      restart: true
    }
  }
}
