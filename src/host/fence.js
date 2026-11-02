/**
 * Request fence for the plugin's HTTP routes.
 *
 * The routes are same-origin resources on a local, cookie-authenticated server.
 * This fence is not an identity check; it rejects DNS-rebinding style hosts and
 * cross-site browser requests, mirroring the Host `/api` route's posture.
 *
 * Accepted hosts: loopback names, the Web server's advertised origin, and any
 * `DSH_QUICK_NOTES_ALLOWED_HOSTS` entries (comma separated, `*` disables the
 * host check for a remote-access proxy that rewrites `Host`).
 */
import { isIP } from 'node:net'

/** Hostnames that always identify this machine. */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** Environment override for additional trusted hostnames. */
export const TRUSTED_HOSTS_ENV = 'DSH_QUICK_NOTES_ALLOWED_HOSTS'

/**
 * Extract the hostname part of a Host header, including bracketed IPv6.
 * @param hostHeader - raw Host header.
 * @returns the lower-cased hostname, or '' when malformed.
 */
export function hostnameOf(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader === '') return ''
  const value = hostHeader.trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end < 0 ? '' : value.slice(0, end + 1)
  }
  const colon = value.lastIndexOf(':')
  return colon < 0 ? value : value.slice(0, colon)
}

/**
 * Resolve the hostnames the fence accepts.
 * @param options - `getOrigin()` returning the Web server origin, plus env override.
 * @returns the accepted set, or null when the host check is disabled.
 */
export function resolveTrustedHosts({ getOrigin, env = process.env } = {}) {
  const override = env[TRUSTED_HOSTS_ENV]
  if (typeof override === 'string' && override.trim() === '*') return null
  const hosts = new Set(LOOPBACK_HOSTNAMES)
  try {
    const origin = getOrigin?.()
    if (typeof origin === 'string' && origin !== '') {
      const hostname = hostnameOf(new URL(origin).host)
      if (hostname !== '') hosts.add(hostname)
    }
  } catch {
    /* An unavailable origin leaves the loopback list in place. */
  }
  if (typeof override === 'string') {
    for (const part of override.split(',')) {
      const hostname = hostnameOf(part.trim())
      if (hostname !== '') hosts.add(hostname)
    }
  }
  return hosts
}

/**
 * Create the fence used by every route.
 * @param options - `getOrigin`, optional env, optional logger.
 * @returns a function returning `{ ok: true }` or `{ ok: false, status, reason }`.
 */
export function createRequestFence({ getOrigin, env = process.env, logger = null } = {}) {
  const trusted = resolveTrustedHosts({ getOrigin, env })
  return function check(request) {
    const headers = request?.headers ?? {}
    const host = typeof headers.host === 'string' ? headers.host : ''
    if (host === '') return { ok: false, status: 403, reason: 'missing host' }
    const hostname = hostnameOf(host)
    if (hostname === '' || !isValidHostname(hostname)) {
      return { ok: false, status: 403, reason: 'malformed host' }
    }
    if (trusted !== null && !trusted.has(hostname)) {
      return { ok: false, status: 403, reason: 'untrusted host' }
    }
    if (String(headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') {
      return { ok: false, status: 403, reason: 'cross-site request' }
    }
    const origin = typeof headers.origin === 'string' ? headers.origin : ''
    if (origin !== '' && !sameAuthority(origin, host)) {
      return { ok: false, status: 403, reason: 'origin mismatch' }
    }
    const referer = typeof headers.referer === 'string' ? headers.referer : ''
    if (origin === '' && referer !== '' && !sameAuthority(referer, host)) {
      return { ok: false, status: 403, reason: 'referer mismatch' }
    }
    if (logger !== null && trusted === null) logger?.debug?.('quick-notes: host fence disabled')
    return { ok: true }
  }
}

/**
 * Whether a hostname is a plausible DNS name or IP literal.
 * @param hostname - candidate hostname.
 * @returns whether it is valid.
 */
function isValidHostname(hostname) {
  if (hostname === 'localhost') return true
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (isIP(bare) !== 0) return true
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
    hostname,
  )
}

/**
 * Whether a URL's authority equals the request Host.
 * @param urlText - absolute URL from Origin/Referer.
 * @param hostHeader - request Host header.
 * @returns whether they match.
 */
function sameAuthority(urlText, hostHeader) {
  try {
    const url = new URL(urlText)
    return url.host.toLowerCase() === hostHeader.trim().toLowerCase()
  } catch {
    return false
  }
}
