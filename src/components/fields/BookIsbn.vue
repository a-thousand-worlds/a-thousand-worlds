<script>
import metadataByISBN from '@/util/metadataByISBN'

// const isValidIsbn = code => typeof code === 'string' && (code.length === 10 || code.length === 13)

export default {
  props: ['modelValue', 'disabled', 'searchable'],
  emits: ['update:modelValue', 'bookSelected', 'isbnSearchState', 'isbnSearchResult'],
  data() {
    return {
      isbn: this.modelValue || '',
      loading: false,
      searches: [],
    }
  },
  watch: {
    modelValue(next, prev) {
      this.isbn = next
    },
  },
  methods: {
    searchGlobal() {
      this.loading = true
      this.$emit('isbnSearchState', this.loading)
      metadataByISBN(this.isbn)
        .then(book => {
          this.loading = false
          this.$emit('isbnSearchState', this.loading)
          this.$emit('isbnSearchResult', book)
        })
        .catch(err => {
          console.error('error', err)
          this.loading = false
          this.$emit('isbnSearchState', this.loading)
          this.$emit('isbnSearchResult', null)
        })
    },
    doSearch(e) {
      const search = e.target.value
      this.isbn = search
      this.$emit('update:modelValue', search)
      this.book = null
      this.searches = this.$store.getters['books/list']().filter(
        book => search.length && book.isbn.includes(search),
      )
    },
    hideSearch() {
      this.searches = []
    },
    fillBook(b) {
      this.hideSearch()
      this.isbn = b.isbn
      this.$emit('update:modelValue', this.isbn)
      this.$emit('bookSelected', b)
    },
  },
}
</script>

<template>
  <div class="field has-addons">
    <div class="control w-100">
      <input
        v-model="isbn"
        :disabled="disabled"
        type="text"
        class="input"
        @input="doSearch($event)"
      />
      <div v-if="searches.length" v-click-outside="hideSearch" class="search-wrap">
        <div class="search-results">
          <div
            v-for="res of searches"
            :key="res.id"
            class="media p-2"
            @click.prevent="fillBook(res, si)"
          >
            <div class="media-left">
              <img :src="res.cover" />
            </div>
            <div class="media-right">
              <b>{{ res.title }}</b
              ><br />
              <small>{{ res.isbn }}</small
              ><br />
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="searchable" class="control">
      <button
        :disabled="disabled || loading || !isbn"
        :class="{ 'is-loading': loading }"
        class="button is-primary"
        @click="searchGlobal"
      >
        <i class="fas fa-search" />
        <span class="ml-3">Search</span>
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '@/assets/style/vars.scss' as *;

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
