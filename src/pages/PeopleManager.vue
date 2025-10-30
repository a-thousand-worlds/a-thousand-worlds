<script>
import sortBy from 'lodash/sortBy'
import reverse from 'lodash/reverse'
import debounce from 'lodash/debounce'
import dayjs from 'dayjs'
import { remove as diacritics } from 'diacritics'
import creatorTitles from '@/store/constants/creatorTitles'

import AddTag from '@/components/AddTag'
import CoverImage from '@/components/CoverImage'
import DeletePersonButton from '@/components/DeletePersonButton'
import Dropdown from '@/components/Dropdown'
import HighlightedText from '@/components/HighlightedText'
import Loader from '@/components/Loader'
import PersonDetailLink from '@/components/PersonDetailLink'
import SimpleInput from '@/components/fields/SimpleInput'
import SortableTableHeading from '@/components/SortableTableHeading'
import Tag from '@/components/Tag'

/** Generates a sort token that will sort empty strings to the end regardless of sort direction. */
const sortEmptyToEnd = (s, dir) => `${dir === 'asc' && s === '' ? 1 : 0}-${s}`

export default {
  name: 'PeopleManager',
  components: {
    AddTag,
    CoverImage,
    DeletePersonButton,
    Dropdown,
    HighlightedText,
    Loader,
    PersonDetailLink,
    SimpleInput,
    SortableTableHeading,
    Tag,
  },
  data() {
    const sortField = this.$route.query?.sort || 'submitted'
    return {
      creatorTitles,
      editMode: false,
      // edit mode takes is slow to render, so show a Loader during the delay
      loadingEditMode: false,
      search: this.$route.query?.search || '',
      sortConfig: {
        field: sortField,
        dir: this.$route.query?.dir || (sortField === 'submitted' ? 'desc' : 'asc'),
      },
    }
  },

  computed: {
    loaded() {
      return this.$store.state.people.loaded
    },

    people() {
      // sort people by the sort config
      const sort = people => {
        const sorted = sortBy(people, [
          person => {
            switch (this.sortConfig.field) {
              case 'submitted':
                return dayjs(person.createdAt)
              case 'updated':
                return dayjs(person.updatedAt)
              case 'title':
                return sortEmptyToEnd(
                  (person.title || person.role || '').toLowerCase(),
                  this.sortConfig.dir,
                )
              case 'tags':
                return sortEmptyToEnd(
                  this.getTags(person)
                    .map(tag => tag.tag)
                    .join(' '),
                  this.sortConfig.dir,
                )
              default:
                return (person[this.sortConfig.field] || '').toLowerCase()
            }
          },
          'nameLower',
        ])
        return this.sortConfig.dir === 'desc' ? reverse(sorted) : sorted
      }

      // filter people by the active search
      const filter = people =>
        this.search ? people.filter(person => this.searchPredicate(person)) : people

      return sort(filter(this.peopleList))
    },

    peopleList() {
      return this.$store.getters['people/list']().map(person => ({
        ...person,
        nameLower: person.name.toLowerCase(),
      }))
    },

    tags() {
      return this.$store.getters[`tags/people/listSorted`]()
    },
  },

  watch: {
    // update search query param on change
    search: debounce(function (next, prev) {
      this.$router.replace({
        ...this.$route,
        query: {
          ...this.$route.query,
          search: next || undefined,
        },
      })
    }, 200),

    // update sort query param on change
    sortConfig: debounce(function (next, prev) {
      this.$router.replace({
        ...this.$route,
        query: {
          ...this.$route.query,
          sort: next.field,
          dir: next.dir,
        },
      })
    }, 200),
  },

  methods: {
    formatDate(d) {
      return d ? dayjs(d).format('M/D/YYYY hh:mm') : null
    },

    formatTitle(person) {
      const creatorTitleObject = creatorTitles.find(
        o => o.id === person.title || o.id === person.role,
      )
      return creatorTitleObject?.text
    },

    getTags(person) {
      const tagsState = this.$store.state.tags.people
      return tagsState.loaded
        ? Object.keys(person.identities || {}).map(
            tagId => tagsState.data[tagId] || { id: tagId, tag: 'invalid' },
          )
        : null
    },

    /** Returns true if a string matches the search term (trimmed, lowercased, and diacritics removed). */
    isMatch(value, search) {
      return diacritics(value.trim())
        .toLowerCase()
        .includes(diacritics(search.trim()).toLowerCase())
    },

    /** Returns true if the person matches the search. Case insensitive, partial match, support for filtering by field, e.g. tag:poetry */
    searchPredicate(person) {
      const split = this.search.split(':')
      const field = split.length > 1 ? split[0].trim().toLowerCase() : null
      const searchValue = split.length > 1 ? split[1] : split[0]

      // map fields to formating functions
      const format = {
        name: person.name,
        submitted: this.formatDate(person.createdAt),
        title: this.formatTitle(person),
        tag: this.getTags(person)
          .map(tag => tag.tag)
          .join(' '),
      }

      return field
        ? this.isMatch(format[field] || '', searchValue)
        : Object.values(format)
            .map(s => (s || '').toLowerCase())
            .some(s => this.isMatch(s, searchValue))
    },

    toggleEditMode() {
      // show a loader while edit mode is rendering
      this.loadingEditMode = true
      setTimeout(() => {
        this.editMode = !this.editMode
        this.loadingEditMode = false
      })
    },

    toggleTagSearch(tag) {
      const term = `tag:${tag.tag}`

      if (this.search.includes(term)) {
        this.search = this.search.replace(term, '')
      } else {
        // replace search until better search logic is implemented
        this.search = term
        // this.search = `${this.search} ${term}`.trim()
      }
    },

    updatePerson(person, field, value) {
      if (value === undefined) {
        value = field
        field = ''
      }

      // console.log('field', field)
      // console.log('value', value)

      // do not update if the field is not changed
      // handle field embedded in complex value, e.g. field === '' and value === { isbn: '1419742256' }
      if (person[field] === value) return
      const extractedField =
        field === '' && Object.keys(value).length === 1 && Object.keys(value)[0]
      if (extractedField && person[extractedField] === value[extractedField]) return

      // console.log('update', {
      //   path: `${person.id}/${field}`,
      //   value,
      // })

      this.$store.dispatch('people/update', {
        path: `${person.id}/${field}`,
        value,
      })
    },
  },
}
</script>

