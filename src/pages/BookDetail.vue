<script>
import { watchEffect } from 'vue'
import { useHead } from '@vueuse/head'
import computedFromState from '@/util/computedFromState'
import writtenList from '@/util/writtenList'
import sortBy from 'lodash/sortBy'
import Clipboard from 'clipboard'
import router from '@/router'
import store from '@/store'
import BackLink from '@/components/BackLink'
import BookDetailFooter from '@/components/BookDetailFooter'
import BookmarkButton from '@/components/BookmarkButton'
import Filter from '@/components/Filter'
import CreatorCard from '@/components/CreatorCard'
import LazyImage from '@/components/LazyImage'
import Loader from '@/components/Loader'
import NotFound from '@/pages/NotFound'
import PrevNext from '@/components/PrevNext'
import RecommendedBy from '@/components/RecommendedBy'
import Tag from '@/components/Tag'

/** Gets the detail page book object. Not reactive. */
const getBook = state =>
  state.books.loaded
    ? Object.values(state.books.data).find(
        book => book.isbn === router.currentRoute._value.params.isbn,
      )
    : null

export default {
  name: 'BookDetail',
  components: {
    BackLink,
    BookDetailFooter,
    BookmarkButton,
    Filter,
    CreatorCard,
    LazyImage,
    Loader,
    NotFound,
    PrevNext,
    RecommendedBy,
    Tag,
  },
  beforeRouteLeave(to, from, next) {
    // mark the user's visit once they navigate to any other page
    // used to show the one-time welcome messagein App.vue
    if (!this.$store.state.ui.lastVisited) {
      this.$store.commit('ui/setLastVisited', new Date())
    }
    next()
  },
  setup() {
    /** Gets the social title for the book. */
    const getTitle = state => {
      const book = getBook(state)
      // TODO: null should cause @vueuse/head to ignore this computed value afaik
      // (https://github.com/raineorshine/head/blob/main/src/index.ts#L143)
      // but for some reason it is gettind rendered as undefined.
      // I forked @vueuse/head but it is causing an injectHead error when I try to npm link it to the app
      return book ? `${book.title} @ A Thousand Worlds` : null
    }

    /** Gets the social description for the book. */
    const getDescription = state => {
      const book = getBook(state)
      const creators = creatorsPhrase(state, book)
      return book ? `Read ${book.title} by ${creators} at A Thousand Worlds` : null
    }

    /** Gets the image of the book. */
    const getImage = state => {
      const book = getBook(state)
      const url = book?.cover?.src || book?.cover?.url || book?.cover
      return url || null
    }

    /** Generates a written phrase of the creators of a book. */
    const creatorsPhrase = (state, book) => {
      if (!book) return ''
      const names = sortBy(Object.keys(book.creators || {}), id => book.creators[id]).map(
        id => state.people.data?.[id].name,
      )
      return writtenList(names)
    }

    const descriptionComputed = computedFromState(getDescription)
    const imageComputed = computedFromState(getImage)
    const titleComputed = computedFromState(getTitle)

    useHead({
      title: titleComputed,
      meta: [
        { name: 'og:description', content: descriptionComputed },
        { name: 'og:image', content: imageComputed },
        { name: 'og:title', content: titleComputed },
        { name: 'twitter:description', content: descriptionComputed },
        { name: 'twitter:image', content: imageComputed },
        { name: 'twitter:title', content: titleComputed },
      ],
    })

    watchEffect(() =>
      store.dispatch('structuredData/set', {
        path: 'description',
        value: descriptionComputed.value,
      }),
    )
    watchEffect(() =>
      store.dispatch('structuredData/set', { path: 'image.url', value: imageComputed.value }),
    )
    watchEffect(() =>
      store.dispatch('structuredData/set', { path: 'headline', value: titleComputed.value }),
    )
  },
  data() {
    return {
      editOnClick: false,
    }
  },
  computed: {
    book() {
      const book = this.$store.state.books.loaded
        ? Object.values(this.$store.state.books.data).find(
            book => book.isbn === this.$route.params.isbn,
          )
        : null
      this.$store.dispatch('debug', { book })
      return book
    },
    // creators id array sorted by authors then illustrators
    creators() {
      if (!this.book || !this.book.creators) return []
      return sortBy(Object.keys(this.book.creators), id => this.book.creators[id])
    },
    editUrl() {
      const url = window.location.href
      return url.replace(/\/$/, '') + '/edit'
    },
    isbn() {
      return this.$route.params.isbn
    },
    tags() {
      const bookTags = this.$store.state.tags.books.data || {}
      return Object.keys(this.book?.tags || [])
        .map(id => bookTags[id])
        .filter(x => x)
    },
  },
  created() {
    window.addEventListener('keydown', this.keydown)
    window.addEventListener('keyup', this.keyup)
  },
  mounted() {
    new Clipboard('#copy-link') // eslint-disable-line no-new
  },
  unmounted() {
    window.removeEventListener('keydown', this.keydown)
    window.removeEventListener('keyup', this.keyup)
  },
  methods: {
    adminEditClick(e) {
      // use e.shiftKey instead of editOnClick in case shift key is held down from previous page
      if (!this.$iam('owner') || !e.shiftKey) return
      this.$router.push({ name: 'BookEdit', params: this.$route.params })
    },
    keydown(e) {
      if (this.$iam('owner') && e.key === 'Shift') {
        this.editOnClick = true
      }
    },
    keyup(e) {
      if (this.$iam('owner') && e.key === 'Shift') {
        this.editOnClick = false
      }
    },
  },
}
</script>

