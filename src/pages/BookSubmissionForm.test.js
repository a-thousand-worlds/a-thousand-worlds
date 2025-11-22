import BookSubmissionForm from '@/pages/BookSubmissionForm.vue'
import { render } from '@/test-helpers'
import { fireEvent } from '@testing-library/vue'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('render BookSubmissionForm', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(component.getByLabelText('Title', { exact: false }), 'bear')
  await fireEvent.update(component.getByLabelText('Author(s)', { exact: false }), 'm')
  expect(await component).toBeTruthy()
})

// TODO: Fix and re-enable tests

test.skip('show loader after typing in title and author', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(
    component.getByLabelText('Title', { exact: false }),
    'The Bear and the Moon',
  )
  await fireEvent.update(component.getByLabelText('Author(s)', { exact: false }), 'Matthew Burgess')
  expect(await component.findByRole('loading', {}, { timeout: 1000 }))
})

test.skip('show loader after typing in title and illustrator', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(
    component.getByLabelText('Title', { exact: false }),
    'The Bear and the Moon',
  )
  await fireEvent.update(
    component.getByLabelText('Illustrator(s)', { exact: false }),
    'Catia Chien',
  )
  expect(await component.findByRole('loading', {}, { timeout: 1000 }))
})

test.skip('search for isbn after typing in title and author', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(
    component.getByLabelText('Title', { exact: false }),
    'The Bear and the Moon',
  )
  await fireEvent.update(component.getByLabelText('Author(s)', { exact: false }), 'Matthew Burgess')
  expect(await component.findByText('Is this the correct book?', {}, { timeout: 30000 }))
})

test.skip('search for isbn after typing in title and illustrator', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(
    component.getByLabelText('Title', { exact: false }),
    'The Bear and the Moon',
  )
  await fireEvent.update(
    component.getByLabelText('Illustrator(s)', { exact: false }),
    'Catia Chien',
  )
  expect(await component.findByText('Is this the correct book?', {}, { timeout: 30000 }))
})

test.skip('do not search for isbn after typing in author and illustrator', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(component.getByLabelText('Author(s)', { exact: false }), 'Matthew Burgess')
  await fireEvent.update(
    component.getByLabelText('Illustrator(s)', { exact: false }),
    'Catia Chien',
  )
  await delay(1000) // wait for input debounce
  expect(component.queryByRole('loading')).not.toBeInTheDocument()
})

test.skip('do not search for isbn after typing in only title', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(
    component.getByLabelText('Title', { exact: false }),
    'The Bear and the Moon',
  )
  await delay(1000) // wait for input debounce
  expect(component.queryByRole('loading')).not.toBeInTheDocument()
})

test.skip('do not search for isbn after typing in only author', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(
    component.getByLabelText('Title', { exact: false }),
    'The Bear and the Moon',
  )
  await delay(1000) // wait for input debounce
  expect(component.queryByRole('loading')).not.toBeInTheDocument()
})

test.skip('do not search for isbn after typing in only illustrator', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(
    component.getByLabelText('Title', { exact: false }),
    'The Bear and the Moon',
  )
  await delay(1000) // wait for input debounce
  expect(component.queryByRole('loading')).not.toBeInTheDocument()
})

test.skip('show the thumbnail after it has loaded', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(component.getByLabelText('Title', { exact: false }), 'bear')
  await fireEvent.update(component.getByLabelText('Author(s)', { exact: false }), 'm')
  expect(await component.findByText('Is this the correct book?', {}, { timeout: 30000 }))
  expect(component.getByAltText('thumbnail')).not.toHaveStyle({ visibility: 'hidden' })
})

test.skip('thank the user if they confirm it is their book', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(
    component.getByLabelText('Title', { exact: false }),
    'The Bear and the Moon',
  )
  await fireEvent.update(
    component.getByLabelText('Illustrator(s)', { exact: false }),
    'Catia Chien',
  )
  expect(await component.findByText('Is this the correct book?', {}, { timeout: 30000 }))
  await fireEvent.click(component.getByText('Yes'))
  expect(component.getByText('Great - Thanks!'))
})