<template>
  <div class="is-flex is-justify-content-center m-20 mb-40">
    <div class="is-flex-grow-1 mx-20" style="max-width: 900px">
      <div class="mb-5">
        <a @click.prevent="$router.back" class="is-uppercase is-primary">&lt; Back</a>
      </div>

      <div class="is-flex is-justify-content-space-between is-align-items-flex-end divider-bottom">
        <h1 class="title mb-0" style="display: inline">People Manager</h1>

        <!-- EDIT/DONE link -->
        <span style="white-space: nowrap; line-height: 55px">
          <Loader
            v-if="loadingEditMode"
            class="mr-1"
            style="display: inline-block; width: 1em; height: 1em"
          />
          <a @click.prevent="toggleEditMode">
            {{ editMode ? 'DONE' : 'EDIT' }}
          </a>
        </span>
      </div>

      <div class="mb-30 is-flex is-justify-content-space-between">
        <div>
          <router-link
            class="mr-20"
            :to="{ name: 'TagsManager', query: { active: 'people' } }"
            style="color: black; line-height: 2.5"
            >People Tags</router-link
          >
        </div>
        <div class="is-flex is-align-items-center">
          <!-- # creators -->
          <span v-if="loaded" class="mr-40" style="white-space: nowrap"
            >{{ people.length }} creator{{ people.length === 1 ? '' : 's' }}
            <span v-if="search">(filtered)</span></span
          >

          <!-- search -->
          <span
            class="has-text-right"
            v-tippy="{
              content: `Search all creators. Use 'field:value' to filter by a specific field, e.g. 'tag:Asian'`,
            }"
            style="white-space: nowrap"
            ><i class="far fa-question-circle"
          /></span>
          <i class="fas fa-search" style="transform: translateX(23px); z-index: 10; opacity: 0.3" />
          <input v-model="search" placeholder="Search" class="input pl-30" />
        </div>
      </div>

      <div v-if="!loaded" class="has-text-centered" style="margin-top: 20vh">
        <Loader />
      </div>

      <div v-else>
        <div v-if="!people.length" class="w-100 my-100 has-text-centered">
          <h2 class="mb-20">
            No {{ search ? 'matching ' : '' }}people{{ !search ? ' yet!' : '' }}
          </h2>
          <p v-if="search">
            <a @click.prevent="search = ''" class="button is-rounded is-primary">Reset Search</a>
          </p>
        </div>

        <table v-else class="table w-100">
          <thead>
            <tr>
              <td />
              <SortableTableHeading id="nameLower" v-model="sortConfig">Name</SortableTableHeading>
              <SortableTableHeading id="tags" v-model="sortConfig">Tags</SortableTableHeading>
              <SortableTableHeading id="title" v-model="sortConfig">Title</SortableTableHeading>
              <SortableTableHeading
                id="createdAt"
                v-model="sortConfig"
                default="desc"
                class="has-text-right pr-20"
                >Submitted</SortableTableHeading
              >
              <th class="has-text-right">Delete</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="person of people" :key="person.id" :data-person-id="person.id">
              <!-- photo -->
              <td>
                <PersonDetailLink :person="person" edit>
                  <CoverImage :item="person" style="width: 100px; border-radius: 99px" />
                </PersonDetailLink>
              </td>

              <!-- name -->
              <td>
                <SimpleInput
                  v-if="editMode"
                  @update:modelValue="updatePerson(person, '', { name: $event })"
                  v-model="person.name"
                  placeholder="Enter Name"
                  unstyled
                />

                <PersonDetailLink v-else :person="person" edit>
                  <HighlightedText field="name" :search="search">
                    {{ person.name }}
                  </HighlightedText>
                </PersonDetailLink>
              </td>

              <!-- tags -->
              <td>
                <Tag
                  v-for="tag of getTags(person)"
                  :key="tag.id"
                  :tag="tag"
                  type="people"
                  @click="editMode ? null : toggleTagSearch"
                  @remove="updatePerson(person, 'identities', { [tag.id]: null })"
                  nolink
                  :editable="editMode"
                  :button-class="{ 'is-outlined': true, pointer: !editMode }"
                >
                  <HighlightedText field="tag" :search="search">
                    {{ tag.tag }}
                  </HighlightedText>
                </Tag>
                <AddTag v-if="editMode" type="people" :item="person" />
              </td>

              <!-- title -->
              <td>
                <Dropdown
                  v-if="editMode"
                  :defaultValue="person.title"
                  :options="creatorTitles"
                  placeholder="Choose pronouns"
                  @update:modelValue="updatePerson(person, '', { title: $event })"
                  :labelStyle="{
                    fontStyle: !person.title ? 'italic' : null,
                  }"
                  style="display: inline"
                >
                  <template #beforeOptions>
                    <a
                      @click.prevent="updatePerson(person, '', { title: null })"
                      class="dropdown-item is-capitalized is-uppercase"
                      :style="{ color: person.title ? '#000' : null }"
                      >None</a
                    >
                    <hr class="dropdown-divider" />
                  </template>
                </Dropdown>

                <HighlightedText v-else field="title" :search="search">
                  {{ formatTitle(person) }}
                </HighlightedText>
              </td>

              <!-- submitted (createdAt) -->
              <td class="has-text-right">
                <HighlightedText field="submitted" :search="search" style="opacity: 0.5">
                  {{ formatDate(person.createdAt) }}
                </HighlightedText>
              </td>

              <!-- delete -->
              <td class="has-text-right">
                <div class="field is-grouped is-justify-content-flex-end">
                  <p class="control">
                    <DeletePersonButton :person="person" />
                  </p>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.pointer span {
  cursor: pointer !important;
}
</style>
