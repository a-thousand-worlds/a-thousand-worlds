<script>
import _ from 'lodash'
import sortBy from 'lodash/sortBy'
import reverse from 'lodash/reverse'
import debounce from 'lodash/debounce'
import dayjs from 'dayjs'
import { remove as diacritics } from 'diacritics'
import { parse } from 'json2csv'

import creatorTitles from '@/store/constants/creatorTitles'
import AddCreator from '@/components/AddCreator'
import AddTag from '@/components/AddTag'
import BackLink from '@/components/BackLink'
import BookDetailLink from '@/components/BookDetailLink'
import Dropdown from '@/components/Dropdown'
import HighlightedText from '@/components/HighlightedText'
import Loader from '@/components/Loader'
import PersonDetailLink from '@/components/PersonDetailLink'
import SortableTableHeading from '@/components/SortableTableHeading'
import CoverImage from '@/components/CoverImage'
import SimpleInput from '@/components/fields/SimpleInput'
import Tag from '@/components/Tag'
import download from '@/util/download'

/** Generates a sort token that will sort empty strings to the end regardless of sort direction. */
const sortEmptyToEnd = (s, dir) => `${dir === 'asc' && s === '' ? 1 : 0}-${s}`

export default {
  name: 'BooksManager',
  components: {
    AddCreator,
    AddTag,
    BackLink,
    BookDetailLink,
    Dropdown,
    HighlightedText,
    Loader,
    PersonDetailLink,
    SortableTableHeading,
    CoverImage,
    SimpleInput,
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
      return this.$store.state.books.loaded
    },

    books() {
      // sort books by the sort config
      const sort = books => {
        const sorted = sortBy(books, [
          book => {
            switch (this.sortConfig.field) {
              case 'submitted':
                return dayjs(book.createdAt)
              case 'updated':
                return dayjs(book.updatedAt)
              case 'authors':
                return sortEmptyToEnd(this.formatAuthors(book.creators), this.sortConfig.dir)
              case 'illustrators':
                return sortEmptyToEnd(this.formatIllustrators(book.creators), this.sortConfig.dir)
              case 'tags':
                return sortEmptyToEnd(
                  this.getTags(book)
                    .map(tag => tag.tag)
                    .join(' '),
                  this.sortConfig.dir,
                )
              default:
                return sortEmptyToEnd(book[this.sortConfig.field], this.sortConfig.dir)
            }
          },
          'titleLower',
        ])
        return this.sortConfig.dir === 'desc' ? reverse(sorted) : sorted
      }

      // filter books by the active search
      const filter = books =>
        this.search ? books.filter(book => this.searchPredicate(book)) : books

      return sort(filter(this.booksList))
    },

    booksList() {
      return this.$store.getters['books/list']().map(book => ({
        ...book,
        titleLower: book.title.toLowerCase(),
      }))
    },

    contributorOptions() {
      return this.$store.getters['users/contributorOptions']
    },

    tags() {
      return this.$store.getters[`tags/books/listSorted`]()
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
    authors(creators) {
      const people = this.$store.state.people.data || {}
      return Object.entries(creators || {})
        .filter(([id, value]) => value === 'author' || value === 'author-illustrator')
        .map(([id, value]) => people[id])
        .filter(x => x)
    },

    download() {
      try {
        // convert books properties to readable data, e.g. tag names instead of ids
        const booksOutput = this.books.map(book => ({
          // omit creators since we render authors and illustrators as separate columns
          ..._.omit(book, 'creators'),
          authors: this.formatAuthors(book.creators),
          illustrators: this.formatIllustrators(book.creators),
          tags: this.formatTags(book),
        }))
        const csv = parse(booksOutput, {
          fields: [
            'isbn',
            'title',
            'authors',
            'illustrators',
            'tags',
            'year',
            'goodreads',
            'publisher',
            'summary',
            'createdAt',
            'createdBy',
            'id',
            'submissionId',
            'cover',
            'thumbnail',
            'reviewedAt',
            'reviewedBy',
            'updatedAt',
            'updatedBy',
            'status',
          ],
        })
        download(csv, `ATW books (${this.books.length}) - ${new Date().toISOString()}.csv`)
      } catch (e) {
        this.$store.dispatch('ui/handleError', e)
      }
    },

    formatAuthors(creators) {
      return this.authors(creators)
        .map(author => author?.name)
        .join(', ')
    },

    formatContributor(contributorId) {
      return this.$store.getters['users/get'](contributorId)?.profile?.name
    },

    formatDate(d) {
      return dayjs(d).format('M/D/YYYY hh:mm')
    },

    formatIllustrators(creators) {
      return this.illustrators(creators)
        .map(illustrator => illustrator?.name)
        .join(', ')
    },

    formatTags(book) {
      return this.getTags(book)
        .map(tag => tag.tag)
        .join(', ')
    },

    getTags(book) {
      const tagsState = this.$store.state.tags.books
      return tagsState.loaded
        ? Object.keys(book.tags)
            .map(tagId => tagsState.data[tagId])
            .filter(x => !!x) // if somehow no tag was defined for book - without this filter page will bring error and stop working
        : null
    },

    illustrators(creators) {
      const people = this.$store.state.people.data || {}
      return Object.entries(creators || {})
        .filter(([id, value]) => value === 'illustrator')
        .map(([id, value]) => people[id])
        .filter(x => x)
    },

    /** Returns true if a string matches the search term (trimmed, lowercased, and diacritics removed). */
    isMatch(value, search) {
      return diacritics(value.trim())
        .toLowerCase()
        .includes(diacritics(search.trim()).toLowerCase())
    },

    async removeBook(id) {
      this.$store.commit('ui/setBusy', true)
      try {
        await this.$store.dispatch('books/remove', id)
      } finally {
        this.$store.commit('ui/setBusy', false)
      }
    },

    /** Returns true if the book matches the search. Case insensitive, partial match, support for filtering by field, e.g. tag:poetry */
    searchPredicate(book) {
      const split = this.search.split(':')
      const field = split.length > 1 ? split[0].trim().toLowerCase() : null
      const searchValue = split.length > 1 ? split[1] : split[0]

      // map fields to formating functions
      const format = {
        author: this.formatAuthors(book.creators),
        contributor: this.formatContributor(book.createdBy),
        submitted: this.formatDate(book.createdAt),
        illustrator: this.formatIllustrators(book.creators),
        isbn: book.isbn,
        tag: this.getTags(book)
          .map(tag => tag.tag)
          .join(' '),
        title: book.title,
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

    updateBook(book, field, value) {
      if (value === undefined) {
        value = field
        field = ''
      }

      // console.log('field', field)
      // console.log('value', value)

      // do not update if the field is not changed
      // handle field embedded in complex value, e.g. field === '' and value === { isbn: '1419742256' }
      if (book[field] === value) return
      const extractedField =
        field === '' && Object.keys(value).length === 1 && Object.keys(value)[0]
      if (extractedField && book[extractedField] === value[extractedField]) return

      // console.log('update', {
      //   path: `${book.id}/${field}`,
      //   value,
      // })

      this.$store.dispatch('books/update', {
        path: `${book.id}/${field}`,
        value,
      })
    },
  },
}
</script>

<template>
  <div class="is-flex is-justify-content-center m-20 mb-40">
    <div class="is-flex-grow-1 mx-20" style="max-width: 1200px">
      <div class="mb-5">
        <BackLink />
      </div>

      <div class="is-flex is-justify-content-space-between is-align-items-flex-end divider-bottom">
        <h1 class="title mb-0" style="display: inline">Books Manager</h1>

        <!-- EDIT/DONE link -->
        <span class="nowrap" style="line-height: 55px">
          <Loader
            v-if="loadingEditMode"
            class="mr-1"
            style="display: inline-block; width: 1em; height: 1em"
          />
          <a @click.prevent="toggleEditMode">
            {{ editMode ? 'DONE' : 'EDIT' }}
          </a>
          <a
            @click.prevent="download"
            v-tippy="{
              content: `Download CSV of ${search ? '' : 'all '}${books.length} book${
                books.length === 1 ? '' : 's'
              }${search ? ' (filtered)' : ''}`,
            }"
          >
            <i class="fa fa-download ml-5" />
          </a>
        </span>
      </div>

      <div class="mb-30 is-flex is-justify-content-space-between">
        <div>
          <router-link
            class="mr-20"
            :to="{ name: 'TagsManager' }"
            style="color: black; line-height: 2.5"
            >Book Tags</router-link
          >
        </div>
        <div class="is-flex is-align-items-center">
          <!-- # books -->
          <span v-if="loaded" class="mr-40 nowrap"
            >{{ books.length }} book{{ books.length === 1 ? '' : 's' }}
            <span v-if="search">(filtered)</span></span
          >

          <!-- search -->
          <span
            class="has-text-right nowrap"
            v-tippy="{
              content: `Search all books. Use 'field:value' to filter by a specific field, e.g. 'illustrator:Ho'`,
            }"
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
        <div v-if="!books.length" class="w-100 my-100 has-text-centered">
          <h2 class="mb-20">No {{ search ? 'matching ' : '' }}books{{ !search ? ' yet!' : '' }}</h2>
          <p v-if="search">
            <a @click.prevent="search = ''" class="button is-rounded is-primary">Reset Search</a>
          </p>
        </div>

        <table v-else class="table w-100">
          <thead>
            <tr>
              <td />
              <SortableTableHeading id="isbn" v-model="sortConfig">ISBN</SortableTableHeading>
              <SortableTableHeading id="titleLower" v-model="sortConfig"
                >Title</SortableTableHeading
              >
              <SortableTableHeading id="tags" v-model="sortConfig">Tags</SortableTableHeading>
              <SortableTableHeading id="authors" v-model="sortConfig"
                >Author(s)</SortableTableHeading
              >
              <SortableTableHeading id="illustrators" v-model="sortConfig"
                >Illustrator(s)</SortableTableHeading
              >
              <SortableTableHeading id="contributor" v-model="sortConfig"
                >Contributor</SortableTableHeading
              >
              <SortableTableHeading
                id="year"
                v-model="sortConfig"
                default="desc"
                class="has-text-right"
                >Published</SortableTableHeading
              >
              <SortableTableHeading
                id="submitted"
                v-model="sortConfig"
                default="desc"
                class="has-text-right"
                >Submitted</SortableTableHeading
              >
              <th class="has-text-right">Delete</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="book of books" :key="book.id" :data-book-id="book.id">
              <!-- cover -->
              <td>
                <BookDetailLink :book="book" edit>
                  <CoverImage
                    :item="book"
                    style="width: 125px; min-width: 50px; min-height: auto"
                  />
                </BookDetailLink>
              </td>

              <!-- ISBN -->
              <td>
                <SimpleInput
                  v-if="editMode"
                  @update:modelValue="updateBook(book, '', { isbn: $event })"
                  v-model="book.isbn"
                  placeholder="Enter ISBN"
                />
                <BookDetailLink v-else :book="book" edit
                  ><HighlightedText field="isbn" :search="search">{{
                    book.isbn
                  }}</HighlightedText></BookDetailLink
                >
              </td>

              <!-- title -->
              <td>
                <SimpleInput
                  v-if="editMode"
                  @update:modelValue="updateBook(book, '', { title: $event })"
                  v-model="book.title"
                  placeholder="Enter Title"
                  unstyled
                />
                <BookDetailLink v-else :book="book" edit
                  ><HighlightedText field="title" :search="search">{{
                    book.title
                  }}</HighlightedText></BookDetailLink
                >
              </td>

              <!-- tags -->
              <td>
                <Tag
                  v-for="tag of getTags(book)"
                  :key="tag.id"
                  :tag="tag"
                  type="books"
                  @click="editMode ? null : toggleTagSearch"
                  @remove="updateBook(book, 'tags', { [tag.id]: null })"
                  nolink
                  :editable="editMode"
                  :button-class="{ 'is-outlined': true, pointer: !editMode }"
                >
                  <HighlightedText field="tag" :search="search">{{ tag.tag }}</HighlightedText>
                </Tag>
                <AddTag v-if="editMode" type="books" :item="book" />
              </td>

              <!-- author(s) -->
              <td>
                <span v-for="(author, i) of authors(book.creators)" :key="author.id">
                  <span v-if="i !== 0">, </span>

                  <!-- edit mode: show title dropdown -->
                  <Dropdown
                    v-if="editMode"
                    v-model="book.creators[author.id]"
                    :label="author.name"
                    labelStyle="font-weight: bold;"
                    :options="creatorTitles"
                    @update:modelValue="updateBook(book, 'creators', { [author.id]: $event })"
                    style="display: inline"
                  >
                    <template #beforeOptions>
                      <a
                        class="dropdown-item"
                        @click.prevent="updateBook(book, 'creators', { [author.id]: null })"
                        style="color: #000"
                        ><b>REMOVE</b></a
                      >
                      <hr class="dropdown-divider" />
                    </template>
                  </Dropdown>

                  <PersonDetailLink v-else :person="author" edit
                    ><HighlightedText field="author" :search="search">{{
                      author.name
                    }}</HighlightedText></PersonDetailLink
                  >
                </span>
                <AddCreator
                  v-if="editMode"
                  label="Add Author"
                  @update="updateBook(book, 'creators', { [$event]: 'author' })"
                  class="mb-10 ml-1 mr-30 mt-2"
                  style="width: 100%"
                />
              </td>

              <!-- illustrator(s) -->
              <td>
                <span v-for="(illustrator, i) of illustrators(book.creators)" :key="illustrator.id">
                  <span v-if="i !== 0">, </span>

                  <!-- edit mode: show title dropdown -->
                  <Dropdown
                    v-if="editMode"
                    v-model="book.creators[illustrator.id]"
                    :label="illustrator.name"
                    labelStyle="font-weight: bold;"
                    :options="creatorTitles"
                    @update:modelValue="updateBook(book, 'creators', { [illustrator.id]: $event })"
                    style="display: inline"
                  >
                    <template #beforeOptions>
                      <a
                        class="dropdown-item"
                        @click.prevent="updateBook(book, 'creators', { [illustrator.id]: null })"
                        style="color: #000"
                        ><b>REMOVE</b></a
                      >
                      <hr class="dropdown-divider" />
                    </template>
                  </Dropdown>

                  <!-- normal mode: link to PersonEdit page -->
                  <PersonDetailLink v-else :person="illustrator" edit
                    ><HighlightedText field="illustrator" :search="search">{{
                      illustrator.name
                    }}</HighlightedText></PersonDetailLink
                  >
                </span>
                <AddCreator
                  v-if="editMode"
                  label="Add Illustrator"
                  @update="updateBook(book, 'creators', { [$event]: 'illustrator' })"
                  class="mb-10 ml-1 mr-30 mt-2"
                  style="width: 100%"
                />
              </td>

              <!-- contributor -->
              <td>
                <!-- edit mode -->
                <Dropdown
                  v-if="editMode"
                  v-model="book.createdBy"
                  labelStyle="font-weight: bold;"
                  :options="contributorOptions"
                  @update:modelValue="updateBook(book, '', { createdBy: $event })"
                  style="display: inline"
                >
                  <template #beforeOptions>
                    <span class="dropdown-item"
                      >To add or edit a contributor, use the
                      <BookDetailLink :book="book" edit>Book Edit</BookDetailLink> page.</span
                    >
                    <hr class="dropdown-divider" />
                  </template>
                </Dropdown>

                <HighlightedText v-else field="contributor" :search="search">{{
                  formatContributor(book.createdBy)
                }}</HighlightedText>
              </td>

              <!-- published -->
              <td class="has-text-right">
                <SimpleInput
                  v-if="editMode"
                  @update:modelValue="updateBook(book, '', { year: $event })"
                  v-model="book.year"
                  placeholder="Enter Year"
                  unstyled
                />
                <HighlightedText v-else field="published" :search="search">
                  {{ book.year }}
                </HighlightedText>
              </td>

              <!-- submitted (createdAt) -->
              <td class="has-text-right">
                <HighlightedText field="submitted" :search="search" style="opacity: 0.5">
                  {{ formatDate(book.createdAt) }}
                </HighlightedText>
              </td>

              <!-- edit/delete -->
              <td class="has-text-right">
                <div class="field is-grouped is-justify-content-flex-end">
                  <p class="control">
                    <button
                      :disabled="$uiBusy"
                      class="button is-flat"
                      @click.prevent="removeBook(book.id)"
                    >
                      <i class="fas fa-times" />
                    </button>
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
