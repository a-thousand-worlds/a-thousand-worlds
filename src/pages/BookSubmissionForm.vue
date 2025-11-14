<script>
import throttle from 'lodash/throttle'
import debounce from 'lodash/debounce'
import ISBN from 'isbn3'
import metadataByISBN from '@/util/metadataByISBN'
import findBookByKeyword from '@/util/findBookByKeyword'
import isValidISBN from '@/util/isValidISBN'
import parseNames from '@/util/parseNames'
import uid from '@/util/chronouid'
import validator from '@/mixins/validator'

import BackLink from '@/components/BackLink'
import BookTitleField from '@/components/fields/BookTitle'
import Content from '@/components/Content'
import LogarithmicProgressBar from '@/components/LogarithmicProgressBar'
import MessageSequence from '@/components/MessageSequence'
import RecommendedBy from '@/components/RecommendedBy'

export default {
  components: {
    BackLink,
    BookTitleField,
    Content,
    LogarithmicProgressBar,
    MessageSequence,
    RecommendedBy,
  },
  mixins: [
    validator(function () {
      return this.submissions.flatMap(this.validateSubmission).filter(x => x)
    }),
  ],
  data() {
    return {
      books: [],
      ckConfig: {
        toolbar: [],
      },
      confirms: [],
      draftSaved: null,
      findBookByKeywordNonce: 0,
      helpCompleted: null,
      loadingBook: [],
      submissions: [],
      titleId: uid(),
    }
  },
  created() {
    const draftBooks = this.$store.state.user.user?.profile.draftBooks
    this.submissions = draftBooks?.length
      ? draftBooks.map(draft => ({
          ...draft,
          tags: draft.tags || {},
          // do not restore thumbnail or confirmed if draft has no ISBN
          // this occurs if the user confirms no then refreshes the page before the thumbnail is reset
          ...(!draft.isbn && {
            // set attempts to 0 and confirmed to false to prompt the user to enter ISBN manually
            attempts: 0,
            confirmed: false,
            thumbnail: '',
          }),
        }))
      : [this.newSubmissionObject()]
  },
  methods: {
    coverImage(si) {
      return (
        this.books[si]?.cover?.base64?.url ||
        this.books[si]?.cover?.url ||
        this.books[si]?.cover ||
        this.submissions[si].thumbnail
      )
    },

    /** Gets books from the directory with matching ISBNs. Call this manually when the ISBN is updated rather than automatically in a computed property to avoid a false positive on the duplicate book detection when an owner adds an auto-approved book. */
    getBooks() {
      this.books = this.submissions.map(({ confirmed, isbn }) =>
        confirmed === null
          ? null
          : Object.values(this.$store.state.books.data || {}).find(
              // note that hardcover and softcover have different ISBNs, so duplicates cannot be detected automatically
              book =>
                book.isbn === isbn ||
                (ISBN.asIsbn10(book.isbn || '') &&
                  ISBN.asIsbn10(book.isbn || '') === ISBN.asIsbn10(isbn || '')),
            ),
      )
    },

    async setConfirmed(si, state) {
      const sub = this.submissions[si]
      sub.confirmed = state

      // yes
      if (state === true) {
        if (sub.isbnLastFound) {
          sub.isbn = sub.isbnLastFound
        }
        this.updateMetadataDebounced(si)
      }
      // no
      else if (state === false) {
        sub.isbnLastFound = sub.isbn
        sub.isbn = null
      }
      // pending/cancelled
      else if (state === null) {
        sub.isbn = null
      }

      this.getBooks()
      this.revalidate()
    },
    async submitForReview() {
      if (!this.validate()) return

      this.$store.commit('ui/setBusy', true)

      // fill in missing createdBy if submitted by the owner
      const submissions = this.$iam('owner')
        ? this.submissions.map(sub => ({
            ...sub,
            createdBy: sub.createdBy || this.$store.state.user.user?.uid || null,
          }))
        : this.submissions

      try {
        await submissions.forEach(async (_, sid) => this.updateMetadata(sid))
        await this.$store.dispatch('submissions/books/submit', submissions)
      } finally {
        this.$store.commit('ui/setBusy', false)
      }

      // if owner, alert success and reset the form rather than redirect
      if (this.$iam('owner')) {
        this.$store.dispatch('ui/popup', 'Book added to directory!')
        this.clearAllSubmissions()
      }
      // redirect all other users to Thank You page
      else {
        this.$router.push({ name: 'SubmissionThankYou', params: { type: 'book' } })
      }
    },
    clearDraft() {
      // user should be defined for all normal use
      // it may be undefined in unit tests
      if (!this.$store.state.user.user) return
      this.$store.dispatch('user/saveBookSubmissionsDraft', [])
      clearTimeout(this.draftSaved)
      this.draftSaved = null
    },
    saveDraft: debounce(function () {
      // user should be defined for all normal use
      // it may be undefined in unit tests
      if (!this.$store.state.user.user) return

      // fill in missing createdBy if submitted by the owner
      const submissions = this.$iam('owner')
        ? this.submissions.map(sub => ({
            ...sub,
            createdBy: sub.createdBy || this.$store.state.user.user?.uid || null,
          }))
        : this.submissions

      clearTimeout(this.draftSaved)
      this.$store.dispatch('user/saveBookSubmissionsDraft', submissions)
      this.draftSaved = setTimeout(() => {
        this.draftSaved = null
      }, 3000)
    }, 500),
    newSubmissionObject() {
      // cannot add createdBy here since auto login may not have completed yet
      return {
        attempts: 0,
        authors: '',
        confirmed: null,
        // createdAt needs to be set manually so that it gets saved to profile.draftBooks, which is not a managed collection
        createdAt: new Date().toISOString(),
        illustrators: '',
        isbn: '',
        publisher: '',
        summary: '',
        tags: {},
        thumbnail: '',
        title: '',
        year: '',
        loadingMetadata: false,
      }
    },
    addMoreSubmission() {
      // eslint-disable-next-line fp/no-mutating-methods
      this.submissions.push(this.newSubmissionObject())
    },
    delSubmission(si) {
      this.submissions = this.submissions.filter((x, xi) => xi !== si)
    },
    clearSubmission(si) {
      // remove submission and existing book
      // eslint-disable-next-line fp/no-delete
      delete this.books[si]
      this.submissions[si] = this.newSubmissionObject()
      this.errors = []
    },
    clearAllSubmissions(si) {
      this.submissions = [this.newSubmissionObject()]
      this.clearDraft()
      this.errors = []
    },

    metadataInputsChanged(si) {
      this.metadataInputsChangedDebounced(si)
      this.revalidate()
    },

    // when title, author, or illustrator changes, search for book cover
    metadataInputsChangedDebounced: debounce(async function (si) {
      const sub = this.submissions[si]
      const { authors, illustrators, title } = sub

      // only search by title and author which should be sufficient for uniqueness
      // increasing the length of the search query decreases the accuracy on Amazon
      const search = `${title.trim()} by ${parseNames(authors).join(' ')}`

      // clear book cover search if title, author, or illustrators are missing
      this.setConfirmed(si, null)
      sub.attempts = 0
      if (!title || !authors || !illustrators) {
        sub.isbn = null
        sub.confirmed = null
        sub.lastSearch = null
        sub.thumbnail = ''
        this.getBooks()
        return
      }

      // avoid duplicates
      // make sure illustrators is filled out, since it is not part of the search query
      if (search === sub.lastSearch) {
        return
      }

      // save the search so that we can avoid duplicate searches
      sub.lastSearch = search

      this.loadingBook[si] = true

      const nonce = ++this.findBookByKeywordNonce
      const result = await findBookByKeyword(search).catch(e => {
        console.error(e)
        return null
      })

      // bail if findBookByKeyword was called while this one was running
      // effectively cancels the old call
      if (nonce !== this.findBookByKeywordNonce) return

      sub.attempts = 1
      this.loadingBook[si] = false
      const { isbn, thumbnail } = result || {}
      if (isbn && isbn !== sub.isbn) {
        sub.isbn = isbn
        sub.thumbnail = thumbnail
      } else {
        sub.isbn = null
        sub.confirmed = null
        sub.thumbnail = ''
        this.setConfirmed(si, false)
      }

      this.getBooks()
      this.saveDraft()
      this.revalidate()
    }, 500),

    // fetch metadata and populate empty and suggested fields
    async updateMetadata(si) {
      let meta
      const sub = this.submissions[si]
      sub.loadingMetadata = true
      try {
        meta = await metadataByISBN(sub.isbn)
      } catch (e) {
        console.warn('metadataByISBN error:', e)
      } finally {
        sub.loadingMetadata = false
      }

      if (!meta) return
      this.suggested = meta
      if (meta.summary && !sub.summary) sub.summary = meta.summary
      if (meta.goodreads && !sub.goodreads) sub.goodreads = meta.goodreads
      if (meta.publisher && !sub.publisher) sub.publisher = meta.publisher
      if (meta.year && !sub.year) sub.year = meta.year

      // correct capitalization of user title but do not override (will be validated during approval)
      if (meta.title && meta.title?.toLowerCase() === sub.title.toLowerCase())
        sub.title = meta.title

      // set authors or illustrators only if not specified by user (will be validated during approval)
      if (meta.authors?.length && meta.authors?.join(', ') !== sub.authors && !sub.authors)
        sub.authors = meta.authors.join(', ')
      if (
        meta.illustrators?.length &&
        meta.illustrators?.join(', ') !== sub.illustrators &&
        !sub.illustrators
      )
        sub.illustrators = meta.illustrators.join(', ')
    },

    updateMetadataDebounced: debounce(function (si) {
      return this.updateMetadata(si)
    }, 500),

    async searchManualIsbn(si) {
      const sub = this.submissions[si]

      if (!isValidISBN(sub.isbn)) return

      this.loadingBook[si] = true
      const search = `${sub.isbn}`
      const nonce = ++this.findBookByKeywordNonce
      const result = await findBookByKeyword(search).catch(e => {
        console.error(e)
        return null
      })

      // bail if findBookByKeyword was called while this one was running
      // effectively cancels the old call
      if (nonce !== this.findBookByKeywordNonce) return

      this.loadingBook[si] = false
      const { isbn, thumbnail } = result || {}
      if (isbn) {
        sub.thumbnail = thumbnail
        sub.attempts = 2
        this.getBooks()
        this.setConfirmed(si, null)

        // set ISBN after setConfirmed, which clears it it
        sub.isbnLastFound = isbn

        this.updateMetadataDebounced(si)
      } else {
        sub.isbnLastFound = sub.isbn
        sub.attempts = 999
        this.setConfirmed(si, true)
      }
    },

    validateSubmission(sub) {
      return [
        !sub.title ? { name: 'title', message: 'Title is required' } : null,
        !sub.authors
          ? {
              name: 'authors',
              message:
                'Author is required' + (this.submissions.length > 1 ? ` for "${sub.title}"` : ''),
            }
          : null,
        !sub.illustrators
          ? {
              name: 'illustrators',
              message:
                'Illustrator is required (or "same")' +
                (this.submissions.length > 1 ? ` for "${sub.title}"` : ''),
            }
          : null,
        !sub.isbn
          ? {
              name: 'isbn',
              message:
                'ISBN is required' + (this.submissions.length > 1 ? ` for "${sub.title}"` : ''),
            }
          : null,
        !Object.values(sub.tags).some(x => x)
          ? {
              name: 'tags',
              message:
                'Tags are required' + (this.submissions.length > 1 ? ` for "${sub.title}"` : ''),
            }
          : null,
      ].filter(x => x)
    },

    revalidate: throttle(function () {
      this.saveDraft()
      if (this.errors.length > 0) {
        this.validate()
      }
    }, 500),

    // checkboxes do not update state immediately for some reason
    revalidateDelayed: function () {
      setTimeout(() => {
        this.revalidate()
      })
    },
  },
}
</script>

