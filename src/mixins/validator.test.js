/**
 * Characterization tests for the validator mixin factory (src/mixins/validator.js).
 *
 * Dependency seams guarded. From lodash/debounce 4.17: revalidate is debounced at 500ms with
 * leading: true and the default trailing edge, so a lone call runs at once and never again, a
 * burst runs once at its start and once more 500ms after its last call with that call's arguments,
 * there is no maxWait, and the wait is measured with Date.now and setTimeout read at call time.
 * From vue 3.5: mixin data merged into the component's own data, mixin methods bound to the
 * component instance (so the validation function reads component data through this), a
 * component's own method overriding the mixin's, templates re-rendering when the errors array is
 * reassigned, and a method-name @input handler on a v-model input receiving the input event after
 * v-model has written the field. From @testing-library/vue and @testing-library/jest-dom: render,
 * fireEvent.update, screen queries, and the toBeInTheDocument and toHaveClass matchers.
 */
import { nextTick } from 'vue'
import { fireEvent, render, screen } from '@testing-library/vue'
import validator from '@/mixins/validator'

const emailError = x => ({ name: 'email', message: `Email required (${x})` })

/** Returns a validation function spy that requires this.email and echoes its argument. */
const emailRequired = () =>
  vi.fn(function (x) {
    return this.email ? [] : [emailError(x)]
  })

/**
 * Renders a component that uses a fresh validator(fn) mixin and returns its instance. A fresh
 * mixin per test matters: the debounced revalidate lives on the mixin object, so it would
 * otherwise carry timers and call times from one test into the next.
 */
const renderWithValidator = (fn, options = {}) => {
  let vm
  render({
    mixins: [validator(fn)],
    data: () => ({ email: '' }),
    created() {
      vm = this
    },
    template: '<ul><li v-for="e in errors" :key="e.name">{{ e.message }}</li></ul>',
    ...options,
  })
  return vm
}

/** Returns the text of every rendered error message, in order. */
const renderedMessages = () => screen.queryAllByRole('listitem').map(li => li.textContent)

beforeEach(() => {
  // lodash/debounce measures its wait with Date.now and schedules with setTimeout, both read at
  // call time. Faking exactly these keeps Vue's promise-based nextTick running normally.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('validate and the error accessors', () => {
  test("merges an empty errors array into the component's own data", async () => {
    const vm = renderWithValidator(emailRequired())

    expect(vm.$data).toEqual({ email: '', errors: [] })
    expect(vm.hasErrors()).toBe(false)
    await nextTick()
    expect(renderedMessages()).toEqual([])
  })

  test('validate calls the validation function with its arguments and the component as this, then renders its errors', async () => {
    const fn = emailRequired()
    const vm = renderWithValidator(fn)

    expect(vm.validate('b')).toBe(false)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')
    expect(fn.mock.contexts[0]).toBe(vm)
    expect(vm.errors).toEqual([emailError('b')])
    await nextTick()
    expect(screen.getByText('Email required (b)')).toBeInTheDocument()
    expect(renderedMessages()).toEqual(['Email required (b)'])
  })

  test('validate returns true and the rendered messages disappear once component data passes', async () => {
    const fn = emailRequired()
    const vm = renderWithValidator(fn)
    vm.validate('b')
    await nextTick()
    expect(renderedMessages()).toEqual(['Email required (b)'])

    vm.email = 'ada@example.org'

    expect(vm.validate()).toBe(true)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn.mock.calls[1]).toEqual([])
    expect(vm.errors).toEqual([])
    await nextTick()
    expect(screen.queryByText('Email required (b)')).not.toBeInTheDocument()
    expect(renderedMessages()).toEqual([])
  })

  test('hasErrors and hasError follow the errors, and getErrors returns a copy', () => {
    const vm = renderWithValidator(emailRequired())
    vm.validate('b')

    expect(vm.hasErrors()).toBe(true)
    expect(vm.hasError('email')).toBe(true)
    expect(vm.hasError('name')).toBe(false)

    const copy = vm.getErrors()
    expect(copy).toEqual([emailError('b')])
    copy[1] = { name: 'name', message: 'Name required' }

    expect(vm.getErrors()).toHaveLength(1)
    expect(vm.hasError('name')).toBe(false)
  })

  test('addError appends and renders without validating, and clearErrors removes every message', async () => {
    const fn = emailRequired()
    const vm = renderWithValidator(fn)
    vm.validate('b')

    vm.addError({ name: 'isbn', message: 'Invalid ISBN' })

    expect(fn).toHaveBeenCalledTimes(1)
    expect(vm.getErrors()).toEqual([emailError('b'), { name: 'isbn', message: 'Invalid ISBN' }])
    expect(vm.hasError('isbn')).toBe(true)
    await nextTick()
    expect(screen.getByText('Invalid ISBN')).toBeInTheDocument()
    expect(renderedMessages()).toEqual(['Email required (b)', 'Invalid ISBN'])

    vm.clearErrors()

    expect(vm.errors).toEqual([])
    expect(vm.hasErrors()).toBe(false)
    expect(vm.hasError('isbn')).toBe(false)
    await nextTick()
    expect(screen.queryByText('Invalid ISBN')).not.toBeInTheDocument()
    expect(renderedMessages()).toEqual([])
  })
})

