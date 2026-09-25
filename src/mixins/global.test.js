/**
 * Characterization tests for the global mixin ($can, $iam, $allowedInviteeRoles, $dateFormat,
 * $uiBusy), the v-click-outside directive, the rights table behind them, and computedFromState.
 *
 * Dependency seams guarded. From vue 3.5: global mixin merging with a component's own options,
 * template and computed re-rendering on Vuex state, directive beforeMount/unmounted hooks
 * (including v-if removal), and computed() outside a component. From vuex 4: store.state
 * reactivity driving templates, computeds and the unbound mixin methods. From dayjs: the
 * 'D MMM YY' format, local-time string parsing, and undefined/null/invalid inputs. From jsdom 24:
 * click bubbling to document.body, stopPropagation, and localStorage persistence of
 * impersonation. From @testing-library/vue and @testing-library/jest-dom: render, unmount and
 * cleanup, and the toHaveTextContent, toBeDisabled, toBeEnabled and toBeInTheDocument matchers.
 */
import { nextTick } from 'vue'
import { fireEvent, screen } from '@testing-library/vue'
import { render } from '@/test-helpers'
import store from '@/store'
import mixins from '@/mixins/global'
import { rights } from '@/rights'
import computedFromState from '@/util/computedFromState'

const { $can, $iam, $allowedInviteeRoles, $dateFormat } = mixins.methods

const actions = [
  'invite',
  'manageCollections',
  'manageInvites',
  'editContent',
  'editEmailTemplates',
  'review',
  'submitBookOrBundle',
  'submitPerson',
  'viewDashboard',
]

/** Signs in a user with the given roles on top of the authorized flag every signed-in user has. */
const signIn = roles =>
  store.commit('user/setUser', {
    uid: 'u1',
    email: 'ada@example.org',
    roles: { authorized: true, ...roles },
  })

/** Returns the actions the current user may perform, in rights.js order. */
const allowedActions = () => actions.filter(action => $can(action))

afterEach(() => {
  store.commit('user/impersonate', null)
  store.commit('user/setUser', null)
  store.commit('ui/setBusy', false)
  store.commit('ui/setViewMode', 'covers')
  localStorage.clear()
  vi.useRealTimers()
})

describe('$can and $uiBusy in rendered templates', () => {
  test('$can in a template follows sign-in and impersonation commits', async () => {
    render({
      template: `<p data-testid="verdict">{{ $can('review') ? 'Can review' : 'Cannot review' }}</p>`,
    })
    const verdict = screen.getByTestId('verdict')
    expect(verdict).toHaveTextContent(/^Cannot review$/)

    signIn({ advisor: true })
    await nextTick()
    expect(verdict).toHaveTextContent(/^Can review$/)

    store.commit('user/impersonate', 'contributor')
    await nextTick()
    expect(verdict).toHaveTextContent(/^Cannot review$/)
  })

  test('$uiBusy disables a bound button while ui.busy is true', async () => {
    render({ template: `<button :disabled="$uiBusy">Save</button>` })
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeEnabled()

    store.commit('ui/setBusy', true)
    await nextTick()
    expect(button).toBeDisabled()

    store.commit('ui/setBusy', false)
    await nextTick()
    expect(button).toBeEnabled()
  })

  test("the global mixin merges with a component's own data, computed and methods", async () => {
    render({
      data: () => ({ label: 'Publish' }),
      computed: {
        canEdit() {
          return this.$can('editContent')
        },
      },
      methods: {
        caption() {
          return `${this.label} as ${this.$iam('owner') ? 'owner' : 'visitor'}`
        },
      },
      template: `<button :disabled="$uiBusy || !canEdit">{{ caption() }}</button>`,
    })
    expect(screen.getByRole('button', { name: 'Publish as visitor' })).toBeDisabled()

    signIn({ owner: true })
    await nextTick()
    expect(screen.getByRole('button', { name: 'Publish as owner' })).toBeEnabled()

    store.commit('ui/setBusy', true)
    await nextTick()
    expect(screen.getByRole('button', { name: 'Publish as owner' })).toBeDisabled()
  })
})