<template>
  <teleport to="#books-filter-menu">
    <Filter type="books" />
  </teleport>

  <div class="book-detail" :data-book-id="book?.id">
    <div class="columns mb-5">
      <div class="column is-narrow">
        <BackLink />
      </div>

      <PrevNext v-if="book" type="books" :item="book" class="column" />
    </div>

    <div class="columns">
      <div class="column column1 mr-0 is-two-fifths">
        <div v-if="book">
          <div class="book-cover-wrapper text-centered mb-20">
            <a
              @click.prevent="adminEditClick"
              :style="{ cursor: editOnClick ? 'context-menu' : 'default' }"
              ><LazyImage class="cover" :src="book.cover"
            /></a>
          </div>
          <div class="tags">
            <Tag
              v-for="tag of tags"
              :key="tag.id"
              :tag="tag"
              type="books"
              button-class="is-outlined"
            />
          </div>
        </div>
      </div>

      <div class="column">
        <div v-if="!$store.state.books.loaded" class="my-50">
          <Loader />
        </div>
        <div v-else-if="book">
          <div class="title-container divider-bottom is-flex is-justify-content-space-between">
            <h1 class="title">
              <a
                @click.prevent="adminEditClick"
                style="color: inherit"
                :style="{
                  cursor: editOnClick ? 'context-menu' : 'default',
                  'user-select': editOnClick ? 'none' : null,
                }"
                >{{ book.title }}</a
              >
            </h1>
            <!-- set padding-top and height so that the icon lines up with the top of the title text and the bottom of its baseline -->
            <BookmarkButton :book="book" iconStyle="margin-top: 6.5px; height: 27px;" />
          </div>

          <!-- use negative right margin to avoid wrapping creators until margin is used up -->
          <div class="creators divider-bottom">
            <div class="is-flex is-flex-wrap-wrap" style="margin-right: -30px">
              <!-- if there is more than one creator, and they are not all author-illustrators, do not shorten "words and pictures by" to "by" -->
              <CreatorCard
                v-for="id in creators"
                :key="id"
                :id="id"
                :longlabel="
                  creators.length > 1 &&
                  Object.values(book.creators).some(role => role !== 'author-illustrator')
                "
                :role="book.creators[id]"
                class="mb-20 mr-30"
                style="min-width: 33%"
              />
            </div>
          </div>

          <!-- summary is edited with ckeditor and may contain html -->
          <p class="summary" :innerHTML="book.summary || book.description" />

          <RecommendedBy
            v-if="book.createdBy"
            v-model="book.createdBy"
            class="mt-10"
            style="font-size: 16px"
          />
        </div>
        <div v-else>
          <NotFound />
        </div>
      </div>
    </div>

    <!-- Add a bottom spacer so that fixed position footer clears content when scrolled to the bottom. -->
    <div class="mb-7" />
  </div>

  <BookDetailFooter v-if="book" :book="book" />
</template>

<style lang="scss" scoped>
@use '@/assets/style/vars.scss' as *;
@use 'bulma/sass/utilities/mixins' as *;

.book-detail {
  margin: 0 20px;
  max-width: $widescreen;
  @include from($tablet) {
    margin: 0 30px;
  }
  @include from($desktop) {
    margin: 0 60px;
  }
}

.column1 {
  text-align: center;
  @include from($tablet) {
    text-align: left;
  }
}

.book-cover-wrapper {
  @include from($desktop) {
    margin-right: 20px;
  }
}

.title {
  line-height: 1;
  margin-bottom: 0;
}

.creators {
  font-size: 14px;
}

.summary {
  font-size: 16px;
  line-height: 1.75;
}
</style>
