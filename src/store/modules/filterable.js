import slugify from '@sindresorhus/slugify'

import router from '@/router'
import specialFilters from '@/store/constants/special-filters'

const module = () => ({
  state: {
    filters: [],
    idFilters: [],
  },
  mutations: {
    resetFilters(state) {
      state.idFilters = []
      state.filters = []
    },
    toggleFilter(state, filter) {
      const isFilterOn = state.filters.some(activeFilter => activeFilter.id === filter.id)

      // toggle off filter
      if (isFilterOn) {
        state.filters = state.filters.filter(activeFilter => activeFilter.id !== filter.id)
      }
      // toggle on filter
      else {
        // toggle off subtags with same parent
        const filtersNoOtherSubtags = state.filters.filter(
          activeFilter => !activeFilter.parent || activeFilter.parent !== filter.parent,
        )
        state.filters = [...filtersNoOtherSubtags, filter]
      }
    },
    setIdFilters(state, ids) {
      state.idFilters = ids
    },
    setFilters(state, filters) {
      state.filters = filters
    },
  },
  getters: {
    isFiltered: state => {
      return state.filters?.length > 0 || state.idFilters?.length > 0
    },
    isFilteredByIds: state => {
      return state.idFilters?.length > 0
    },
    filtered:
      state =>
      (items, tagName = 'tags') => {
        if (!state.filters?.length && !state.idFilters?.length) return items

        return items.filter(
          item =>
            state.filters.every(filter => {
              // handle hardcoded special filters
              const key = specialFilters.people.some(({ id }) => id === filter.id)
                ? 'title'
                : tagName
              const value = item[key]
              const itemFilters = Array.isArray(value)
                ? value
                : typeof value === 'string'
                ? [value]
                : typeof value === 'object'
                ? Object.keys(value)
                : []
              return itemFilters.includes(filter.id)
            }) &&
            // id filters
            (state.idFilters?.length === 0 || state.idFilters.includes(item.id)),
        )
      },
  },
  actions: {
    resetFilters({ commit, dispatch }) {
      commit('resetFilters')
      dispatch('updateUrl')
    },
    setFilters({ commit, dispatch }, filters) {
      commit('setFilters', filters)
      dispatch('updateUrl')
    },
    setFiltersFromUrl({ state, commit, rootGetters }) {
      const urlParams = new URLSearchParams(window.location.search)
      const urlFilters = urlParams.get('filters')?.split(',') || []
      const urlIds = urlParams.get('ids')?.split(',') || []

      if (!urlFilters.length === 0 && urlIds.length === 0) {
        commit('resetFilters')
        return
      }

      // tag filters
      if (urlFilters.length > 0) {
        const tags = rootGetters[`tags/${state.name}/list`]()
        const tagsSelected = urlFilters
          .map(urlFilter => {
            const [filterKey] = urlFilter.split('/')
            const activeFilter = tags.find(tag => slugify(tag.tag) === filterKey)
            return activeFilter
          })
          .filter(x => x)
        commit('setFilters', tagsSelected)
      }

      // id filters
      if (urlIds.length > 0) {
        commit('setIdFilters', urlIds)
      }
    },
    toggleFilter({ commit, dispatch }, filter) {
      commit('toggleFilter', filter)
      dispatch('updateUrl')
    },
    updateUrl({ state }) {
      const filtersUrlComponent = state.filters
        .map(
          activeFilter =>
            slugify(activeFilter.tag) +
            (activeFilter.submenu ? `/${slugify(activeFilter.submenu.text)}` : ''),
        )
        .join(',')
      const page = state.name === 'books' ? 'Home' : 'People'
      router[router.currentRoute.name === page ? 'replace' : 'push']({
        name: page,
        query:
          state.filters.length > 0
            ? {
                filters: filtersUrlComponent,
              }
            : {},
      })
    },
  },
})

export default module
