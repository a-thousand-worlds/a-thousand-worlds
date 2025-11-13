<script>
import BookTitleField from '@/components/fields/BookTitle'
import BookIsbnField from '@/components/fields/BookIsbn'
import PersonField from '@/components/fields/Person'
import BackLink from '@/components/BackLink'

export default {
  components: {
    'book-title-field': BookTitleField,
    'book-isbn-field': BookIsbnField,
    'person-field': PersonField,
    BackLink,
  },
  data() {
    return {
      name: '',
      description: '',
      books: [],
    }
  },
  computed: {
    draftable() {
      return (
        this.books.some(x => x.title || x.author || x.illustrator || x.isbn) ||
        this.name.length ||
        this.description.length
      )
    },
    submitable() {
      return (
        this.books.every(x => x.title.length && x.author.length) &&
        this.name.length &&
        this.description.length
      )
    },
  },
  created() {
    this.addBook()
  },
  methods: {
    saveDraft() {
      const data = {
        name: this.name || '',
        description: this.description || '',
        books: this.books,
      }
      this.$store.dispatch('saveBundleSubmissionsDraft', data).then(() => {
        this.$router.push({ name: 'Dashboard' })
      })
    },
    submitForReview() {
      const data = {
        name: this.name || '',
        description: this.description || '',
        books: this.books,
      }
      this.$store.dispatch('submitBundleSubmission', data).then(() => {
        this.$router.push({ name: 'Dashboard' })
      })
    },
    newBookObject() {
      return {
        title: '',
        isbn: '',
        author: '',
        illustrator: '',
      }
    },
    addBook() {
      // eslint-disable-next-line fp/no-mutating-methods
      this.books.push(this.newBookObject())
    },
    delBook(i) {
      this.books = this.books.filter((x, xi) => i !== xi)
    },
    fillBook(book, i) {
      this.books[i].title = book.title
      this.books[i].isbn = book.isbn
      this.books[i].author = this.$store.state.people.reduce((acc, x) => {
        if (book.authors.includes(x.name) && x.role === 'author') {
          if (acc !== '') {
            acc += ', '
          }
          acc += x.name
        }
        return acc
      }, '')
      this.books[i].illustrator = this.$store.state.people.reduce((acc, x) => {
        if (book.authors.includes(x.name) && x.role === 'illustrator') {
          if (acc !== '') {
            acc += ', '
          }
          acc += x.name
        }
        return acc
      }, '')
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

        <h1 class="title page-title divider-bottom">Curate a Book Bundle</h1>

        <div
          class="bg-secondary p-20 mb-20"
          style="display: inline-block; border-radius: 10px; font-size: 20px"
        >
          <h2 class="field">Getting Started</h2>
          <p class="field">
            This is the <b>Bundle Submission Form</b>. Fill out this form to submit a collection of
            4-7 books based on one theme. The BOOK BUNDLE is an opportunity to spotlight a certain
            theme, support a BIPOC bookstore and also to showcase you. Your bio and picture will be
            included in the BUNDLE as well. The BUNDLE form will be reviewed by the ATW curatorial
            team and entered into the BOOK BUNDLE directory upon approval.
          </p>
          <button class="button is-rounded is-primary">Okay, got it</button>
        </div>

        <div>
          <section class="section">
            <div class="field">
              <label class="label">What do you want to call this bundle?</label>
              <div class="control">
                <input v-model="name" :disabled="$uiBusy" type="text" class="input" />
              </div>
            </div>

            <div class="field">
              <label class="label"
                >Tell us why you love these books. (this will serve as the description for the
                Bundle)</label
              >
              <div class="control">
                <textarea v-model="description" class="textarea" />
              </div>
            </div>

            <hr />
          </section>
          <div v-for="(book, i) of books" :key="i">
            <section class="section">
              <div class="field">
                <label class="label">Title</label>
                <book-title-field
                  v-model="books[i].title"
                  :disabled="$uiBusy"
                  @book-selected="fillBook($event, i)"
                />
              </div>

              <div class="field">
                <label class="label">Author</label>
                <person-field v-model="books[i].author" :disabled="$uiBusy" :role="'author'" />
              </div>

              <div class="field">
                <label class="label">Illustrator</label>
                <person-field
                  v-model="books[i].illustrator"
                  :disabled="$uiBusy"
                  :role="'illustrator'"
                />
              </div>

              <div class="field">
                <label class="label">ISBN</label>
                <book-isbn-field
                  v-model="books[i].isbn"
                  :disabled="$uiBusy"
                  :searchable="false"
                  @book-selected="fillBook($event, i)"
                />
              </div>
            </section>

            <section v-if="books.length > 1">
              <button class="button is-info is-outlined" @click="delBook(i)">
                <i class="fas fa-minus" />
                <span class="ml-3">Delete</span>
              </button>
            </section>
          </div>

          <section class="section">
            <div>
              <button :disabled="$uiBusy" class="button is-primary" @click.prevent="addBook">
                <i class="fas fa-plus" />
                <span class="ml-2">Add another book</span>
              </button>
            </div>
          </section>

          <section class="section">
            <div class="field is-grouped">
              <div class="control">
                <button
                  :disabled="!draftable || $uiBusy"
                  :class="{ 'is-loading': $uiBusy }"
                  class="button is-primary"
                  @click.prevent="saveDraft"
                >
                  <span class="ml-2">Save as draft</span>
                </button>
              </div>
              <div class="control">
                <button
                  :disabled="!submitable || $uiBusy"
                  :class="{ 'is-loading': $uiBusy }"
                  class="button is-primary"
                  @click.prevent="submitForReview"
                >
                  <span class="ml-2">Submit for review</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </form>
    </div>
  </div>
</template>