describe('permission matrix', () => {
  test('rights.js declares exactly these actions, in this order', () => {
    expect(Object.keys(rights)).toEqual(actions)
  })

  test.each([
    ['guest', null, []],
    ['user', { user: true }, ['invite']],
    ['contributor', { contributor: true }, ['invite', 'submitBookOrBundle', 'viewDashboard']],
    ['creator', { creator: true }, ['invite', 'submitPerson', 'viewDashboard']],
    [
      'advisor',
      { advisor: true },
      ['invite', 'manageInvites', 'review', 'submitBookOrBundle', 'viewDashboard'],
    ],
    ['owner', { owner: true }, actions],
  ])('a %s may perform exactly the expected actions', (name, roles, expected) => {
    if (roles) signIn(roles)
    expect(allowedActions()).toEqual(expected)
  })

  test('an unknown action throws, even for an owner', () => {
    expect(() => $can('fly')).toThrow('Unrecognized action name: "fly"')
    signIn({ owner: true })
    expect(() => $can('fly')).toThrow('Unrecognized action name: "fly"')
  })

  test.each([
    ['guest', null, []],
    ['user', { user: true }, ['user']],
    ['contributor', { contributor: true }, ['user']],
    ['creator', { creator: true }, ['user']],
    ['advisor', { advisor: true }, ['user', 'contributor', 'creator', 'advisor']],
    ['owner', { owner: true }, ['user', 'contributor', 'creator', 'advisor', 'owner']],
  ])('a %s may invite exactly the expected roles', (name, roles, expected) => {
    if (roles) signIn(roles)
    expect($allowedInviteeRoles()).toEqual(expected)
  })

  test('the route guard in main.js admits advisors and owners only', () => {
    const guard = () => ['advisor', 'owner'].some($iam)
    expect(guard()).toBe(false)

    signIn({ contributor: true })
    expect(guard()).toBe(false)

    signIn({ advisor: true })
    expect(guard()).toBe(true)

    signIn({ owner: true })
    expect(guard()).toBe(true)
  })
})

describe('impersonation', () => {
  test('an owner impersonating an advisor gets exactly the advisor rights', () => {
    signIn({ owner: true })
    store.commit('user/impersonate', 'advisor')

    expect($iam('owner')).toBe(false)
    expect($iam('advisor')).toBe(true)
    // authorized is read from the real roles, never from the impersonated one
    expect($iam('authorized')).toBe(true)
    expect($can('manageCollections')).toBe(false)
    expect($can('review')).toBe(true)
    expect($allowedInviteeRoles()).toEqual(['user', 'contributor', 'creator', 'advisor'])
    expect(localStorage.getItem('impersonate')).toBe('advisor')
  })

  test('ending impersonation clears localStorage and restores owner rights', () => {
    signIn({ owner: true })
    store.commit('user/impersonate', 'advisor')
    expect($can('manageCollections')).toBe(false)

    store.commit('user/impersonate', null)
    expect(localStorage.getItem('impersonate')).toBeNull()
    expect(store.state.user.impersonate).toBeNull()
    expect($can('manageCollections')).toBe(true)
  })

  test('impersonation stored in localStorage is restored when the user signs in', () => {
    localStorage.setItem('impersonate', 'contributor')
    signIn({ owner: true })

    expect(store.state.user.impersonate).toBe('contributor')
    expect($iam('owner')).toBe(false)
    expect($can('submitBookOrBundle')).toBe(true)
    expect(allowedActions()).toEqual(['invite', 'submitBookOrBundle', 'viewDashboard'])
  })
})

describe('$dateFormat', () => {
  test('formats a date-only string as local "D MMM YY"', () => {
    expect($dateFormat('2026-09-24')).toBe('24 Sep 26')
    expect($dateFormat('2005-03-07')).toBe('7 Mar 05')
  })

  test('formats a local Date, a local date-time string, and a timestamp', () => {
    expect($dateFormat(new Date(2026, 0, 5))).toBe('5 Jan 26')
    expect($dateFormat('2026-12-31T23:30:00')).toBe('31 Dec 26')
    expect($dateFormat(new Date(2026, 6, 4, 12).getTime())).toBe('4 Jul 26')
  })

  test('formats the current date when called with no argument', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 24, 12))
    expect($dateFormat()).toBe('24 Sep 26')
  })

  test('returns "Invalid Date" for null and unparseable input', () => {
    expect($dateFormat(null)).toBe('Invalid Date')
    expect($dateFormat('not a date')).toBe('Invalid Date')
  })
})

