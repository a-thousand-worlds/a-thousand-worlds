/**
 * sendEmail: pins the axios request pipeline the email Firebase function is reached through, on
 * the adapter the app actually sends with. axios's default adapter list is ['xhr', 'http', 'fetch']
 * and the browser (like jsdom) has XMLHttpRequest, so the app goes through the xhr adapter. Guarded
 * here: that adapter choice; the query-string URL reaching XMLHttpRequest.open untouched; the
 * request headers AxiosHeaders hands to setRequestHeader, including the guest's bare 'Bearer ';
 * parsing of the raw response-header block and default JSON parsing of responseText; settle's
 * status-to-error mapping with its 'Request failed with status code N' message and
 * ERR_BAD_REQUEST / ERR_BAD_RESPONSE codes; and the xhr adapter's onerror 'Network Error' /
 * ERR_NETWORK error that sendEmail's own message branches on.
 *
 * Boundaries faked: firebase auth at '@/firebase', and the wire at a minimal global
 * XMLHttpRequest. Global fetch is stubbed to fail loudly, so an axios release that stopped
 * choosing xhr fails these tests offline instead of reaching the network.
 */
import axios from 'axios'
import sendEmail from '@/util/sendEmail'

const EMAIL_URL = 'https://email.example.test/sendEmail'

const fake = vi.hoisted(() => ({ auth: { currentUser: null } }))

vi.mock('@/firebase', () => ({ default: { auth: () => fake.auth } }))

/**
 * Replaces XMLHttpRequest with a minimal fake that records what axios's xhr adapter hands it and
 * answers each send() a microtask later through `respond(xhr)`. Returns a function listing every
 * request constructed so far.
 */
const stubXHR = respond => {
  let requests = []

  /** The fake request. onloadend starts null, as on a real XMLHttpRequest, so axios listens on it. */
  function FakeXHR() {
    Object.assign(this, {
      onloadend: null,
      readyState: 0,
      status: 0,
      statusText: '',
      responseText: '',
      responseHeaders: '',
      requestHeaders: {},
    })
    requests = [...requests, this]
  }

  Object.assign(FakeXHR.prototype, {
    open(method, url, async) {
      Object.assign(this, { method, url, async })
    },
    setRequestHeader(name, value) {
      this.requestHeaders = { ...this.requestHeaders, [name]: value }
    },
    getAllResponseHeaders() {
      return this.responseHeaders
    },
    send(body) {
      this.body = body
      queueMicrotask(() => respond(this))
    },
    abort() {},
  })

  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  return () => requests
}

/** Responder that completes the request with a status, body and raw CRLF response-header block. */
const reply =
  (status, statusText, responseText, responseHeaders = '') =>
  xhr => {
    Object.assign(xhr, { readyState: 4, status, statusText, responseText, responseHeaders })
    xhr.onloadend()
  }

/**
 * Responder that fails the request the way a browser does when the host is unreachable: status 0,
 * an 'error' ProgressEvent (which carries no message), then 'loadend'.
 */
const unreachable = xhr => {
  Object.assign(xhr, { readyState: 4, status: 0 })
  xhr.onerror(new ProgressEvent('error'))
  xhr.onloadend()
}

/** Signs in a fake user whose ID token resolves to tok-123; returns the getIdToken mock. */
const signIn = () => {
  const getIdToken = vi.fn(async () => 'tok-123')
  fake.auth.currentUser = { getIdToken }
  return getIdToken
}

/** Resolves with the reason a promise rejects with, and fails if it resolves instead. */
const rejectionOf = promise =>
  promise.then(
    value => {
      throw new Error(`expected a rejection, got ${JSON.stringify(value)}`)
    },
    error => error,
  )

/** The only request constructed, asserting there was exactly one. */
const onlyRequest = requests => {
  expect(requests()).toHaveLength(1)
  return requests()[0]
}

let consoleError
let fetch

beforeEach(() => {
  vi.stubEnv('VUE_APP_EMAIL_URL', EMAIL_URL)
  fake.auth.currentUser = null
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  fetch = vi.fn(async () => {
    throw new Error('unexpected fetch: axios did not send through its xhr adapter')
  })
  vi.stubGlobal('fetch', fetch)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  consoleError.mockRestore()
})

