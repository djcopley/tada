import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import type { LiveActivityProps } from '@tada/shared'
import { describe, expect, test } from 'vitest'
import { type ApnsCredentials, apnsJwt, apnsRequest } from '../src/apns.js'

const { privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const creds: ApnsCredentials = {
  key: privateKey,
  keyId: 'ABC1234567',
  teamId: 'TEAM123456',
  bundleId: 'dev.copley.tada',
  env: 'sandbox',
}

const props: LiveActivityProps = {
  runId: 4128,
  ticketId: 7,
  title: 'Add CSV export to the reports page',
  phase: 'yourTurn',
  agentLine: 'wants to: push a branch — git push origin main',
  startedAt: 1_755_500_000_000,
  actions: [{ kind: 'approve', label: 'Approve' }],
}

const now = new Date('2026-08-18T03:14:00Z')

test('an update carries the stringified props under the expo-widgets content state', () => {
  const req = apnsRequest({ token: 'ff00', event: 'update', props, priority: 10, now }, creds)
  const body = JSON.parse(req.body)

  expect(req.path).toBe('/3/device/ff00')
  expect(req.headers['apns-push-type']).toBe('liveactivity')
  expect(req.headers['apns-topic']).toBe('dev.copley.tada.push-type.liveactivity')
  expect(req.headers['apns-priority']).toBe('10')
  expect(body.aps.event).toBe('update')
  expect(body.aps.timestamp).toBe(Math.floor(now.getTime() / 1000))
  expect(body.aps['content-state'].name).toBe('TadaRun')
  // The one that breaks silently: props is a STRING, not an object.
  expect(typeof body.aps['content-state'].props).toBe('string')
  expect(JSON.parse(body.aps['content-state'].props)).toEqual(props)
})

test('a start asks for the push token back and declares the attributes type', () => {
  const req = apnsRequest(
    { token: 'ff00', event: 'start', props, priority: 5, inputPushToken: true, now },
    creds,
  )
  const body = JSON.parse(req.body)
  expect(body.aps['input-push-token']).toBe(1)
  expect(body.aps['attributes-type']).toBe('LiveActivityAttributes')
  expect(body.aps.attributes).toEqual({})
  expect(req.headers['apns-priority']).toBe('5')
})

test('an end carries a dismissal date and no alert', () => {
  const req = apnsRequest(
    {
      token: 'ff00',
      event: 'end',
      props,
      priority: 5,
      dismissalDate: new Date(now.getTime() + 4000),
      now,
    },
    creds,
  )
  const body = JSON.parse(req.body)
  expect(body.aps.event).toBe('end')
  expect(body.aps['dismissal-date']).toBe(Math.floor((now.getTime() + 4000) / 1000))
  expect(body.aps.alert).toBeUndefined()
})

test('an alert rides along only when one is given', () => {
  const req = apnsRequest(
    {
      token: 'ff00',
      event: 'update',
      props,
      priority: 10,
      alert: { title: 'tada', body: 'stopped on you' },
      now,
    },
    creds,
  )
  expect(JSON.parse(req.body).aps.alert).toEqual({ title: 'tada', body: 'stopped on you' })
})

describe('the authentication token', () => {
  test('is an ES256 JWT Apple can verify, naming the key and the team', () => {
    const jwt = apnsJwt(creds, now)
    // noUncheckedIndexedAccess makes split()'s elements `string | undefined`; a JWT is always
    // three dot-separated parts, so the non-null assertions are safe here.
    const [rawHeader, rawClaims, rawSig] = jwt.split('.') as [string, string, string]
    const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString())
    const claims = JSON.parse(Buffer.from(rawClaims, 'base64url').toString())

    expect(header).toEqual({ alg: 'ES256', kid: 'ABC1234567' })
    expect(claims).toEqual({ iss: 'TEAM123456', iat: Math.floor(now.getTime() / 1000) })

    // JOSE signatures are fixed-width r‖s (64 bytes for P-256), not the DER form createSign emits.
    const sig = Buffer.from(rawSig, 'base64url')
    expect(sig.length).toBe(64)

    const verifier = createVerify('SHA256')
    verifier.update(`${rawHeader}.${rawClaims}`)
    expect(
      verifier.verify({ key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, sig),
    ).toBe(true)
  })
})