test.skip('ask for the isbn if the book is not theirs', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(
    component.getByLabelText('Title', { exact: false }),
    'The Bear and the Moon',
  )
  await fireEvent.update(
    component.getByLabelText('Illustrator(s)', { exact: false }),
    'Catia Chien',
  )
  expect(await component.findByText('Is this the correct book?', {}, { timeout: 30000 }))
  await fireEvent.click(component.getByText('No'))
  expect(component.getByText('Okay, please enter the ISBN:'))
})

test.skip('hide the thumbnail if the book is not theirs', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(
    component.getByLabelText('Title', { exact: false }),
    'The Bear and the Moon',
  )
  await fireEvent.update(
    component.getByLabelText('Illustrator(s)', { exact: false }),
    'Catia Chien',
  )
  expect(await component.findByText('Is this the correct book?', {}, { timeout: 30000 }))
  await fireEvent.click(component.getByText('No'))
  expect(component.getByAltText('thumbnail')).toHaveStyle({ visibility: 'hidden' })
})

test.skip('re-show the thumbnail if they hit cancel after saying that the book is not theirs', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(
    component.getByLabelText('Title', { exact: false }),
    'The Bear and the Moon',
  )
  await fireEvent.update(
    component.getByLabelText('Illustrator(s)', { exact: false }),
    'Catia Chien',
  )
  expect(await component.findByText('Is this the correct book?', {}, { timeout: 30000 }))
  await fireEvent.click(component.getByText('No'))
  await fireEvent.click(component.getByText('Cancel'))
  expect(component.getByAltText('thumbnail')).not.toHaveStyle({ visibility: 'hidden' })
})

test.skip('remove suggestion if they clear the title', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(
    component.getByLabelText('Title', { exact: false }),
    'The Bear and the Moon',
  )
  await fireEvent.update(
    component.getByLabelText('Illustrator(s)', { exact: false }),
    'Catia Chien',
  )
  expect(await component.findByText('Is this the correct book?', {}, { timeout: 30000 }))
  await fireEvent.update(component.getByLabelText('Title', { exact: false }), '')
  await delay(1000) // wait for input debounce
  expect(component.queryByRole('loading')).not.toBeInTheDocument()
  expect(component.queryByAltText('thumbnail')).not.toBeInTheDocument()
  expect(component.queryByText('Is this the correct book?')).not.toBeInTheDocument()
})

test.skip('search for thumbnail after typing in ISBN', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(component.getByLabelText('Title', { exact: false }), 'bear')
  await fireEvent.update(component.getByLabelText('Author(s)', { exact: false }), 'm')
  expect(await component.findByText('Is this the correct book?', {}, { timeout: 30000 }))
  await fireEvent.click(component.getByText('No'))
  await fireEvent.update(
    component.getByLabelText('Okay, please enter the ISBN:', { exact: false }),
    '1452171912',
  )
  await fireEvent.click(component.getByText('Search'))
  expect(component.queryByText('Okay, please enter the ISBN:')).not.toBeInTheDocument()
  expect(await component.findByRole('loading', {}, { timeout: 1000 }))
  expect(await component.findByText('Is this the correct book?', {}, { timeout: 30000 }))
  expect(component.getByAltText('thumbnail')).not.toHaveStyle({ visibility: 'hidden' })
})

test.skip('thank you after clicking "No, but keep anyway"', async () => {
  const component = render(BookSubmissionForm)
  await fireEvent.update(component.getByLabelText('Title', { exact: false }), 'bear')
  await fireEvent.update(component.getByLabelText('Author(s)', { exact: false }), 'm')
  expect(await component.findByText('Is this the correct book?', {}, { timeout: 30000 }))
  await fireEvent.click(component.getByText('No'))
  await fireEvent.update(
    component.getByLabelText('Okay, please enter the ISBN:', { exact: false }),
    '1452171912',
  )
  await fireEvent.click(component.getByText('Search'))
  expect(component.queryByText('Okay, please enter the ISBN:')).not.toBeInTheDocument()
  expect(await component.findByText('Is this the correct book?', {}, { timeout: 30000 }))
  await fireEvent.click(component.getByText('No, but keep anyway'))
  expect(component.getByText('Got it - Thanks!'))
})