describe('configuration', () => {
  test('rejects without reading auth or opening a request when VUE_APP_EMAIL_URL is empty', async () => {
    vi.stubEnv('VUE_APP_EMAIL_URL', '')
    const requests = stubXHR(reply(200, 'OK', 'sent'))
    const getIdToken = signIn()

    const error = await rejectionOf(
      sendEmail({ to: 'ada@example.org', replyTo: 'admin@example.org', subject: 'Hi', body: 'x' }),
    )

    expect(error.constructor).toBe(Error)
    expect(error.message).toBe('Email service url not configured')
    expect(requests()).toEqual([])
    expect(getIdToken).not.toHaveBeenCalled()
  })
})

describe('request', () => {
  test('goes out through XMLHttpRequest, the default adapter list choosing xhr over fetch', async () => {
    const requests = stubXHR(reply(200, 'OK', 'sent'))

    await sendEmail({
      to: 'ada@example.org',
      replyTo: 'admin@example.org',
      subject: 'Hi',
      body: 'x',
    })

    expect(axios.defaults.adapter).toEqual(['xhr', 'http', 'fetch'])
    const request = onlyRequest(requests)
    expect(request.method).toBe('GET')
    expect(request.async).toBe(true)
    expect(request.timeout).toBe(0)
    expect(request.body).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  test('fills every occurrence of each data key and URI-encodes subject and body into the URL', async () => {
    const requests = stubXHR(reply(200, 'OK', 'sent'))

    await sendEmail({
      to: 'ada@example.org',
      replyTo: 'admin@example.org',
      subject: 'Welcome, FIRST_NAME!',
      body: '<p>Hi FIRST_NAME LAST_NAME</p><p>FIRST_NAME, thanks!</p>',
      data: { FIRST_NAME: 'Ada', LAST_NAME: 'Lovelace' },
    })

    expect(onlyRequest(requests).url).toBe(
      'https://email.example.test/sendEmail?to=ada@example.org&replyTo=admin@example.org' +
        '&subject=Welcome%2C%20Ada!' +
        '&body=%3Cp%3EHi%20Ada%20Lovelace%3C%2Fp%3E%3Cp%3EAda%2C%20thanks!%3C%2Fp%3E',
    )
  })

  test('sends subject and body verbatim apart from URI encoding when there is no data', async () => {
    const requests = stubXHR(reply(200, 'OK', 'sent'))

    await sendEmail({
      to: 'ada@example.org',
      replyTo: 'admin@example.org',
      subject: 'You are invited!',
      body: '<p>FIRST_NAME</p>',
    })

    expect(onlyRequest(requests).url).toBe(
      'https://email.example.test/sendEmail?to=ada@example.org&replyTo=admin@example.org' +
        '&subject=You%20are%20invited!&body=%3Cp%3EFIRST_NAME%3C%2Fp%3E',
    )
  })

  test('the query string decodes back to the contact-form reply-to and the filled fields', async () => {
    const requests = stubXHR(reply(200, 'OK', 'sent'))

    await sendEmail({
      to: 'admin@example.org',
      replyTo: 'Ada Lovelace <ada@example.org>',
      subject: 'Question about FIRST_NAME',
      body: '<i>Message from <a href="mailto:ada@example.org">ada@example.org</a>.</i>',
      data: { FIRST_NAME: 'Ada' },
    })

    const { searchParams } = new URL(onlyRequest(requests).url)
    expect([...searchParams.keys()]).toEqual(['to', 'replyTo', 'subject', 'body'])
    expect(searchParams.get('to')).toBe('admin@example.org')
    expect(searchParams.get('replyTo')).toBe('Ada Lovelace <ada@example.org>')
    expect(searchParams.get('subject')).toBe('Question about Ada')
    expect(searchParams.get('body')).toBe(
      '<i>Message from <a href="mailto:ada@example.org">ada@example.org</a>.</i>',
    )
  })

  test("sets exactly Accept and the signed-in user's Bearer ID token as request headers", async () => {
    const requests = stubXHR(reply(200, 'OK', 'sent'))
    const getIdToken = signIn()

    await sendEmail({
      to: 'ada@example.org',
      replyTo: 'admin@example.org',
      subject: 'Hi',
      body: 'x',
    })

    expect(getIdToken).toHaveBeenCalledTimes(1)
    expect(onlyRequest(requests).requestHeaders).toEqual({
      Accept: 'application/json, text/plain, */*',
      Authorization: 'Bearer tok-123',
    })
  })

  test("a guest (no current user) sets Authorization to 'Bearer ' with its trailing space", async () => {
    const requests = stubXHR(reply(200, 'OK', 'sent'))

    await sendEmail({
      to: 'admin@example.org',
      replyTo: 'admin@example.org',
      subject: 'Hi',
      body: 'x',
    })

    expect(onlyRequest(requests).requestHeaders).toEqual({
      Accept: 'application/json, text/plain, */*',
      Authorization: 'Bearer ',
    })
  })
})

describe('response', () => {
  test('resolves with the axios response for a plain-text body', async () => {
    stubXHR(reply(200, 'OK', 'sent'))

    const result = await sendEmail({
      to: 'ada@example.org',
      replyTo: 'admin@example.org',
      subject: 'Hi',
      body: 'x',
    })

    expect(result.data).toBe('sent')
    expect(result.status).toBe(200)
    expect(result.statusText).toBe('OK')
    expect(consoleError).not.toHaveBeenCalled()
  })

  test("parses the email function's JSON success body and raw response-header block", async () => {
    stubXHR(
      reply(
        200,
        'OK',
        '{"id":"msg-1"}',
        'content-type: application/json; charset=utf-8\r\nx-cloud-trace-context: abc/1\r\n',
      ),
    )

    const result = await sendEmail({
      to: 'ada@example.org',
      replyTo: 'admin@example.org',
      subject: 'Hi',
      body: 'x',
    })

    expect(result.data).toEqual({ id: 'msg-1' })
    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(result.headers['x-cloud-trace-context']).toBe('abc/1')
  })
})

describe('failures', () => {
  test('an unreachable host becomes the "Is the email Firebase function running?" error', async () => {
    stubXHR(unreachable)

    const error = await rejectionOf(
      sendEmail({ to: 'ada@example.org', replyTo: 'admin@example.org', subject: 'Hi', body: 'x' }),
    )

    expect(error.constructor).toBe(Error)
    expect(error.message).toBe(
      'Network Error. Is the email Firebase function running? https://email.example.test/sendEmail',
    )
    expect(consoleError).toHaveBeenCalledTimes(1)
    const [logged] = consoleError.mock.calls[0]
    expect(axios.isAxiosError(logged)).toBe(true)
    expect(logged.message).toBe('Network Error')
    expect(logged.code).toBe('ERR_NETWORK')
    expect(logged.response).toBeUndefined()
  })

  test.each([
    [401, 'Unauthorized', 'Not authorized.', 'ERR_BAD_REQUEST'],
    [403, 'Forbidden', 'Not authorized.', 'ERR_BAD_REQUEST'],
    [500, 'Internal Server Error', 'boom', 'ERR_BAD_RESPONSE'],
  ])(
    'HTTP %i rejects with "Error sending email: Request failed…"',
    async (status, statusText, body, code) => {
      stubXHR(reply(status, statusText, body))

      const error = await rejectionOf(
        sendEmail({
          to: 'ada@example.org',
          replyTo: 'admin@example.org',
          subject: 'Hi',
          body: 'x',
        }),
      )

      expect(error.constructor).toBe(Error)
      expect(error.message).toBe(`Error sending email: Request failed with status code ${status}`)
      expect(consoleError).toHaveBeenCalledTimes(1)
      const [logged] = consoleError.mock.calls[0]
      expect(axios.isAxiosError(logged)).toBe(true)
      expect(logged.code).toBe(code)
      expect(logged.response.status).toBe(status)
      expect(logged.response.data).toBe(body)
    },
  )
})