describe('v-click-outside', () => {
  test('calls the handler for clicks outside the bound element only', async () => {
    const onOutside = vi.fn()
    render({
      methods: { onOutside },
      template: `
        <div>
          <div v-click-outside="onOutside" data-testid="menu">
            <button>Inside</button>
          </div>
          <button>Elsewhere</button>
        </div>
      `,
    })
    const menu = screen.getByTestId('menu')

    await fireEvent.click(screen.getByRole('button', { name: 'Inside' }))
    await fireEvent.click(menu)
    expect(onOutside).not.toHaveBeenCalled()

    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    await fireEvent.click(elsewhere)
    expect(onOutside).toHaveBeenCalledTimes(1)
    const [event, el] = onOutside.mock.calls[0]
    expect(event.type).toBe('click')
    expect(event.target).toBe(elsewhere)
    expect(el).toBe(menu)

    await fireEvent.click(document.body)
    expect(onOutside).toHaveBeenCalledTimes(2)
    expect(onOutside.mock.calls[1][0].target).toBe(document.body)
    expect(onOutside.mock.calls[1][1]).toBe(menu)
  })

  test('with two bound elements, a click inside one calls only the other handler', async () => {
    const onOutsideA = vi.fn()
    const onOutsideB = vi.fn()
    render({
      methods: { onOutsideA, onOutsideB },
      template: `
        <div>
          <div v-click-outside="onOutsideA" data-testid="a"><button>Inside A</button></div>
          <div v-click-outside="onOutsideB" data-testid="b"><button>Inside B</button></div>
        </div>
      `,
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Inside A' }))
    expect(onOutsideA).not.toHaveBeenCalled()
    expect(onOutsideB).toHaveBeenCalledTimes(1)
    expect(onOutsideB.mock.calls[0][1]).toBe(screen.getByTestId('b'))
  })

  test('listens on document.body in the bubble phase, so a stopped click never reaches it', async () => {
    const onOutside = vi.fn()
    render({
      methods: { onOutside },
      template: `
        <div>
          <div v-click-outside="onOutside">Menu</div>
          <button @click.stop>Stops propagation</button>
        </div>
      `,
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Stops propagation' }))
    expect(onOutside).not.toHaveBeenCalled()
  })

  test('removes its body listener when the component unmounts', async () => {
    const onOutside = vi.fn()
    const { unmount } = render({
      methods: { onOutside },
      template: `<div v-click-outside="onOutside">Menu</div>`,
    })
    await fireEvent.click(document.body)
    expect(onOutside).toHaveBeenCalledTimes(1)

    unmount()
    await fireEvent.click(document.body)
    expect(onOutside).toHaveBeenCalledTimes(1)
  })

  test('removes its body listener when a v-if removes the bound element', async () => {
    const onOutside = vi.fn()
    render({
      data: () => ({ open: true }),
      methods: { onOutside },
      template: `
        <div>
          <div v-if="open" v-click-outside="onOutside">Menu</div>
          <button @click="open = false">Close menu</button>
        </div>
      `,
    })

    // the closing click still bubbles to body before the re-render removes the element
    await fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(onOutside).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Menu')).not.toBeInTheDocument()

    await fireEvent.click(document.body)
    expect(onOutside).toHaveBeenCalledTimes(1)
  })
})

describe('computedFromState', () => {
  test('tracks the selected store state across commits', () => {
    const viewMode = computedFromState(state => state.ui.viewMode)
    expect(viewMode.value).toBe('covers')

    store.commit('ui/setViewMode', 'list')
    expect(viewMode.value).toBe('list')
  })

  test('recomputes from roles, so it composes with $can', () => {
    const canReview = computedFromState(state => $can('review'))
    expect(canReview.value).toBe(false)

    signIn({ advisor: true })
    expect(canReview.value).toBe(true)
  })
})