describe('revalidate, debounced 500ms on the leading edge', () => {
  test('is a no-op while there are no errors, even after the wait elapses', () => {
    const fn = emailRequired()
    const vm = renderWithValidator(fn)

    vm.revalidate('a')
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
    expect(vm.errors).toEqual([])
  })

  test('with errors present, a lone call validates immediately and never again', async () => {
    const fn = emailRequired()
    const vm = renderWithValidator(fn)
    vm.validate('b')
    fn.mockClear()

    vm.revalidate('c')

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
    expect(fn.mock.contexts[0]).toBe(vm)
    await nextTick()
    expect(renderedMessages()).toEqual(['Email required (c)'])

    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('a burst validates on its first call, then once more 500ms after its last call with those arguments', async () => {
    const fn = emailRequired()
    const vm = renderWithValidator(fn)
    vm.validate('b')
    fn.mockClear()

    vm.revalidate('c') // t0
    vi.advanceTimersByTime(100)
    vm.revalidate('d') // t0 + 100
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith('c')

    vi.advanceTimersByTime(499) // t0 + 599
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1) // t0 + 600
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('d')
    expect(fn.mock.contexts[1]).toBe(vm)
    await nextTick()
    expect(screen.getByText('Email required (d)')).toBeInTheDocument()
    expect(renderedMessages()).toEqual(['Email required (d)'])
  })

  test('a call after the trailing edge has settled is a fresh leading edge', () => {
    const fn = emailRequired()
    const vm = renderWithValidator(fn)
    vm.validate('b')
    fn.mockClear()
    vm.revalidate('c') // t0
    vi.advanceTimersByTime(100)
    vm.revalidate('d') // t0 + 100
    vi.advanceTimersByTime(500) // t0 + 600, the trailing edge
    expect(fn).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(100) // t0 + 700
    vm.revalidate('e')

    expect(fn).toHaveBeenCalledTimes(3)
    expect(fn).toHaveBeenLastCalledWith('e')
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  test('calls every 100ms keep postponing the trailing edge, with no maximum wait', () => {
    const fn = emailRequired()
    const vm = renderWithValidator(fn)
    vm.validate('b')
    fn.mockClear()

    // ten calls, at t0, t0 + 100, ..., t0 + 900
    Array.from({ length: 10 }, (_, i) => i).forEach(i => {
      if (i > 0) vi.advanceTimersByTime(100)
      vm.revalidate(`burst ${i}`)
    })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith('burst 0')

    vi.advanceTimersByTime(499) // t0 + 1399
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1) // t0 + 1400
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('burst 9')
  })

  test('once a revalidation has cleared the errors, later revalidate calls do not validate', async () => {
    const fn = emailRequired()
    const vm = renderWithValidator(fn)
    vm.validate('b')
    fn.mockClear()
    vm.email = 'ada@example.org'

    vm.revalidate('c') // t0: the leading edge validates and clears the errors
    expect(fn).toHaveBeenCalledTimes(1)
    expect(vm.errors).toEqual([])

    vi.advanceTimersByTime(100)
    vm.revalidate('d') // t0 + 100: schedules the trailing edge
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)

    vm.revalidate('e') // a fresh leading edge
    expect(fn).toHaveBeenCalledTimes(1)
    await nextTick()
    expect(renderedMessages()).toEqual([])
  })

  test('the trailing edge checks for errors when it runs, not when revalidate was called', async () => {
    const fn = emailRequired()
    const vm = renderWithValidator(fn)
    vm.validate('b')
    fn.mockClear()
    vm.email = 'ada@example.org'
    vm.revalidate('c') // t0: validates and clears the errors
    vi.advanceTimersByTime(100)
    vm.revalidate('d') // t0 + 100: no errors at call time

    vi.advanceTimersByTime(100) // t0 + 200
    vm.email = ''
    vm.addError({ name: 'isbn', message: 'Invalid ISBN' })
    vi.advanceTimersByTime(399) // t0 + 599
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1) // t0 + 600
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('d')
    expect(vm.errors).toEqual([emailError('d')])
    await nextTick()
    expect(renderedMessages()).toEqual(['Email required (d)'])
  })
})

describe('inside a component', () => {
  test("a component's own revalidate overrides the mixin's, and the mixin's other methods remain", () => {
    const fn = emailRequired()
    const ownRevalidate = vi.fn()
    const vm = renderWithValidator(fn, { methods: { revalidate: ownRevalidate } })
    vm.validate('b')

    vm.revalidate('c')

    expect(ownRevalidate).toHaveBeenCalledTimes(1)
    expect(ownRevalidate).toHaveBeenCalledWith('c')
    expect(ownRevalidate.mock.contexts[0]).toBe(vm)
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(vm.hasError('email')).toBe(true)
  })

  test('@input="revalidate" on a v-model input runs after v-model and receives the input event', async () => {
    let emailSeenByValidation
    const fn = vi.fn(function () {
      emailSeenByValidation = this.email
      return this.email ? [] : [{ name: 'email', message: 'Email is required' }]
    })
    const vm = renderWithValidator(fn, {
      template: `
        <input v-model="email" aria-label="Email" :class="{ 'is-danger': hasError('email') }" @input="revalidate" />
        <ul><li v-for="e in errors" :key="e.name">{{ e.message }}</li></ul>
      `,
    })
    const input = screen.getByLabelText('Email')
    expect(input).not.toHaveClass('is-danger')

    vm.validate()
    expect(emailSeenByValidation).toBe('')
    await nextTick()
    expect(input).toHaveClass('is-danger')
    expect(renderedMessages()).toEqual(['Email is required'])

    await fireEvent.update(input, 'ada@example.org')

    expect(fn).toHaveBeenCalledTimes(2)
    expect(emailSeenByValidation).toBe('ada@example.org')
    expect(fn.mock.calls[1]).toHaveLength(1)
    const [event] = fn.mock.calls[1]
    expect(event).toBeInstanceOf(Event)
    expect(event.type).toBe('input')
    expect(event.target).toBe(input)
    expect(vm.email).toBe('ada@example.org')
    expect(vm.errors).toEqual([])
    await nextTick()
    expect(input).not.toHaveClass('is-danger')
    expect(renderedMessages()).toEqual([])
  })
})
