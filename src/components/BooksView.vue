<script>
import BookCoverView from '@/components/BookCoverView'
import BookListView from '@/components/BookListView'
import Loader from '@/components/Loader'

export default {
  components: {
    BookCoverView,
    BookListView,
    Loader,
  },
  data() {
    return {
      // initial number of books to load and subsequent concurrency of loading books
      bookLimit: 8,
      // set to true to turn off the list view override on shared lists
      // set when the user manually toggles the view mode
      manualViewMode: false,
    }
  },
  computed: {
    books() {
      return this.$store.getters['books/filtered']
    },
    booksTopToBottom() {
      return this.books.slice(0, this.bookLimit)
    },
    isFiltered() {
      return this.$store.getters['books/isFiltered']
    },
    isShared() {
      return this.$store.getters['books/isShared']
    },
    loading() {
      return !this.$store.state.books.loaded || !this.$store.state.tags.books.loaded
    },
    viewMode() {
      // if this is a shared list, show in list view
      // the RightBar component uses this same condition to override viewMode
      // we cannot put this logic in store/ui since modules cannot react to $route
      return this.isShared && !this.manualViewMode ? 'list' : this.$store.state.ui.viewMode
    },
  },
  watch: {
    // when the user manually changes the view mode, turn off the list view override for shared lists
    '$store.state.ui.viewMode'(next, prev) {
      if (next && prev) {
        this.manualViewMode = true
      }
    },
  },
  methods: {
    // after a book is loaded, increase the limit so the next BookCoverView is rendered and the image is loaded
    bookCoverLoaded(book) {
      this.bookLimit++
    },
    resetFilter() {
      this.$store.dispatch('books/resetFilters')
    },
  },
}
</script>

<template>
  <div class="mx-20">
    <div v-if="loading" class="has-text-centered" style="margin-top: 20vh">
      <Loader />
    </div>

    <div v-else>
      <!-- no matching books -->
      <div v-if="isFiltered && books.length === 0" class="my-50 has-text-centered">
        <h2 class="mb-20">No matching books</h2>
        <p><a @click.prevent="resetFilter" class="button is-rounded is-primary">Reset Filter</a></p>
      </div>

      <!-- shared list -->
      <div v-if="isShared" class="mb-30 has-text-centered">
        <h2 class="mb-20">Someone shared a list of books with you!</h2>
      </div>

      <!-- show loader while share code is loading, otherwise it will show all books -->
      <div
        v-if="$store.state.books.loadingShareCode"
        class="has-text-centered"
        style="margin-top: 20vh"
      >
        <Loader />
      </div>

      <!-- books -->
      <div
        v-else
        :class="{
          'with-bookmarks': $store.state.ui.bookmarksOpen,
        }"
      >
        <masonry
          v-if="viewMode === 'covers'"
          :cols="{ default: 4, 1024: 3, 440: 2, 0: 1 }"
          :gutter="20"
          ><div v-for="book of booksTopToBottom" :key="book.id" style="margin-bottom: 20px">
            <BookCoverView :book="book" @loaded="bookCoverLoaded($event)" /></div
        ></masonry>
        <div v-else>
          <div
            v-for="book of booksTopToBottom"
            :key="book.id"
            style="margin-bottom: 20px; max-width: 400px; margin: 0 auto 20px"
          >
            <BookListView :book="book" @loaded="bookCoverLoaded($event)" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
