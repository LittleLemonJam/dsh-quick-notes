/**
 * Unit tests for the same-origin request fence.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createRequestFence,
  hostnameOf,
  resolveTrustedHosts,
  TRUSTED_HOSTS_ENV,
} from '../../src/host/fence.js'

/**
 * Build a request-like object.
 * @param headers - request headers.
 * @returns the request.
 */
function request(headers) {
  return { headers }
}

test('hostnameOf handles host:port, IPv4 and bracketed IPv6', () => {
  assert.equal(hostnameOf('127.0.0.1:58587'), '127.0.0.1')
  assert.equal(hostnameOf('localhost'), 'localhost')
  assert.equal(hostnameOf('[::1]:8080'), '[::1]')
  assert.equal(hostnameOf(''), '')
})

test('resolveTrustedHosts includes loopback and the Web server origin', () => {
  const hosts = resolveTrustedHosts({
    getOrigin: () => 'http://127.0.0.1:58587',
    env: {},
  })
  assert.ok(hosts.has('127.0.0.1'))
  assert.ok(hosts.has('localhost'))
  assert.ok(hosts.has('[::1]'))
})

test('resolveTrustedHosts honours the env override and the wildcard', () => {
  const hosts = resolveTrustedHosts({
    getOrigin: () => undefined,
    env: { [TRUSTED_HOSTS_ENV]: 'notes.example.test:8443' },
  })
  assert.ok(hosts.has('notes.example.test'))
  assert.equal(
    resolveTrustedHosts({ getOrigin: () => undefined, env: { [TRUSTED_HOSTS_ENV]: '*' } }),
    null,
  )
})

test('the fence accepts same-origin loopback requests', () => {
  const fence = createRequestFence({ getOrigin: () => 'http://127.0.0.1:58587', env: {} })
  assert.deepEqual(
    fence(
      request({
        host: '127.0.0.1:58587',
        origin: 'http://127.0.0.1:58587',
        'sec-fetch-site': 'same-origin',
      }),
    ),
    { ok: true },
  )
  assert.deepEqual(fence(request({ host: 'localhost:58587' })), { ok: true })
})

test('the fence rejects untrusted hosts, cross-site requests and origin mismatches', () => {
  const fence = createRequestFence({ getOrigin: () => 'http://127.0.0.1:58587', env: {} })
  assert.equal(fence(request({ host: 'evil.example' })).status, 403)
  assert.equal(fence(request({ host: '' })).status, 403)
  assert.equal(
    fence(request({ host: '127.0.0.1:58587', 'sec-fetch-site': 'cross-site' })).status,
    403,
  )
  assert.equal(
    fence(request({ host: '127.0.0.1:58587', origin: 'http://evil.example' })).status,
    403,
  )
  assert.equal(
    fence(request({ host: '127.0.0.1:58587', referer: 'http://evil.example/page' })).status,
    403,
  )
  assert.equal(
    fence(request({ host: '127.0.0.1:58587', referer: 'http://127.0.0.1:58587/' })).ok,
    true,
  )
})

test('the wildcard override disables only the host check', () => {
  const fence = createRequestFence({
    getOrigin: () => undefined,
    env: { [TRUSTED_HOSTS_ENV]: '*' },
  })
  assert.equal(fence(request({ host: 'notes.example.test' })).ok, true)
  assert.equal(
    fence(request({ host: 'notes.example.test', 'sec-fetch-site': 'cross-site' })).ok,
    false,
  )
})
