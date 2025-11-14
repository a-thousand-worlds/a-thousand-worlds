<script>
import { useHead } from '@vueuse/head'
import { watchEffect } from 'vue'
import store from '@/store'
import computedFromState from '@/util/computedFromState'
import Filter from '../components/Filter.vue'
import Loader from '@/components/Loader'
import PersonCard from '@/components/PersonCard'

export default {
  components: {
    Filter,
    Loader,
    PersonCard,
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
    const getFilterPhrase = state => {
      const filters = state.people.filters
      const filterNames = filters.map(tag => tag.tag).join(', ')
      return `${filterNames} creators`
    }

    const getDescription = state =>
      state.people.filters.length > 0
        ? `Read books by ${getFilterPhrase(state)} at A Thousand Worlds`
        : 'Colorful Reads X Colorful People'
    const getTitle = state =>
      state.people.filters.length > 0
        ? `${getFilterPhrase(state)} @ A Thousand Worlds`
        : 'A Thousand Worlds'

    const descriptionComputed = computedFromState(getDescription)
    // TODO: Commit people collage once we have all the people photos
    // const image = `${window.location.origin}/social/people.png`
    const titleComputed = computedFromState(getTitle)

    useHead({
      title: titleComputed,
      meta: [
        { name: 'og:description', content: descriptionComputed },
        // { name: 'og:image', content: `${image}?fbreset=1` },
        { name: 'og:title', content: titleComputed },
        { name: 'twitter:description', content: descriptionComputed },
        // { name: 'twitter:image', content: image },
        { name: 'twitter:title', content: titleComputed },
      ],
    })
    watchEffect(() =>
      store.dispatch('structuredData/set', {
        path: 'description',
        value: descriptionComputed.value,
      }),
    )
    // watchEffect(() => store.dispatch('structuredData/set', { path: 'image.url', value: imageComputed.value }))
    watchEffect(() =>
      store.dispatch('structuredData/set', { path: 'headline', value: titleComputed.value }),
    )
  },
  computed: {
    people() {
      return this.$store.getters['people/filtered']
    },
    filters() {
      return Object.values(this.$store.state.people.filters)
    },
    loading() {
      return !this.$store.state.people.loaded || !this.$store.state.tags.people.loaded
    },
    peopleTags() {
      return this.$store.state.tags.people.data
    },
  },
  watch: {
    peopleTags(next, prev) {
      // load filters from url when tags/people are first loaded
      if (Object.keys(prev).length === 0 && Object.keys(next).length > 0) {
        this.$store.dispatch('people/setFiltersFromUrl')
      }
    },
  },
  methods: {
    resetFilter() {
      this.$store.dispatch('people/resetFilters')
    },
  },
}
</script>

<template>
  <teleport to="#people-filter-menu">
    <Filter type="people" />
  </teleport>

  <div v-if="loading" class="has-text-centered" style="margin-top: 20vh">
    <Loader />
  </div>

  <div v-else>
    <div v-if="filters.length && people.length === 0" class="my-50 has-text-centered">
      <h2 class="mb-20">No matching people</h2>
      <p><a @click.prevent="resetFilter" class="button is-rounded is-primary">Reset Filter</a></p>
    </div>

    <div class="is-flex is-flex-direction-row is-flex-wrap-wrap mx-20 mb-60">
      <div
        v-for="person of people"
        :key="person.id"
        :class="{ 'with-bookmarks': $store.state.ui.bookmarksOpen }"
        class="has-text-centered person-block p-3"
      >
        <PersonCard :person="person" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use 'bulma/sass/utilities/mixins' as *;
@use '@/assets/style/vars.scss' as *;

.person-block {
  width: 50%;
  margin: 0 25% 20px;

  @include from($tablet) {
    margin-left: 0;
    margin-right: 0;
  }
  @include from($desktop) {
    width: 33%;
  }
  @include from($widescreen) {
    width: 25%;
  }

  &.with-bookmarks {
    width: 100%;
    @include from($desktop) {
      width: 50%;
    }
    @include from($widescreen) {
      width: 33%;
    }
  }
}
</style>