<template>
  <div class="mx-20 mb-30">
    <div class="is-flex is-justify-content-center">
      <form class="is-flex-grow-1" style="max-width: 540px" @submit.prevent="submitForReview">
        <div class="mb-5">
          <BackLink />
        </div>

        <h1 class="title page-title divider-bottom" style="position: relative">
          <Content name="book-submission/title" format="label">Submit a book</Content>
          <span
            v-if="helpCompleted"
            @click.prevent="$refs.help.toggle"
            v-tippy="{ content: 'Help' }"
            class="has-text-right"
            style="
              position: absolute;
              right: 0;
              bottom: 20px;
              font-size: 16px;
              white-space: nowrap;
              cursor: pointer;
            "
            ><i class="far fa-question-circle"
          /></span>
        </h1>

        <MessageSequence
          ref="help"
          storageKey="bookSubmissionForm"
          @load="helpCompleted = $event.completed"
          @completed="helpCompleted = $event"
        >
          <template>
            <h2 class="field">
              <Content name="instructions/bookSubmissionForm/title">Getting Started</Content>
            </h2>
            <div class="field">
              <Content name="instructions/bookSubmissionForm/body">
                This is the Book Submission Form. Fill out this form to submit one or more picture
                books to be reviewed by the ATW curatorial team and entered into the book directory
                upon approval.
              </Content>
            </div>
          </template>
        </MessageSequence>

        <div v-for="(sub, si) of submissions" :key="si">
          <section class="basic-information">
            <!-- title -->
            <div class="field">
              <label :for="titleId" class="label" :class="{ 'has-text-danger': hasError('title') }"
                >Title<sup class="required">*</sup></label
              >
              <BookTitleField
                v-model="sub.title"
                :disabled="$uiBusy || books[si]?.id"
                :inputClass="{ 'is-danger': hasError('title') }"
                :inputId="titleId"
                :searchable="false"
                @book-selected="fillBook($event, si)"
                @input="metadataInputsChanged(si)"
              />
            </div>

            <!-- authors -->
            <div class="field">
              <label class="label" :class="{ 'has-text-danger': hasError('authors') }" for="authors"
                >Author(s)<sup class="required">*</sup></label
              >
              <div class="control">
                <input
                  id="authors"
                  v-model="sub.authors"
                  type="text"
                  :disabled="$uiBusy || books[si]?.id"
                  @input="metadataInputsChanged(si)"
                  class="input"
                  :class="{ 'is-danger': hasError('authors') }"
                />
              </div>
            </div>

            <!-- illustrators -->
            <div class="field">
              <label
                for="illustrators"
                class="label"
                :class="{ 'has-text-danger': hasError('illustrators') }"
                >Illustrator(s)<sup class="required">*</sup>
                <p style="font-weight: normal; text-transform: none">
                  If same as author type "same"
                </p>
              </label>
              <div class="control">
                <input
                  id="illustrators"
                  v-model="sub.illustrators"
                  type="text"
                  :disabled="$uiBusy || books[si]?.id"
                  @input="metadataInputsChanged(si)"
                  class="input"
                  :class="{ 'is-danger': hasError('illustrators') }"
                />
              </div>
            </div>

            <div
              v-if="
                loadingBook[si] ||
                books[si] ||
                coverImage(si) ||
                sub.confirmed != null ||
                (!sub.isbn && sub.isbnLastFound)
              "
              class="field"
            >
              <div class="columns">
                <!-- cover/loading -->
                <div class="column">
                  <LogarithmicProgressBar v-if="loadingBook[si]" role="loading" />
                  <div v-else class="bg-secondary">
                    <img
                      :src="coverImage(si) || null"
                      role="thumbnail"
                      alt="thumbnail"
                      style="display: block; min-width: 120px; min-height: 150px; max-width: 265px"
                      :style="
                        (sub.confirmed === false || (sub.confirmed === true && !coverImage(si))) &&
                        !books[si]
                          ? { visibility: 'hidden' }
                          : null
                      "
                    />
                  </div>
                </div>
                <div v-if="!loadingBook[si]" class="column is-flex is-align-items-center">
                  <!-- Duplicate -->
                  <!-- Do not show if ui is busy, otherwise auto approved books by owner flash this message  -->
                  <div v-if="books[si] && !$uiBusy">
                    <p class="mb-10 is-uppercase" style="font-weight: bold; max-width: 265px">
                      Great minds think alike. This book is already in our directory.
                    </p>
                    <button class="button is-rounded" @click="clearSubmission(si)">
                      Clear Info
                    </button>
                  </div>

                  <!-- Is this the correct book? -->
                  <div
                    v-else-if="!loadingBook[si] && (coverImage(si) || sub.confirmed != null)"
                    class="column field"
                  >
                    <div v-if="sub.confirmed === null" class="control mb-20">
                      <label class="label" :class="{ 'has-text-danger': hasError('isbn') }"
                        >Is this the correct book?</label
                      >
                      <div class="field" :class="{ 'is-grouped': sub.attempts === 1 }">
                        <div class="control mb-2">
                          <button
                            :disabled="sub.confirmed"
                            :style="sub.confirmed ? { cursor: 'default' } : null"
                            @click.prevent="setConfirmed(si, true)"
                            class="button is-rounded"
                            :class="{
                              'is-primary': sub.confirmed !== false,
                              'is-selected': sub.confirmed,
                            }"
                          >
                            Yes
                          </button>
                        </div>
                        <div class="control mb-2">
                          <button
                            @click.prevent="setConfirmed(si, false)"
                            class="button is-rounded"
                          >
                            No{{ sub.attempts > 1 ? ', try again' : '' }}
                          </button>
                        </div>
                        <div class="control mb-2">
                          <button
                            v-if="sub.attempts > 1"
                            @click.prevent="setConfirmed(si, true)"
                            class="button is-rounded"
                          >
                            No, but keep anyway
                          </button>
                        </div>
                      </div>
                    </div>
                    <div v-if="sub.confirmed === true" class="control">
                      <label class="label"
                        >{{ sub.attempts > 1 ? 'Got it' : 'Great' }} - Thanks!</label
                      >
                    </div>
                    <div v-if="sub.confirmed === false" class="control">
                      <div class="field mb-20">
                        <label v-if="!sub.thumbnail && sub.attempts > 0" class="label"
                          >Hmmm... we couldn't find that book.</label
                        >
                        <label
                          for="isbn"
                          class="label"
                          :class="{ 'has-text-danger': hasError('isbn') }"
                          style="margin-right: -20px"
                          >{{ sub.thumbnail ? 'Okay, ' : '' }}please enter the ISBN:</label
                        >
                        <div class="control">
                          <input id="isbn" v-model="sub.isbn" class="input" :disabled="$uiBusy" />
                        </div>
                      </div>
                      <div class="field">
                        <div class="control">
                          <button
                            :disabled="!sub.isbn"
                            @click="searchManualIsbn(si)"
                            class="button is-rounded is-primary"
                          >
                            Search
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <!--
                  <div v-if="sub.confirmed" class="column field">
                    Thank you!
                  </div>
                  -->
                </div>
              </div>
            </div>

            <!-- recommended by (owner only) -->
            <div v-if="$iam('owner')" class="field">
              <RecommendedBy
                v-model="sub.createdBy"
                edit
                existing-contributors-only
                label="Recommended By"
                labelStyle="display: block;"
                style="font-size: 18px"
              />
            </div>

            <!-- summary -->
            <!--
            <div class="field">
              <label class="label">Summary</label>
              <div style="border-radius: 4px; border: solid 1px #dbdbdb; color: #363636;">
                <ckeditor :disabled="$uiBusy || submissions[si].oadingMetadata || (books[si]?.id)" :editor="editor" :config="ckConfig" v-model="sub.summary" />
              </div>
            </div>
            -->

            <!-- tags -->
            <div v-if="!books[si] || (books[si] && !books[si].id)" class="field">
              <label class="label" :class="{ 'has-text-danger': hasError('tags') }"
                ><Content name="book-submission/tags" format="label"
                  >How would you categorize this book? Select all that apply</Content
                ><sup class="required">*</sup></label
              >
              <div class="text-14 tablet-columns-2">
                <div
                  v-for="tag of $store.getters['tags/books/listSorted']()"
                  :key="tag.id"
                  class="control is-flex"
                  style="column-break-inside: avoid"
                >
                  <input
                    :id="`${tag.id}-${si}`"
                    v-model="sub.tags[tag.id]"
                    :name="tag.id"
                    type="checkbox"
                    class="checkbox mr-3 mb-3 mt-1"
                    @input="revalidateDelayed"
                  />
                  <label class="label mb-1 no-user-select" :for="`${tag.id}-${si}`">
                    {{ tag.tag }}
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section v-if="submissions.length > 1">
            <button @click="delSubmission(si)" class="button is-rounded">
              <i class="fas fa-minus" />
              <span class="ml-3">Delete</span>
            </button>
          </section>

          <hr class="double" />
        </div>

        <div>
          <button :disabled="$uiBusy" class="button is-rounded" @click.prevent="addMoreSubmission">
            <i class="fas fa-plus" />
            <span class="ml-2">Add another book</span>
          </button>
        </div>

        <hr />

        <p v-if="submissions[0]?.title.length > 0 && errors.length === 0" class="mb-20">
          You have {{ submissions.length }} book{{ submissions.length > 1 ? 's' : '' }} ready to
          submit.
        </p>

        <!-- submit -->
        <div class="field is-grouped">
          <button
            @click.prevent="submitForReview"
            :class="{ 'is-loading': $uiBusy }"
            class="button is-rounded is-primary mr-20"
          >
            {{ $iam('owner') ? 'Add to Directory' : 'Submit for review' }}
          </button>
          <button class="button is-rounded" @click.prevent="clearAllSubmissions">Reset All</button>
          <button
            v-if="draftSaved"
            @click.prevent="saveDraft"
            class="button is-flat"
            style="cursor: text"
          >
            Draft Saved
          </button>
        </div>

        <!-- errors -->
        <div v-if="errors.length" class="field">
          <p v-for="(error, i) of errors" :key="i" class="error has-text-centered is-uppercase">
            {{ error.message || 'Unknown error' }}
          </p>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/assets/style/vars.scss' as *;
@use 'bulma/sass/utilities/mixins' as *;

.required {
  position: absolute;
}

.text-14 .label {
  font-size: 14px;
}

.basic-information > .field {
  margin-bottom: 30px;
}

.label {
  text-transform: uppercase;
  font-size: 18px;
}
.tablet-columns-2 {
  column-count: 1;

  @include from($tablet) {
    column-count: 2;
  }
}

.w-100 {
  width: 100%;
}

.search-wrap {
  position: relative;

  .search-results {
    position: absolute;
    width: 100%;
    max-height: 400px;
    overflow-y: scroll;
    left: 0;
    top: 0;
    z-index: $zField;
    background: #fff;
    border: 1px solid;

    img {
      max-height: 60px;
    }

    .media {
      margin: 0 !important;

      &:hover {
        background: #eee;
      }
    }
  }
}
</style>
