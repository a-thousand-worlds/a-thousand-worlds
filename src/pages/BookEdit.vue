<script>
import sortBy from 'lodash/sortBy'
import dayjs from 'dayjs'
import BalloonEditor from '@ckeditor/ckeditor5-build-balloon'
import AddCreator from '@/components/AddCreator'
import AddTag from '@/components/AddTag'
import BookDetailLink from '@/components/BookDetailLink'
import Filter from '@/components/Filter'
import Clipboard from 'clipboard'
import CreatorCard from '@/components/CreatorCard'
import LazyImage from '@/components/LazyImage'
import Loader from '@/components/Loader'
import NotFound from '@/pages/NotFound'
import RecommendedBy from '@/components/RecommendedBy'
import SimpleInput from '@/components/fields/SimpleInput'
import Tag from '@/components/Tag'

const formatDate = d => {
  return dayjs(d).format('M/D/YYYY hh:mm')
}

export default {
  name: 'BookDetail',
  components: {
    AddCreator,
    AddTag,
    BookDetailLink,
    CreatorCard,
    Filter,
    LazyImage,
    Loader,
    NotFound,
    SimpleInput,
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
  data() {
    return {
      ckConfig: {},
      dayjs,
      editOnClick: false,
      editor: BalloonEditor,
    }
  },
  computed: {
    book() {
      const book = this.$store.state.books.loaded
        ? Object.values(this.$store.state.books.data).find(book => book.isbn === this.isbn)
        : null
      this.$store.dispatch('debug', { book })
      return book
    },
    // creators id array sorted by authors then illustrators
    creators() {
      if (!this.book || !this.book.creators) return []
      return sortBy(Object.keys(this.book.creators), id => this.book.creators[id])
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
    createdByName() {
      const user = this.$store.getters['users/get'](this.book?.createdBy)
      return user?.profile?.name
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
    addCreator(creatorId) {
      this.updateBook('creators', {
        // default to author-illustrator; it can be changed from the titleDropdown
        [creatorId]: 'author-illustrator',
      })
    },

    adminEditClick(e) {
      // use e.shiftKey instead of editOnClick in case shift key is held down from previous page
      if (!e.shiftKey) return
      this.$router.push({ name: 'BookDetail', params: this.$route.params })
    },

    formatDate,

    keydown(e) {
      if (e.key === 'Shift') {
        this.editOnClick = true
      }
    },

    keyup(e) {
      if (e.key === 'Shift') {
        this.editOnClick = false
      }
    },

    removeCreator(creatorId) {
      this.updateBook('creators', {
        [creatorId]: null,
      })
    },

    saveIsbn(isbn) {
      // save isbn
      this.$store.dispatch('books/update', {
        path: `${this.book.id}`,
        value: {
          isbn,
        },
      })

      // update route since it is based on isbn
      this.$router.replace({
        name: this.$route.name,
        params: {
          isbn,
          slug: this.$route.params.slug,
        },
      })
    },

    updateRecommendedBy(contributorId) {
      this.$store.dispatch('books/update', {
        path: `${this.book.id}`,
        value: {
          createdBy: contributorId,
        },
      })
    },

    updateTitle(creatorId, titleId) {
      // map titleId from creatorTitles to book creator titles
      this.updateBook('creators', {
        [creatorId]: titleId === 'author-illustrator' ? 'author-illustrator' : titleId,
      })
    },

    updateBook(field, value) {
      if (value === undefined) {
        value = field
        field = ''
      }

      // do not update if the field is not changed
      // handle field embedded in complex value, e.g. field === '' and value === { isbn: '1419742256' }
      if (this.book[field] === value) return
      const extractedField =
        field === '' && Object.keys(value).length === 1 && Object.keys(value)[0]
      if (extractedField && this.book[extractedField] === value[extractedField]) return

      this.$store.dispatch('books/update', {
        path: `${this.book.id}/${field}`,
        value,
      })
    },
  },
}
</script>

<template>
  <teleport to="#books-filter-menu">
    <Filter type="books" />
  </teleport>

  <div class="book-detail" :data-book-id="book?.id">
    <div class="is-flex is-justify-content-space-between mb-3">
      <div class="mb-5 is-narrow">
        <a @click.prevent="$router.back" class="is-uppercase is-primary">&lt; Back</a>
      </div>

      <BookDetailLink v-if="book" :book="book" class="button is-rounded is-primary"
        >View Book</BookDetailLink
      >
    </div>

    <div class="columns">
      <div class="column column1 mr-0 is-two-fifths">
        <div v-if="book">
          <!-- cover image -->
          <div class="book-cover-wrapper text-centered mb-20">
            <a
              @click.prevent="adminEditClick"
              :style="{ cursor: editOnClick ? 'context-menu' : 'default' }"
              ><LazyImage class="cover" :src="book.cover"
            /></a>
          </div>

          <!-- tags -->
          <div class="tags">
            <Tag
              v-for="tag of tags"
              :key="tag.id"
              :tag="tag"
              type="books"
              @remove="updateBook('tags', { [tag.id]: null })"
              button-class="is-outlined"
              editable
            />

            <AddTag type="books" :item="book" />
          </div>

          <table class="my-20">
            <!-- Created By -->
            <tr>
              <th class="has-text-right" style="white-space: nowrap">
                <b class="mr-3">submitted by</b>
              </th>
              <td>
                <span style="opacity: 0.5">{{ createdByName }}</span>
              </td>
            </tr>

            <!-- Created At -->
            <tr>
              <th class="has-text-right" style="white-space: nowrap">
                <b class="mr-3">submitted on</b>
              </th>
              <td>
                <span style="opacity: 0.5">{{ dayjs(book.createdAt).format('M/D/YYYY') }}</span>
              </td>
            </tr>

            <!-- Updated At -->
            <tr v-if="book.updatedAt !== book.createdAt">
              <th class="has-text-right" style="white-space: nowrap">
                <b class="mr-3">updated on</b>
              </th>
              <td>
                <span style="opacity: 0.5">{{ dayjs(book.updatedAt).format('M/D/YYYY') }}</span>
              </td>
            </tr>

            <!-- isbn -->
            <tr>
              <th class="has-text-right"><b class="mr-3">isbn</b></th>
              <td>
                <SimpleInput
                  v-if="book"
                  @update:modelValue="saveIsbn"
                  v-model="book.isbn"
                  placeholder="Enter ISBN"
                />
              </td>
            </tr>

            <!-- year -->
            <tr>
              <th class="has-text-right"><b class="mr-3">year</b></th>
              <td>
                <SimpleInput
                  v-if="book"
                  @update:modelValue="updateBook({ year: $event })"
                  v-model="book.year"
                  placeholder="Enter Year"
                />
              </td>
            </tr>

            <!-- goodreads -->
            <tr>
              <th class="has-text-right"><b class="mr-3">goodreads</b></th>
              <td>
                <SimpleInput
                  v-if="book"
                  @update:modelValue="updateBook({ goodreads: $event })"
                  v-model="book.goodreads"
                  placeholder="No value"
                />
              </td>
            </tr>
          </table>
        </div>
      </div>

      <div class="column">
        <div v-if="!$store.state.books.loaded" class="my-50">
          <Loader />
        </div>
        <div v-else-if="book">
          <!-- title -->
          <div class="title-container divider-bottom is-flex is-justify-content-space-between">
            <h1 class="title">
              <a
                @click.stop="adminEditClick"
                style="color: inherit"
                :style="{
                  cursor: editOnClick ? 'context-menu' : 'default',
                  'user-select': editOnClick ? 'none' : null,
                }"
              >
                <SimpleInput
                  @update:modelValue="updateBook({ title: $event })"
                  v-model="book.title"
                  placeholder="Enter Title"
                  unstyled
                />
              </a>
            </h1>
          </div>

          <!-- creators -->
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
                @remove="removeCreator(id)"
                @updateTitle="titleId => updateTitle(id, titleId)"
                edit
              />
              <AddCreator class="mb-10 ml-1 mr-30" @update="addCreator" style="width: 100%" />
            </div>
          </div>

          <!-- summary -->
          <ckeditor
            @update:modelValue="updateBook({ summary: $event })"
            v-model="book.summary"
            :editor="editor"
            :config="ckConfig"
            class="summary"
            style="padding: 0"
          />

          <RecommendedBy
            v-model="book.createdBy"
            @update:modelValue="updateRecommendedBy"
            edit
            class="mt-10"
            style="font-size: 16px"
          />
        </div>
        <div v-else>
          <NotFound />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import 'bulma/sass/utilities/_all.sass';
@import '@/assets/style/vars.scss';

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

<style lang="scss">
// compensate for CKEditor paragraph so that it exactly matches normal paragraph spacing
.summary.ck.ck-editor__editable_inline > :first-child {
  margin: -1px -2px -1px -1px;
}
</style>
