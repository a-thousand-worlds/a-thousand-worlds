<script>
export default {
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue', 'personSelected'],
  data() {
    return {
      name: this.modelValue || '',
      searches: [],
    }
  },
  watch: {
    modelValue(next, prev) {
      this.name = next
    },
  },
  methods: {
    doSearch(e) {
      const search = e.target.value.toLowerCase()
      this.$emit('update:modelValue', search)
    },
    hideSearch() {
      this.searches = []
    },
    fillPerson(p) {
      this.hideSearch()
      this.name = p.name
      this.$emit('update:modelValue', this.name)
      this.$emit('personSelected', p)
    },
  },
}
</script>

<template>
  <div class="control">
    <input
      v-model="name"
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
          @click.prevent="fillPerson(res)"
        >
          <b>{{ res.name }}</b
          ><br />
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
