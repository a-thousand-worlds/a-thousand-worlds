<script>
export default {
  props: ['inputClass', 'inputId', 'modelValue', 'disabled', 'searchable'],
  emits: ['update:modelValue', 'bookSelected'],
  data() {
    return {
      title: this.modelValue || '',
      searches: [],
    }
  },
  watch: {
    modelValue(next, prev) {
      this.title = next
    },
  },
  methods: {
    doSearch(e) {
      const search = e.target.value
      this.$emit('update:modelValue', search)
      if (!this.searchable) {
        return
      }
      this.book = null
      this.searches = this.$store.state.booksList.filter(
        book => search && book.title.toLowerCase().includes(search.toLowerCase()),
      )
    },
    hideSearch() {
      this.searches = []
    },
    fillBook(b) {
      this.hideSearch()
      this.title = b.title
      this.$emit('update:modelValue', this.title)
      this.$emit('bookSelected', b)
    },
  },
}
</script>

<template>
  <div class="control">
    <input
      :id="inputId"
      v-model="title"
      :disabled="disabled"
      type="text"
      class="input"
      :class="inputClass"
      @input="doSearch($event)"
    />
    <div v-if="searches.length" v-click-outside="hideSearch" class="search-wrap">
      <div class="search-results">
        <div v-for="res of searches" :key="res.id" class="media p-2" @click.prevent="fillBook(res)">
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
</template>

<style lang="scss" scoped>
@use '@/assets/style/vars.scss' as *;

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
