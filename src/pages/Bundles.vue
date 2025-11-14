<script>
import Filter from '../components/Filter.vue'
import Loader from '@/components/Loader'

export default {
  name: 'BundlesPage',
  components: {
    Filter,
    Loader,
  },
  computed: {
    bundles() {
      return this.$store.state.bundles.data
    },
    bundleTags() {
      return this.$store.state.tags.bundles.data
    },
    filters() {
      return Object.values(this.$store.state.bundles.filters)
    },
    loading() {
      // return !this.$store.state.bundles.loaded || !this.$store.state.tags.bundles.loaded
      return false
    },
  },
  watch: {
    bundleTags(next, prev) {
      // load filters from url when tags/bundles are first loaded
      if (Object.keys(prev).length === 0 && Object.keys(next).length > 0) {
        this.$store.dispatch('bundles/setFiltersFromUrl')
      }
    },
  },
}
</script>

<template>
  <teleport to="#bundles-filter-menu">
    <Filter type="bundles" />
  </teleport>

  <div v-if="loading" class="has-text-centered" style="margin-top: 20vh">
    <Loader />
  </div>

  <div v-else>
    <div v-if="Object.keys(bundles).length === 0" class="my-50 has-text-centered">
      <h2 class="mb-20">
        No {{ filters.length ? 'matching' : '' }} bundles {{ !filters.length ? 'yet!' : '' }}
      </h2>
      <p v-if="filters.length">
        <a @click.prevent="resetFilter" class="button is-rounded is-primary">Reset Filter</a>
      </p>
    </div>

    <div class="is-flex is-flex-direction-row is-flex-wrap-wrap p-3">
      <div
        v-for="bundle of bundles"
        :key="bundle.id"
        :class="{ 'with-bookmarks': $store.state.ui.bookmarksOpen }"
        class="has-text-centered bundle-block p-3"
      >
        {{ bundle }}
      </div>
    </div>
  </div>
</template>
