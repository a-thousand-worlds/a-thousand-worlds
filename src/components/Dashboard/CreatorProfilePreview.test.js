import CreatorProfilePreview from '@/components/Dashboard/CreatorProfilePreview.vue'
import { render } from '@testing-library/vue'

const person = { id: 'person1', name: 'Ada Author' }

/** Renders the preview against a plain store state, stubbing the links that need a router. */
const renderPreview = ({ profile = {}, peopleSubmissions = {} } = {}) =>
  render(CreatorProfilePreview, {
    global: {
      mocks: {
        $store: {
          state: {
            people: { data: { [person.id]: person } },
            submissions: { people: { data: peopleSubmissions } },
            user: { user: { profile } },
          },
        },
      },
      stubs: { PersonDetailLink: true, 'router-link': true },
    },
  })

test('finds the person through the personId stored on the profile', () => {
  const component = renderPreview({ profile: { personId: person.id } })
  expect(component.getByText('Your Public Profile')).toBeInTheDocument()
})

test('falls back to the personId stored on the approved people submission', () => {
  const component = renderPreview({
    profile: { submissions: { sub1: 'approved' } },
    peopleSubmissions: {
      sub1: { id: 'sub1', type: 'people', status: 'approved', personId: person.id },
    },
  })
  expect(component.getByText('Your Public Profile')).toBeInTheDocument()
})

test('offers to create a profile when no stored personId resolves to a person', () => {
  const component = renderPreview({
    profile: { submissions: { sub1: 'approved' } },
    peopleSubmissions: {
      sub1: { id: 'sub1', type: 'people', status: 'approved', personId: 'missing' },
    },
  })
  expect(component.queryByText('Your Public Profile')).not.toBeInTheDocument()
  expect(
    component.getByText('Please fill our your profile for the People Directory'),
  ).toBeInTheDocument()
})

test('shows the pending notice while a submission awaits review', () => {
  const component = renderPreview({
    profile: { personId: person.id, submissions: { sub1: 'pending' } },
  })
  expect(component.getByText(/will review your profile/)).toBeInTheDocument()
})
